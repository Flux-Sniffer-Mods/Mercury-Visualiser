import { describe, expect, it } from "vitest";
import { findClusters } from "../src/layout/clusters";
import { buildAdjacency } from "../src/layout/radialTree";
import { createLayout } from "../src/layout/simulation";

/** Three tight groups of 12, joined by single bridge links, each with a few single-link leaves. */
function islands() {
	const links: number[] = [];
	const groups: number[][] = [];
	const size = 12;
	let next = 0;
	for (let g = 0; g < 3; g++) {
		const members = Array.from({ length: size }, () => next++);
		for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) if ((i + j) % 3 !== 0) links.push(members[i], members[j]);
		for (let k = 0; k < 3; k++) {
			const leaf = next++;
			links.push(members[k], leaf);
			members.push(leaf);
		}
		groups.push(members);
	}
	links.push(groups[0][0], groups[1][0], groups[1][1], groups[2][1]);
	const n = next;
	const positions = new Float64Array(n * 2);
	for (let i = 0; i < n; i++) {
		positions[2 * i] = Math.cos(i * 2.4) * 60;
		positions[2 * i + 1] = Math.sin(i * 2.4) * 60;
	}
	return { n, links: Uint32Array.from(links), positions, groups };
}

function centre(pos: Float64Array, ids: number[]) {
	let x = 0;
	let y = 0;
	for (const i of ids) {
		x += pos[2 * i];
		y += pos[2 * i + 1];
	}
	return { x: x / ids.length, y: y / ids.length };
}

function spread(pos: Float64Array, ids: number[]) {
	const c = centre(pos, ids);
	return Math.sqrt(ids.reduce((s, i) => s + (pos[2 * i] - c.x) ** 2 + (pos[2 * i + 1] - c.y) ** 2, 0) / ids.length);
}

/** Gap between clusters relative to their size: higher means more clearly separate. */
function separation(pos: Float64Array, groups: number[][]) {
	let worst = Infinity;
	for (let a = 0; a < groups.length; a++) {
		for (let b = a + 1; b < groups.length; b++) {
			const ca = centre(pos, groups[a]);
			const cb = centre(pos, groups[b]);
			const d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
			worst = Math.min(worst, d / (spread(pos, groups[a]) + spread(pos, groups[b])));
		}
	}
	return worst;
}

describe("dynamic spacing", () => {
	it("finds each tight group as one cluster, leaves included", () => {
		const g = islands();
		const cluster = findClusters(buildAdjacency(g.n, g.links));
		for (const members of g.groups) expect(new Set(members.map((i) => cluster[i])).size).toBe(1);
		expect(new Set(g.groups.map((m) => cluster[m[0]])).size).toBe(3);
	});

	it("keeps clusters further apart than without it", () => {
		const g = islands();
		const run = (clusters: boolean) => {
			const layout = createLayout({
				n: g.n,
				positions: Float64Array.from(g.positions),
				sizes: new Float32Array(g.n).fill(4),
				links: g.links,
				params: { style: "spokes", spokeLength: 60, splay: 0.6, repel: 3, clusters, root: -1, alpha: 1 },
			});
			while (!layout.step(50));
			return layout.positions();
		};
		const off = separation(run(false), g.groups);
		const on = separation(run(true), g.groups);
		expect(on).toBeGreaterThan(off * 1.15);
		expect(on).toBeGreaterThan(1);
	});
});
