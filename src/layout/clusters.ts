import { forceCollide } from "d3-force";

/**
 * Finds clusters (groups of notes linked more among themselves than to the
 * rest) by label propagation: every note starts in its own group, then
 * repeatedly joins the group most of its neighbours are in. Busy notes count
 * for less, so one note linked to everything can't swallow the whole graph.
 * Notes with a single link join their neighbour's group.
 *
 * Returns the group of each note, numbered 0, 1, 2, … from the largest down.
 */
export function findClusters(adj: readonly (readonly number[])[], maxRounds = 15): Int32Array {
	const n = adj.length;
	const label = new Int32Array(n);
	for (let i = 0; i < n; i++) label[i] = i;
	const weight = new Float64Array(n);
	for (let i = 0; i < n; i++) weight[i] = 1 / Math.sqrt(Math.max(1, adj[i].length));

	// A fixed but well-mixed order, so results don't depend on how notes are listed.
	const order: number[] = [];
	for (let i = 0; i < n; i++) if (adj[i].length >= 2) order.push(i);
	order.sort((a, b) => hash(a) - hash(b));

	const score = new Map<number, number>();
	for (let round = 0; round < maxRounds; round++) {
		let moved = 0;
		for (const i of order) {
			score.clear();
			for (const j of adj[i]) score.set(label[j], (score.get(label[j]) ?? 0) + weight[j]);
			let best = label[i];
			let bestScore = score.get(best) ?? 0;
			for (const [l, s] of score) {
				if (s > bestScore + 1e-12 || (Math.abs(s - bestScore) <= 1e-12 && l < best && l !== label[i])) {
					best = l;
					bestScore = s;
				}
			}
			if (best !== label[i]) {
				label[i] = best;
				moved++;
			}
		}
		if (moved <= Math.max(1, order.length * 0.002)) break;
	}
	// Single-link notes sit with their one neighbour.
	for (let i = 0; i < n; i++) if (adj[i].length === 1) label[i] = label[adj[i][0]];

	// Renumber from the largest group down.
	const size = new Map<number, number>();
	for (let i = 0; i < n; i++) size.set(label[i], (size.get(label[i]) ?? 0) + 1);
	const ranked = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
	const renumber = new Map<number, number>();
	ranked.forEach(([l], k) => renumber.set(l, k));
	const out = new Int32Array(n);
	for (let i = 0; i < n; i++) out[i] = renumber.get(label[i])!;
	return out;
}

function hash(i: number): number {
	let h = (i + 0x9e3779b9) | 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
}

interface MovableNode {
	x?: number;
	y?: number;
	vx?: number;
	vy?: number;
	fx?: number | null;
}

interface ClusterBody {
	index: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
}

export interface ClusterForce {
	(alpha: number): void;
	initialize(nodes: MovableNode[]): void;
}

/**
 * Pushes whole clusters apart so they read as separate groups. Each cluster
 * is treated as one round body whose size is measured from where its notes
 * actually are on every step (so the spacing keeps up as the layout grows),
 * plus a gap. Overlapping bodies are pushed apart, and the push is shared by
 * every note in the cluster, so a cluster moves as one without being squashed.
 */
export function forceClusters(
	cluster: Int32Array,
	/** Gap kept between neighbouring clusters. */
	gap: number,
	/** Groups smaller than this are left alone. */
	minSize = 4,
	strength = 0.6,
): ClusterForce {
	let nodes: MovableNode[] = [];
	let members: number[][] = [];
	let bodies: ClusterBody[] = [];
	const collide = forceCollide<ClusterBody>((b) => b.r).strength(strength).iterations(2);

	const force = ((_alpha: number) => {
		if (bodies.length < 2) return;
		// Measure each cluster: its middle, its spread, and how it's moving.
		for (let k = 0; k < bodies.length; k++) {
			const list = members[k];
			let sx = 0;
			let sy = 0;
			let svx = 0;
			let svy = 0;
			for (const i of list) {
				const d = nodes[i];
				sx += d.x ?? 0;
				sy += d.y ?? 0;
				svx += d.vx ?? 0;
				svy += d.vy ?? 0;
			}
			const cx = sx / list.length;
			const cy = sy / list.length;
			let spread = 0;
			for (const i of list) {
				const d = nodes[i];
				spread += ((d.x ?? 0) - cx) ** 2 + ((d.y ?? 0) - cy) ** 2;
			}
			const b = bodies[k];
			b.x = cx;
			b.y = cy;
			b.vx = svx / list.length;
			b.vy = svy / list.length;
			// About the radius that holds most of the cluster's notes, plus the gap.
			b.r = Math.sqrt(spread / list.length) * 1.25 + gap / 2;
		}
		const before = bodies.map((b) => [b.vx, b.vy]);
		collide.radius((b) => b.r);
		collide(1);
		// Share each cluster's push between all of its notes.
		for (let k = 0; k < bodies.length; k++) {
			const dvx = bodies[k].vx - before[k][0];
			const dvy = bodies[k].vy - before[k][1];
			if (dvx === 0 && dvy === 0) continue;
			for (const i of members[k]) {
				const d = nodes[i];
				if (d.fx != null) continue;
				d.vx = (d.vx ?? 0) + dvx;
				d.vy = (d.vy ?? 0) + dvy;
			}
		}
	}) as ClusterForce;

	force.initialize = (all: MovableNode[]) => {
		nodes = all;
		const byCluster = new Map<number, number[]>();
		for (let i = 0; i < all.length && i < cluster.length; i++) {
			const list = byCluster.get(cluster[i]);
			if (list) list.push(i);
			else byCluster.set(cluster[i], [i]);
		}
		members = [...byCluster.values()].filter((list) => list.length >= minSize);
		bodies = members.map((_, index) => ({ index, x: 0, y: 0, vx: 0, vy: 0, r: 1 }));
		collide.initialize(bodies as never, Math.random);
	};

	return force;
}
