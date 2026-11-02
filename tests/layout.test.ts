import { describe, expect, it } from "vitest";
import { buildAdjacency, radialTree } from "../src/layout/radialTree";
import { createLayout, type LayoutParams } from "../src/layout/simulation";
import { splayScore } from "../src/layout/splayForce";

/**
 * The "broom" from the sketch: a hub joined to a dense cluster, with a fan of
 * leaves. Plain force layouts push all the leaves to the side facing away from
 * the cluster; the splay force should spread them right round the hub.
 */
function broomGraph() {
	const links: number[] = [];
	const cluster = 30;
	for (let i = 0; i < cluster; i++) for (let j = i + 1; j < cluster; j++) if ((i * 7 + j) % 4 === 0) links.push(i, j);
	const hub = cluster;
	links.push(hub, 0, hub, 1, hub, 2);
	const leaves: number[] = [];
	for (let k = 0; k < 10; k++) {
		const leaf = hub + 1 + k;
		leaves.push(leaf);
		links.push(hub, leaf);
	}
	const n = hub + 1 + leaves.length;
	// Start with every leaf on the far side of the hub, like the sketch.
	const positions = new Float64Array(n * 2);
	for (let i = 0; i < cluster; i++) {
		positions[2 * i] = Math.cos(i) * 80;
		positions[2 * i + 1] = Math.sin(i) * 80;
	}
	positions[2 * hub] = 300;
	positions[2 * hub + 1] = 0;
	leaves.forEach((leaf, k) => {
		const a = (k / leaves.length - 0.5) * 0.9;
		positions[2 * leaf] = 300 + Math.cos(a) * 120;
		positions[2 * leaf + 1] = Math.sin(a) * 120;
	});
	return { n, links: Uint32Array.from(links), positions, hub, leaves };
}

function run(params: Partial<LayoutParams>) {
	const g = broomGraph();
	const layout = createLayout({
		n: g.n,
		positions: g.positions.slice(),
		sizes: new Float32Array(g.n).fill(6),
		links: g.links,
		params: { style: "spokes", spokeLength: 100, splay: 0.6, repel: 1, root: -1, alpha: 1, ...params },
	});
	let guard = 0;
	while (!layout.step(10) && guard++ < 200);
	return { g, positions: layout.positions(), progress: layout.progress() };
}

/** Largest empty angle around the hub (2π for a single direction, 2π/k when perfectly even). */
function largestGap(positions: Float64Array, centre: number, others: number[]) {
	const cx = positions[2 * centre];
	const cy = positions[2 * centre + 1];
	const angles = others.map((o) => Math.atan2(positions[2 * o + 1] - cy, positions[2 * o] - cx)).sort((a, b) => a - b);
	let gap = angles[0] + Math.PI * 2 - angles[angles.length - 1];
	for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
	return gap;
}

describe("radial splay layout", () => {
	it("runs to completion with finite positions", () => {
		const { positions, progress } = run({});
		expect(progress).toBe(1);
		expect([...positions].every(Number.isFinite)).toBe(true);
	});

	it("spreads a hub's links right round it instead of to one side", () => {
		const withSplay = run({ splay: 0.8 });
		const without = run({ splay: 0 });
		const adj = buildAdjacency(withSplay.g.n, withSplay.g.links);
		const neighbours = adj[withSplay.g.hub];

		const gapWith = largestGap(withSplay.positions, withSplay.g.hub, neighbours);
		const gapWithout = largestGap(without.positions, without.g.hub, neighbours);
		expect(gapWith).toBeLessThan(gapWithout);
		// 13 links: perfectly even would be ~0.48 rad apart; allow some slack.
		expect(gapWith).toBeLessThan(1.1);

		// Balance of the hub itself (1 = links point every way equally, 0 = all one way).
		const hubOnly = adj.map((a, i) => (i === withSplay.g.hub ? a : []));
		expect(splayScore(withSplay.positions, hubOnly)).toBeGreaterThan(0.85);
		expect(splayScore(withSplay.positions, hubOnly)).toBeGreaterThan(splayScore(without.positions, hubOnly));
	});

	it("handles graphs with no links and nodes with no position", () => {
		const n = 5;
		const positions = new Float64Array(n * 2).fill(NaN);
		const layout = createLayout({
			n,
			positions,
			sizes: new Float32Array(n).fill(5),
			links: new Uint32Array(0),
			params: { style: "spokes", spokeLength: 50, splay: 0.5, repel: 1, root: -1, alpha: 1 },
		});
		while (!layout.step(20));
		expect([...layout.positions()].every(Number.isFinite)).toBe(true);
	});
});

describe("settling in changes", () => {
	it("keeps fixed nodes exactly where they are", () => {
		const g = broomGraph();
		const fixed = new Uint8Array(g.n).fill(1);
		for (const leaf of g.leaves) fixed[leaf] = 0;
		const layout = createLayout({
			n: g.n,
			positions: g.positions.slice(),
			sizes: new Float32Array(g.n).fill(6),
			links: g.links,
			fixed,
			params: { style: "spokes", spokeLength: 100, splay: 0.6, repel: 1, root: -1, alpha: 0.3 },
		});
		while (!layout.step(10));
		const p = layout.positions();
		for (let i = 0; i < g.n; i++) {
			if (!fixed[i]) continue;
			expect(p[2 * i]).toBe(g.positions[2 * i]);
			expect(p[2 * i + 1]).toBe(g.positions[2 * i + 1]);
		}
		// The free leaves still spread out round their (fixed) hub.
		expect(largestGap(p, g.hub, g.leaves)).toBeLessThan(largestGap(g.positions, g.hub, g.leaves));
	});

	it("settles a gentle adjustment in fewer steps than a fresh layout", () => {
		const g = broomGraph();
		const count = (alpha: number) => {
			const layout = createLayout({
				n: g.n,
				positions: g.positions.slice(),
				sizes: new Float32Array(g.n).fill(6),
				links: g.links,
				params: { style: "spokes", spokeLength: 100, splay: 0.6, repel: 1, root: -1, alpha },
			});
			let steps = 0;
			while (!layout.step(1)) steps++;
			return steps;
		};
		expect(count(0.3)).toBeLessThan(count(1));
	});
});

describe("rings style", () => {
	it("puts each step away from the centre on its own ring", () => {
		// root 0 → 1,2,3 → each has two children; plus a separate pair.
		const links = [0, 1, 0, 2, 0, 3, 1, 4, 1, 5, 2, 6, 2, 7, 3, 8, 3, 9, 10, 11];
		const n = 12;
		const adj = buildAdjacency(n, links);
		const tree = radialTree(n, adj, 0, 100, 10);
		expect(tree.depth[0]).toBe(0);
		expect([1, 2, 3].map((i) => tree.depth[i])).toEqual([1, 1, 1]);
		expect(tree.depth[4]).toBe(2);
		// The separate pair sits on the outer belt.
		expect(tree.depth[10]).toBe(3);
		expect(tree.radius[4]).toBeGreaterThan(tree.radius[1]);
		expect(Math.abs(tree.positions[0])).toBe(0);

		// Children stay inside their parent's slice: 4 and 5 are closer to 1 than to 2 or 3.
		const angle = (i: number) => Math.atan2(tree.positions[2 * i + 1], tree.positions[2 * i]);
		const diff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
		expect(diff(angle(4), angle(1))).toBeLessThan(diff(angle(4), angle(2)));
	});

	it("keeps the centre note in the middle through the simulation", () => {
		const links = Uint32Array.from([0, 1, 0, 2, 0, 3, 1, 4, 2, 5, 3, 6]);
		const n = 7;
		const layout = createLayout({
			n,
			positions: new Float64Array(n * 2),
			sizes: new Float32Array(n).fill(5),
			links,
			params: { style: "rings", spokeLength: 80, splay: 0.5, repel: 1, root: 0, alpha: 1 },
		});
		while (!layout.step(20));
		const p = layout.positions();
		expect(p[0]).toBeCloseTo(0);
		expect(p[1]).toBeCloseTo(0);
		const r = (i: number) => Math.hypot(p[2 * i], p[2 * i + 1]);
		expect(r(4)).toBeGreaterThan(r(1));
	});
});
