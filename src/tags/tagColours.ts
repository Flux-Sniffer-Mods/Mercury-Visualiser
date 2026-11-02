import { debounce, getAllTags, normalizePath, TFile, type App, type CachedMetadata } from "obsidian";
import { pickDistinctColour, spreadColours } from "../colour/colour";
import type { MercurySettings, PaletteRecord } from "../settings";
import { engineOf, graphLeaves, graphPluginInstance, type CoreGraphView } from "../graph/internals";
import { syncColourGroups, tagColoursFromGroups, tagIdOfGroup, type ColourGroup, type PaletteEntry } from "./colourGroups";
import { slicesFromGroups, slicesFromPalette, type Slice } from "./slices";
import { cleanTag, parseTagList, tagId, tagKey } from "./tagKey";

export interface TagColourHost {
	app: App;
	settings: MercurySettings;
	saveSettings(): Promise<void>;
	/** Called whenever colours that nodes are drawn with may have changed. */
	onColoursChanged(): void;
}

export interface TagStat {
	id: string;
	name: string;
	count: number;
}

/**
 * Feature 1: keeps a palette of tag → colour, hands every new tag the most
 * distinct colour still available, and mirrors the palette into the Graph
 * view's colour groups.
 */
export class TagColourManager {
	/** path → the note's tags, without `#`. */
	private fileTags = new Map<string, string[]>();
	private slicesCache = new Map<string, Slice[]>();
	private groupColours: Array<{ id: string; name: string; rgb: number }> = [];
	private indexed = false;

	readonly scheduleRefresh = debounce(() => void this.refresh(), 800, true);
	private readonly scheduleColoursChanged = debounce(() => this.host.onColoursChanged(), 250, true);

	constructor(private host: TagColourHost) {}

	private get app(): App {
		return this.host.app;
	}

	private get settings(): MercurySettings {
		return this.host.settings;
	}

	// ---------------------------------------------------------------- index

	rebuildIndex(): void {
		this.fileTags.clear();
		for (const file of this.app.vault.getMarkdownFiles()) {
			this.fileTags.set(file.path, this.readTags(this.app.metadataCache.getFileCache(file)));
		}
		this.indexed = true;
		this.slicesCache.clear();
	}

	private readTags(cache: CachedMetadata | null): string[] {
		if (!cache) return [];
		const tags = getAllTags(cache) ?? [];
		const out: string[] = [];
		const seen = new Set<string>();
		for (const t of tags) {
			const clean = cleanTag(t);
			const id = clean.toLowerCase();
			if (!clean || seen.has(id)) continue;
			seen.add(id);
			out.push(clean);
		}
		return out;
	}

	onFileChanged(file: TFile, cache: CachedMetadata): void {
		const before = this.fileTags.get(file.path);
		const after = this.readTags(cache);
		this.fileTags.set(file.path, after);
		this.slicesCache.delete(file.path);
		if (!before || before.join("\u0000") !== after.join("\u0000")) {
			this.scheduleColoursChanged();
			const level = this.settings.tagLevel;
			const isNew = after.some((t) => !this.settings.palette[tagId(tagKey(t, level))]);
			const lost = (before ?? []).some((t) => !after.includes(t));
			if (isNew || lost) this.scheduleRefresh();
		}
	}

	onFileDeleted(path: string): void {
		if (this.fileTags.delete(path)) {
			this.slicesCache.delete(path);
			this.scheduleRefresh();
			this.scheduleColoursChanged();
		}
	}

	onFileRenamed(oldPath: string, newPath: string): void {
		const tags = this.fileTags.get(oldPath);
		if (!tags) return;
		this.fileTags.delete(oldPath);
		this.fileTags.set(newPath, tags);
		this.slicesCache.delete(oldPath);
		this.scheduleColoursChanged();
	}

	tagsOf(path: string): readonly string[] {
		let tags = this.fileTags.get(path);
		if (!tags) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return [];
			tags = this.readTags(this.app.metadataCache.getFileCache(file));
			this.fileTags.set(path, tags);
		}
		return tags;
	}

	/** Tags at the configured level with how many notes use each, most used first. */
	stats(): TagStat[] {
		if (!this.indexed) this.rebuildIndex();
		const level = this.settings.tagLevel;
		const counts = new Map<string, TagStat>();
		for (const tags of this.fileTags.values()) {
			const seen = new Set<string>();
			for (const t of tags) {
				const name = tagKey(t, level);
				const id = name.toLowerCase();
				if (seen.has(id)) continue;
				seen.add(id);
				const stat = counts.get(id);
				if (stat) stat.count++;
				else counts.set(id, { id, name, count: 1 });
			}
		}
		return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	}

	/** Tags that should have a colour right now (enough notes, not ignored). */
	eligible(stats = this.stats()): TagStat[] {
		const ignored = parseTagList(this.settings.ignoredTags).map((t) => t.toLowerCase());
		const isIgnored = (id: string) => ignored.some((i) => id === i || id.startsWith(i + "/"));
		return stats.filter((s) => s.count >= Math.max(1, this.settings.minNotesPerTag) && !isIgnored(s.id));
	}

	// -------------------------------------------------------------- palette

	private addToPalette(id: string, name: string, rgb: number): PaletteRecord {
		const record: PaletteRecord = { name, rgb, locked: false, order: this.settings.nextOrder++ };
		this.settings.palette[id] = record;
		return record;
	}

	private usedColours(exceptId?: string): number[] {
		const out: number[] = [];
		for (const [id, rec] of Object.entries(this.settings.palette)) if (id !== exceptId) out.push(rec.rgb);
		// Colours of the user's other colour groups (paths, searches) count as taken too.
		for (const g of this.readGraphGroups() ?? []) if (tagIdOfGroup(g) === null) out.push(g.color.rgb);
		return out;
	}

	/** Gives every eligible tag without a colour the most distinct colour left. Returns true if any were added. */
	assignMissing(eligible = this.eligible()): boolean {
		let added = false;
		const used = this.usedColours();
		for (const tag of eligible) {
			if (this.settings.palette[tag.id]) continue;
			const rgb = pickDistinctColour(used, this.settings.colourPool);
			used.push(rgb);
			this.addToPalette(tag.id, tag.name, rgb);
			added = true;
		}
		return added;
	}

	/**
	 * Recolours every unlocked tag (or, with `includeLocked`, every tag) so the
	 * whole palette is as spread out as possible. Most-used tags go first, so
	 * they get the most distinct colours.
	 */
	async respreadAll(includeLocked = false): Promise<void> {
		const stats = this.eligible();
		const rank = new Map(stats.map((s, i) => [s.id, i]));
		const movable = (id: string, locked: boolean) => rank.has(id) && (includeLocked || !locked);
		const entries = Object.entries(this.settings.palette)
			.filter(([id, rec]) => movable(id, rec.locked))
			.sort((a, b) => (rank.get(a[0]) ?? 0) - (rank.get(b[0]) ?? 0));
		const fixed = Object.entries(this.settings.palette)
			.filter(([id, rec]) => !movable(id, rec.locked))
			.map(([, rec]) => rec.rgb);
		if (includeLocked) for (const [, rec] of entries) rec.locked = false;
		for (const g of this.readGraphGroups() ?? []) if (tagIdOfGroup(g) === null) fixed.push(g.color.rgb);
		const colours = spreadColours(entries.length, fixed, this.settings.colourPool);
		entries.forEach(([, rec], i) => (rec.rgb = colours[i]));
		await this.refresh({ forceWrite: true });
	}

	async setColour(id: string, rgb: number): Promise<void> {
		const rec = this.settings.palette[id];
		if (!rec || rec.rgb === rgb) return;
		rec.rgb = rgb;
		await this.refresh();
	}

	async rerollColour(id: string): Promise<void> {
		const rec = this.settings.palette[id];
		if (!rec) return;
		rec.rgb = pickDistinctColour(this.usedColours(id), this.settings.colourPool);
		await this.refresh();
	}

	async setLocked(id: string, locked: boolean): Promise<void> {
		const rec = this.settings.palette[id];
		if (!rec) return;
		rec.locked = locked;
		await this.host.saveSettings();
	}

	/** Forgets every assigned colour except those copied from the Graph view's own groups. */
	async resetPalette(): Promise<void> {
		this.settings.palette = {};
		this.settings.nextOrder = 0;
		await this.refresh({ forceWrite: true });
	}

	// --------------------------------------------------------------- graph

	readGraphGroups(): ColourGroup[] | null {
		const groups = graphPluginInstance(this.app)?.options?.colorGroups;
		return Array.isArray(groups) ? groups : null;
	}

	private async readGraphGroupsFromDisk(): Promise<{ config: Record<string, unknown>; groups: ColourGroup[] } | null> {
		try {
			const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
			const config = JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>;
			return { config, groups: Array.isArray(config.colorGroups) ? (config.colorGroups as ColourGroup[]) : [] };
		} catch {
			return null;
		}
	}

	private async writeGraphGroups(groups: ColourGroup[], stripFromLocal?: ReadonlySet<string>): Promise<void> {
		const instance = graphPluginInstance(this.app);
		if (instance?.options) {
			instance.options.colorGroups = groups;
			instance.saveOptions?.();
		} else {
			const disk = await this.readGraphGroupsFromDisk();
			const config = disk?.config ?? {};
			config.colorGroups = groups;
			const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
			await this.app.vault.adapter.write(path, JSON.stringify(config, null, 2));
		}
		this.applyToOpenGraphs(stripFromLocal);
	}

	/**
	 * Pushes the colour groups into open graph tabs so they recolour without
	 * being reopened. With `strip`, those tags' groups are taken out of local
	 * graphs instead (used when the feature is switched off).
	 */
	private applyToOpenGraphs(strip?: ReadonlySet<string>): void {
		const global = this.readGraphGroups() ?? [];
		const entries = strip ? [] : this.paletteEntries();
		for (const leaf of graphLeaves(this.app)) {
			const view = leaf.view as CoreGraphView;
			const engine = engineOf(view);
			if (!engine?.getOptions || !engine.setOptions) continue;
			try {
				const options = engine.getOptions();
				let groups: ColourGroup[];
				if (view.getViewType() === "graph") {
					groups = global;
				} else {
					// Local graphs keep their own groups: make the palette's colours win there.
					const current = Array.isArray(options.colorGroups) ? (options.colorGroups as ColourGroup[]) : [];
					if (strip) {
						groups = current.filter((g) => {
							const id = tagIdOfGroup(g);
							return id === null || !strip.has(id);
						});
						if (groups.length === current.length) continue;
						engine.setOptions({ ...options, colorGroups: groups });
						continue;
					}
					const managed: Record<string, number> = {};
					for (const g of current) {
						const id = tagIdOfGroup(g);
						if (id !== null && (this.settings.managedGroups[id] !== undefined || this.settings.palette[id])) {
							managed[id] ??= g.color.rgb;
						}
					}
					groups = syncColourGroups({
						groups: current,
						entries,
						managed,
						created: this.settings.createdGroups,
						removeStale: this.settings.removeStaleGroups,
					}).groups;
				}
				if (JSON.stringify(options.colorGroups ?? []) === JSON.stringify(groups)) continue;
				engine.setOptions({ ...options, colorGroups: groups.map((g) => ({ query: g.query, color: { ...g.color } })) });
			} catch (e) {
				console.warn("Mercury Visualiser: could not update a graph view's colour groups", e);
			}
		}
	}

	/** Eligible palette entries in the order new colour groups are appended. */
	private paletteEntries(eligible = this.eligible()): PaletteEntry[] {
		const entries: PaletteEntry[] = [];
		for (const s of eligible) {
			const rec = this.settings.palette[s.id];
			if (rec) entries.push({ id: s.id, name: rec.name, rgb: rec.rgb });
		}
		// With nested tags, deeper tags go first so the Graph view (first match wins) shows the most specific colour.
		if (this.settings.tagLevel === "full") {
			entries.sort((a, b) => b.name.split("/").length - a.name.split("/").length);
		}
		return entries;
	}

	/**
	 * The full pass: index tags, adopt colours the user already set in the
	 * Graph view, colour any new tags, and write the result back.
	 */
	async refresh(opts: { reindex?: boolean; forceWrite?: boolean } = {}): Promise<void> {
		if (opts.reindex || !this.indexed) this.rebuildIndex();
		this.groupColours = tagColoursFromGroups(this.readGraphGroups() ?? []);

		if (this.settings.autoColours) {
			const stats = this.stats();
			const eligible = this.eligible(stats);
			const nameById = new Map(stats.map((s) => [s.id, s.name]));

			// Seed from hand-made colour groups so existing choices are kept (and locked).
			for (const g of this.groupColours) {
				if (!this.settings.palette[g.id]) {
					this.addToPalette(g.id, nameById.get(g.id) ?? g.name, g.rgb).locked = true;
				}
			}
			this.assignMissing(eligible);

			if (this.settings.syncGraphColourGroups) {
				const groups = this.readGraphGroups() ?? (await this.readGraphGroupsFromDisk())?.groups ?? [];
				const result = syncColourGroups({
					groups,
					entries: this.paletteEntries(eligible),
					managed: this.settings.managedGroups,
					created: this.settings.createdGroups,
					removeStale: this.settings.removeStaleGroups,
				});
				const created = new Set([...this.settings.createdGroups, ...result.appended]);
				for (const id of result.removed) created.delete(id);
				this.settings.createdGroups = [...created];
				// Colours chosen in the Graph view's own panel win, and are locked so a re-spread keeps them.
				for (const [id, rgb] of Object.entries(result.adopted)) {
					const rec = this.settings.palette[id];
					if (rec) {
						rec.rgb = rgb;
						rec.locked = true;
					}
				}
				this.settings.managedGroups = result.managed;
				if (result.changed || opts.forceWrite) await this.writeGraphGroups(result.groups);
				else this.applyToOpenGraphs();
				this.groupColours = tagColoursFromGroups(result.groups);
			}
		}

		this.slicesCache.clear();
		await this.host.saveSettings();
		this.host.onColoursChanged();
	}

	/**
	 * Removes the colour groups this plugin added, leaving hand-made ones as
	 * they are. Used when automatic colours are switched off. Returns how many went.
	 */
	async removeCreatedGroups(): Promise<number> {
		const groups = this.readGraphGroups() ?? (await this.readGraphGroupsFromDisk())?.groups ?? [];
		const created = new Set(this.settings.createdGroups);
		const kept = groups.filter((g) => {
			const id = tagIdOfGroup(g);
			return id === null || !created.has(id);
		});
		const removed = groups.length - kept.length;
		for (const id of created) delete this.settings.managedGroups[id];
		this.settings.createdGroups = [];
		await this.writeGraphGroups(kept, created);
		this.groupColours = tagColoursFromGroups(kept);
		this.slicesCache.clear();
		await this.host.saveSettings();
		this.host.onColoursChanged();
		return removed;
	}

	private lastGroupsJson = "";

	/** Notices colour-group edits made in the Graph view's own panel and folds them in. */
	checkForGraphEdits(): void {
		const json = JSON.stringify(this.readGraphGroups() ?? []);
		if (this.lastGroupsJson && json !== this.lastGroupsJson) this.scheduleRefresh();
		this.lastGroupsJson = json;
	}

	// --------------------------------------------------------------- pies

	/** The colour wedges for a note. */
	slicesFor(path: string): Slice[] {
		let slices = this.slicesCache.get(path);
		if (slices) return slices;
		const tags = this.tagsOf(path);
		if (tags.length === 0) slices = [];
		else if (this.settings.autoColours) {
			const palette = this.settings.palette;
			slices = slicesFromPalette(tags, this.settings.tagLevel, (id) => palette[id]);
		} else {
			slices = slicesFromGroups(tags, this.groupColours);
		}
		this.slicesCache.set(path, slices);
		return slices;
	}

	/** The colour of a tag node (shown when the Graph view's "Tags" option is on). */
	colourForTag(tag: string): number | null {
		const clean = cleanTag(tag);
		if (this.settings.autoColours) {
			const rec =
				this.settings.palette[tagId(clean)] ?? this.settings.palette[tagId(tagKey(clean, this.settings.tagLevel))];
			if (rec) return rec.rgb;
		}
		const id = tagId(clean);
		for (const g of this.groupColours) if (id === g.id || id.startsWith(g.id + "/")) return g.rgb;
		return null;
	}
}
