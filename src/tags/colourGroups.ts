import { parseTagQuery, tagId, tagQuery } from "./tagKey";

/** The shape Obsidian's Graph view uses for a colour group (see `.obsidian/graph.json`). */
export interface ColourGroup {
	query: string;
	color: { a: number; rgb: number };
}

export interface PaletteEntry {
	id: string;
	name: string;
	rgb: number;
}

export interface SyncInput {
	/** The Graph view's current colour groups. */
	groups: readonly ColourGroup[];
	/** Tags that should have a colour group, in the order new groups are appended. */
	entries: readonly PaletteEntry[];
	/** Tag id → colour this plugin last wrote for it. Marks the groups the plugin looks after. */
	managed: Readonly<Record<string, number>>;
	/** Tag ids whose group this plugin added itself (hand-made groups are never removed). */
	created: readonly string[];
	/** Remove groups the plugin created once their tag no longer qualifies. */
	removeStale: boolean;
}

export interface SyncResult {
	groups: ColourGroup[];
	managed: Record<string, number>;
	/** Colours picked up from the Graph view (pre-existing groups or edits made there). */
	adopted: Record<string, number>;
	/** Tag ids whose group was added by this pass. */
	appended: string[];
	/** Tag ids whose group was removed by this pass. */
	removed: string[];
	changed: boolean;
}

/**
 * Two-way merge between the plugin's tag palette and the Graph view's colour groups.
 *
 * - Groups the user made by hand for a tag are adopted: their colour wins and is
 *   copied into the palette, so nothing the user already chose changes.
 * - A colour edited in the Graph view's own colour-group panel is adopted too.
 * - A colour edited in the plugin's settings is written to the Graph view.
 * - Tags without a group get one appended; once their tag disappears, groups
 *   the plugin added are removed again (hand-made ones are left alone).
 * - Non-tag groups (paths, searches...) are never touched.
 */
export function syncColourGroups(input: SyncInput): SyncResult {
	const byId = new Map(input.entries.map((e) => [e.id, e]));
	const managed: Record<string, number> = { ...input.managed };
	const adopted: Record<string, number> = {};
	const appended: string[] = [];
	const removed: string[] = [];
	const seen = new Set<string>();
	const created = new Set(input.created);
	const groups: ColourGroup[] = [];
	let changed = false;

	for (const group of input.groups) {
		const tag = parseTagQuery(group.query);
		const id = tag === null ? null : tagId(tag);
		if (id === null || seen.has(id)) {
			groups.push(group);
			continue;
		}

		const entry = byId.get(id);
		if (!entry) {
			if (created.has(id) && input.removeStale) {
				delete managed[id];
				removed.push(id);
				changed = true;
				continue;
			}
			groups.push(group);
			continue;
		}

		seen.add(id);
		const current = group.color.rgb;
		const last = managed[id];
		if (last === undefined || current !== last) {
			// Pre-existing group, or edited in the Graph view: the Graph view's colour wins.
			managed[id] = current;
			if (current !== entry.rgb) adopted[id] = current;
			groups.push(group);
		} else if (entry.rgb !== current) {
			managed[id] = entry.rgb;
			groups.push({ query: group.query, color: { a: group.color.a, rgb: entry.rgb } });
			changed = true;
		} else {
			groups.push(group);
		}
	}

	for (const entry of input.entries) {
		if (seen.has(entry.id)) continue;
		groups.push({ query: tagQuery(entry.name), color: { a: 1, rgb: entry.rgb } });
		managed[entry.id] = entry.rgb;
		appended.push(entry.id);
		changed = true;
	}

	// Forget managed tags whose group the user deleted and that no longer qualify.
	for (const id of Object.keys(managed)) {
		if (!byId.has(id) && !groups.some((g) => tagIdOfGroup(g) === id)) delete managed[id];
	}

	return { groups, managed, adopted, appended, removed, changed };
}

export function tagIdOfGroup(group: ColourGroup): string | null {
	const tag = parseTagQuery(group.query);
	return tag === null ? null : tagId(tag);
}

/** Tag id → colour for every single-tag colour group (first group per tag wins, as in Obsidian). */
export function tagColoursFromGroups(groups: readonly ColourGroup[]): Array<{ id: string; name: string; rgb: number }> {
	const out: Array<{ id: string; name: string; rgb: number }> = [];
	const seen = new Set<string>();
	for (const g of groups) {
		const tag = parseTagQuery(g.query);
		if (tag === null) continue;
		const id = tagId(tag);
		if (seen.has(id)) continue;
		seen.add(id);
		out.push({ id, name: tag, rgb: g.color.rgb });
	}
	return out;
}
