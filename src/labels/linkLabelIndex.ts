import { debounce, TFile, type App } from "obsidian";
import { labelFor, parseListings, type LabelMode } from "./listings";

/**
 * Keeps, for every note, the listing each of its links sits in, keyed by the
 * same ids the Graph view uses for its nodes (file path, or the link text for
 * notes that don't exist yet). Built in the background, then kept up to date
 * as notes change.
 */
export class LinkLabelIndex {
	/** source path → target node id → listing paths (one per mention). */
	private bySource = new Map<string, Map<string, string[][]>>();
	/** source path → listing (its titles joined) → node ids of everyone listed in it. */
	private listings = new Map<string, Map<string, string[]>>();
	private building: Promise<void> | null = null;
	private built = false;
	version = 0;

	private readonly changed = debounce(() => {
		this.version++;
		this.onChange();
	}, 400, true);

	constructor(private app: App, private onChange: () => void) {}

	get ready(): boolean {
		return this.built;
	}

	/** Reads every note once (in small batches so the app stays responsive). */
	ensureBuilt(): Promise<void> {
		if (this.built) return Promise.resolve();
		this.building ??= this.buildAll();
		return this.building;
	}

	private async buildAll(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const BATCH = 40;
		for (let i = 0; i < files.length; i += BATCH) {
			await Promise.all(
				files.slice(i, i + BATCH).map(async (file) => {
					try {
						this.store(file, await this.app.vault.cachedRead(file));
					} catch {
						/* unreadable file: no labels */
					}
				}),
			);
			await new Promise((r) => window.setTimeout(r, 0));
		}
		this.built = true;
		this.building = null;
		this.version++;
		this.onChange();
	}

	private store(file: TFile, text: string): void {
		const targets = new Map<string, string[][]>();
		const listings = new Map<string, string[]>();
		for (const link of parseListings(text)) {
			if (link.path.length === 0) continue;
			const dest = this.app.metadataCache.getFirstLinkpathDest(link.target, file.path);
			const id = dest ? dest.path : link.target;
			const list = targets.get(id);
			if (list) list.push(link.path);
			else targets.set(id, [link.path]);
			const key = listingKey(link.path);
			const members = listings.get(key);
			if (!members) listings.set(key, [id]);
			else if (!members.includes(id)) members.push(id);
		}
		if (targets.size > 0) {
			this.bySource.set(file.path, targets);
			this.listings.set(file.path, listings);
		} else {
			this.bySource.delete(file.path);
			this.listings.delete(file.path);
		}
	}

	/**
	 * Everyone listed alongside the link between two graph nodes (the people
	 * in "asdfmovie4: [[…]], [[…]]"), with a key that names that listing.
	 */
	listingOf(sourceId: string, targetId: string): { key: string; members: string[] } | null {
		for (const [s, t] of [
			[sourceId, targetId],
			[targetId, sourceId],
		]) {
			const path = this.bySource.get(s)?.get(t)?.[0];
			if (!path) continue;
			const key = listingKey(path);
			const members = this.listings.get(s)?.get(key);
			if (members) return { key: `${s}\u0000${key}`, members };
		}
		return null;
	}

	/** Labels need redrawing (e.g. the label style changed). */
	bump(): void {
		this.version++;
		this.onChange();
	}

	/** A note was edited (the new text comes with Obsidian's change event). */
	update(file: TFile, text: string): void {
		if (!this.built && !this.building) return;
		this.store(file, text);
		this.changed();
	}

	remove(path: string): void {
		this.listings.delete(path);
		if (this.bySource.delete(path)) this.changed();
	}

	rename(oldPath: string, file: TFile): void {
		this.bySource.delete(oldPath);
		this.listings.delete(oldPath);
		void this.app.vault.cachedRead(file).then((text) => {
			this.store(file, text);
			this.changed();
		});
	}

	/**
	 * The label for the line between two graph nodes. Uses the source note's
	 * listing, or the other note's if the link only goes the other way. Two
	 * different listings are shown together ("Series › 2 / Podcast").
	 */
	label(sourceId: string, targetId: string, mode: LabelMode): string | null {
		const paths = this.bySource.get(sourceId)?.get(targetId) ?? this.bySource.get(targetId)?.get(sourceId);
		if (!paths) return null;
		const labels: string[] = [];
		for (const p of paths) {
			const l = labelFor(p, mode);
			if (l && !labels.includes(l)) labels.push(l);
			if (labels.length === 2) break;
		}
		if (labels.length === 0) return null;
		const more = new Set(paths.map((p) => labelFor(p, mode))).size - labels.length;
		return labels.join(" / ") + (more > 0 ? ` +${more}` : "");
	}
}

function listingKey(path: readonly string[]): string {
	return path.join("\u0001");
}

export function isMarkdown(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === "md";
}
