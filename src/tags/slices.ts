import { isSameOrNested, tagId, tagKey, type TagLevel } from "./tagKey";

/** One wedge of a pie-chart node. */
export interface Slice {
	rgb: number;
	/** How many of the note's tags this colour stands for. */
	weight: number;
}

export interface PaletteLookup {
	(id: string): { rgb: number; order: number } | undefined;
}

/**
 * Slices for a note, using the plugin's tag palette. Slices are sorted by the
 * palette order so the same colour sits in the same place on every node.
 */
export function slicesFromPalette(tags: readonly string[], level: TagLevel, lookup: PaletteLookup): Slice[] {
	const byKey = new Map<string, { rgb: number; order: number; weight: number }>();
	for (const tag of tags) {
		const id = tagId(tagKey(tag, level));
		const hit = lookup(id);
		if (!hit) continue;
		const prev = byKey.get(id);
		if (prev) prev.weight++;
		else byKey.set(id, { rgb: hit.rgb, order: hit.order, weight: 1 });
	}
	return mergeSameColour([...byKey.values()].sort((a, b) => a.order - b.order));
}

/**
 * Slices for a note, using the Graph view's own colour groups: one slice per
 * group the note matches. `tag:#Music` matches `#Music` and `#Music/Singer`,
 * exactly like Obsidian's search.
 */
export function slicesFromGroups(tags: readonly string[], groups: ReadonlyArray<{ id: string; rgb: number }>): Slice[] {
	const out: Slice[] = [];
	for (const g of groups) {
		let weight = 0;
		for (const t of tags) if (isSameOrNested(t, g.id)) weight++;
		if (weight > 0) out.push({ rgb: g.rgb, weight });
	}
	return mergeSameColour(out);
}

/** Neighbouring tags that share a colour become one wedge. */
function mergeSameColour(slices: ReadonlyArray<{ rgb: number; weight: number }>): Slice[] {
	const out: Slice[] = [];
	const index = new Map<number, number>();
	for (const s of slices) {
		const at = index.get(s.rgb);
		if (at === undefined) {
			index.set(s.rgb, out.length);
			out.push({ rgb: s.rgb, weight: s.weight });
		} else {
			out[at].weight += s.weight;
		}
	}
	return out;
}

/**
 * Turns slices into [startAngle, endAngle] pairs (radians, clockwise from 12
 * o'clock). `weighted` sizes each wedge by its tag count; otherwise every
 * colour gets an equal share.
 */
export function sliceAngles(slices: readonly Slice[], weighted: boolean): Array<[number, number]> {
	const total = weighted ? slices.reduce((s, x) => s + x.weight, 0) : slices.length;
	const out: Array<[number, number]> = [];
	let a = -Math.PI / 2;
	for (const s of slices) {
		const span = ((weighted ? s.weight : 1) / total) * Math.PI * 2;
		out.push([a, a + span]);
		a += span;
	}
	return out;
}
