import { mixColours } from "../colour/colour";
import type { Slice } from "../tags/slices";

/**
 * The colour for a listing's label, from the tag colours of everyone listed
 * in it, weighted towards its main tags.
 *
 * Each person shares one vote between their tag colours. Votes are squared,
 * so the tags most of the listing has clearly win and a one-off doesn't muddy
 * the result, then the colours are blended. Null when nobody listed has a
 * tag colour.
 */
export function listingColour(members: ReadonlyArray<readonly Slice[]>): number | null {
	const votes = new Map<number, number>();
	for (const slices of members) {
		const total = slices.reduce((s, x) => s + x.weight, 0);
		if (total <= 0) continue;
		for (const sl of slices) votes.set(sl.rgb, (votes.get(sl.rgb) ?? 0) + sl.weight / total);
	}
	if (votes.size === 0) return null;
	return mixColours([...votes].map(([rgb, v]) => ({ rgb, weight: v * v })));
}
