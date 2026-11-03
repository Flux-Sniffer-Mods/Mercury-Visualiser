import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceRadial,
	forceSimulation,
	forceX,
	forceY,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from "d3-force";
import { findClusters, forceClusters } from "./clusters";
import { forceSplay } from "./splayForce";
import { buildAdjacency, radialTree } from "./radialTree";

export type LayoutStyle = "spokes" | "rings";

export interface LayoutParams {
	style: LayoutStyle;
	/** Preferred length of each link. */
	spokeLength: number;
	/** 0–1: how hard links are pushed into evenly spaced, pie-slice directions. */
	splay: number;
	/** Multiplier on how strongly unrelated notes push each other apart. */
	repel: number;
	/** Dynamic spacing: find clusters and keep a gap between them that grows with their size. */
	clusters?: boolean;
	/** Index of the centre node for the "rings" style (-1 picks the best-connected node). */
	root: number;
	/** 1 = lay out from scratch, lower values = adjust the current layout gently. */
	alpha: number;
}

export interface LayoutInput {
	n: number;
	/** x0, y0, x1, y1, ... */
	positions: Float64Array;
	/** Display radius of each node. */
	sizes: Float32Array;
	/** Pairs of node indices. */
	links: Uint32Array;
	/** 1 = keep this node exactly where it is (used to settle in a few changed notes). */
	fixed?: Uint8Array;
	params: LayoutParams;
}

interface Node extends SimulationNodeDatum {
	index: number;
	r: number;
}

export interface Layout {
	/** Runs up to `ticks` steps. Returns true once the layout has settled. */
	step(ticks: number): boolean;
	/** Progress from 0 to 1. */
	progress(): number;
	positions(): Float64Array;
}

const ALPHA_MIN = 0.002;
/** Gap between clusters with dynamic spacing, in link lengths (scaled by √Spacing). */
const CLUSTER_GAP = 0.7;
const CLUSTER_STRENGTH = 0.6;
/** Roughly how many steps a layout takes from a standing start. */
const TARGET_TICKS = 160;

interface Force<N> {
	(alpha: number): void;
	initialize?(nodes: N[], random: () => number): void;
}

/**
 * Runs an expensive force every `every` steps (with its push scaled up to
 * match), optionally on only some of the nodes. Used to keep big vaults fast.
 */
function throttled<N>(force: Force<N>, every: number, scaleAlpha: boolean, include?: (n: N) => boolean): Force<N> {
	let tick = 0;
	const wrapped: Force<N> = (alpha: number) => {
		if (tick++ % every === 0) force(scaleAlpha ? alpha * every : alpha);
	};
	wrapped.initialize = (nodes, random) => force.initialize?.(include ? nodes.filter(include) : nodes, random);
	return wrapped;
}

export function pickRoot(adj: readonly (readonly number[])[]): number {
	let best = 0;
	for (let i = 1; i < adj.length; i++) if (adj[i].length > adj[best].length) best = i;
	return best;
}

export function createLayout(input: LayoutInput): Layout {
	const { n, params } = input;
	const L = Math.max(10, params.spokeLength);
	const adj = buildAdjacency(n, input.links);
	const degree = adj.map((a) => a.length);
	const rings = params.style === "rings";

	const nodes: Node[] = new Array(n);
	for (let i = 0; i < n; i++) {
		nodes[i] = {
			index: i,
			x: input.positions[2 * i],
			y: input.positions[2 * i + 1],
			r: Math.max(1, input.sizes[i] || 1),
		};
	}

	// Unique undirected links.
	const seen = new Set<number>();
	const links: SimulationLinkDatum<Node>[] = [];
	for (let i = 0; i + 1 < input.links.length; i += 2) {
		const a = input.links[i];
		const b = input.links[i + 1];
		if (a === b || a >= n || b >= n) continue;
		const key = a < b ? a * n + b : b * n + a;
		if (seen.has(key)) continue;
		seen.add(key);
		links.push({ source: a, target: b });
	}

	// Place nodes without a usable position next to a placed neighbour.
	for (const node of nodes) {
		if (Number.isFinite(node.x) && Number.isFinite(node.y)) continue;
		const placed = adj[node.index].map((j) => nodes[j]).find((m) => Number.isFinite(m.x) && Number.isFinite(m.y));
		const angle = Math.random() * Math.PI * 2;
		node.x = (placed?.x ?? 0) + Math.cos(angle) * L;
		node.y = (placed?.y ?? 0) + Math.sin(angle) * L;
	}

	const sim: Simulation<Node, SimulationLinkDatum<Node>> = forceSimulation(nodes).stop();
	const startAlpha = Math.max(ALPHA_MIN * 2, Math.min(1, params.alpha));
	// Gentle adjustments settle in fewer steps than a layout from scratch.
	const targetTicks = startAlpha < 0.5 ? Math.round(TARGET_TICKS * 0.5) : TARGET_TICKS;
	sim.alpha(startAlpha)
		.alphaMin(ALPHA_MIN)
		.alphaDecay(1 - Math.pow(ALPHA_MIN / startAlpha, 1 / targetTicks))
		.velocityDecay(0.45);
	// Big graphs run the costly forces less often.
	const heavy = n > 1500;

	// Repulsion scales with the square of the link length so the shape is the same at any size.
	const charge = -((L * L) / 30) * 0.6 * params.repel;
	const splay = Math.max(0, Math.min(1, params.splay)) * 0.5;

	sim.force(
		"link",
		forceLink<Node, SimulationLinkDatum<Node>>(links)
			.distance(L)
			.strength((l) => {
				const s = (l.source as Node).index;
				const t = (l.target as Node).index;
				return (rings ? 0.35 : 1) / Math.max(1, Math.min(degree[s], degree[t]));
			}),
	);
	// Notes with a single link are placed by the splay around their one neighbour,
	// so they sit out the (expensive) all-pairs repulsion.
	sim.force(
		"charge",
		throttled<Node>(
			forceManyBody<Node>()
				.strength(rings ? charge * 0.35 : charge)
				.theta(0.95)
				.distanceMax(L * 12),
			heavy ? 2 : 1,
			true,
			(d) => degree[d.index] !== 1,
		),
	);
	sim.force(
		"collide",
		throttled<Node>(
			forceCollide<Node>((d) => d.r * 1.6 + L * 0.04)
				.strength(0.7)
				.iterations(1),
			heavy ? 2 : 1,
			false,
		),
	);
	if (splay > 0) sim.force("splay", forceSplay(adj, rings ? splay * 0.5 : splay, L * 2));
	// Dynamic spacing: whole clusters keep apart, by a gap that follows the Spacing setting.
	// (Not while settling in a few changed notes with the rest held still: the push is for whole clusters.)
	if (params.clusters && !rings && !input.fixed) {
		const gap = L * CLUSTER_GAP * Math.sqrt(Math.max(0.2, params.repel));
		sim.force("clusters", forceClusters(findClusters(adj), { linkLength: L, gap, strength: CLUSTER_STRENGTH }));
	}

	if (rings) {
		const root = params.root >= 0 && params.root < n ? params.root : pickRoot(adj);
		const avgSize = nodes.reduce((s, d) => s + d.r, 0) / Math.max(1, n);
		const tree = radialTree(n, adj, root, L, Math.max(avgSize * 4, L * 0.12));
		if (params.alpha >= 0.5) {
			for (let i = 0; i < n; i++) {
				nodes[i].x = tree.positions[2 * i];
				nodes[i].y = tree.positions[2 * i + 1];
				nodes[i].vx = 0;
				nodes[i].vy = 0;
			}
		}
		nodes[root].fx = 0;
		nodes[root].fy = 0;
		sim.force("rings", forceRadial<Node>((d) => tree.radius[d.index], 0, 0).strength(0.8));
	} else {
		// A gentle pull to the middle so separate clusters and loose notes stay in view.
		// Single-link notes are left out: they should sit around their neighbour, not lean inwards.
		const pull = (d: Node) => (degree[d.index] === 1 ? 0 : 0.012);
		sim.force("x", forceX<Node>(0).strength(pull));
		sim.force("y", forceY<Node>(0).strength(pull));
	}

	if (input.fixed) {
		for (let i = 0; i < n; i++) {
			if (input.fixed[i] && Number.isFinite(nodes[i].x) && Number.isFinite(nodes[i].y)) {
				nodes[i].fx = nodes[i].x;
				nodes[i].fy = nodes[i].y;
			}
		}
	}

	const totalTicks = Math.ceil(Math.log(ALPHA_MIN / startAlpha) / Math.log(1 - sim.alphaDecay()));
	let ticks = 0;

	return {
		step(count: number): boolean {
			for (let i = 0; i < count && sim.alpha() >= ALPHA_MIN; i++) {
				sim.tick();
				ticks++;
			}
			return sim.alpha() < ALPHA_MIN;
		},
		progress(): number {
			return Math.min(1, ticks / Math.max(1, totalTicks));
		},
		positions(): Float64Array {
			const out = new Float64Array(n * 2);
			for (let i = 0; i < n; i++) {
				out[2 * i] = nodes[i].x ?? 0;
				out[2 * i + 1] = nodes[i].y ?? 0;
			}
			return out;
		},
	};
}
