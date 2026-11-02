/**
 * The "splay" force: spreads each node's links evenly around it, like the
 * slices of a pie chart, instead of letting them bunch up on one side.
 *
 * For every node with two or more neighbours it sorts the neighbours by
 * angle, works out the evenly spaced arrangement (360° / degree apart) that is
 * closest to the current one, and nudges each neighbour sideways towards its
 * slot. Keeping the existing order means no new crossings are introduced.
 *
 * The nudges around each node are balanced so they add up to zero (they only
 * turn neighbours around the centre, never shove the group sideways), and are
 * capped so far-away or very busy nodes can't build up runaway speed.
 */
export interface SplayNode {
	x?: number;
	y?: number;
	vx?: number;
	vy?: number;
}

export interface SplayForce {
	(alpha: number): void;
	initialize(nodes: SplayNode[]): void;
	strength(): number;
	strength(value: number): SplayForce;
}

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;

function wrapAngle(a: number): number {
	a = (a + Math.PI) % TAU;
	if (a < 0) a += TAU;
	return a - Math.PI;
}

export function forceSplay(
	adjacency: readonly (readonly number[])[],
	initialStrength = 0.3,
	/** Distances beyond this count as this far, so remote neighbours aren't flung around. */
	reach = Infinity,
	minDegree = 2,
): SplayForce {
	let nodes: SplayNode[] = [];
	let strength = initialStrength;
	const degree = adjacency.map((a) => a.length);
	const maxDegree = degree.reduce((m, d) => Math.max(m, d), 0);
	const angle = new Float64Array(maxDegree);
	const dist = new Float64Array(maxDegree);
	const tx = new Float64Array(maxDegree);
	const ty = new Float64Array(maxDegree);
	const order: number[] = new Array(maxDegree).fill(0);
	const byAngle = (p: number, q: number) => angle[p] - angle[q];

	const force = ((alpha: number) => {
		const k0 = strength * alpha;
		if (k0 === 0) return;
		for (let c = 0; c < nodes.length; c++) {
			const nb = adjacency[c];
			const k = nb.length;
			if (k < minDegree) continue;
			const centre = nodes[c];
			const cx = centre.x ?? 0;
			const cy = centre.y ?? 0;

			for (let j = 0; j < k; j++) {
				const n = nodes[nb[j]];
				const dx = (n.x ?? 0) - cx;
				const dy = (n.y ?? 0) - cy;
				angle[j] = Math.atan2(dy, dx);
				dist[j] = Math.min(reach, Math.sqrt(dx * dx + dy * dy));
				order[j] = j;
			}
			const slot = order.slice(0, k).sort(byAngle);

			// Rotation of the even arrangement that best fits the current angles (circular mean).
			const step = TAU / k;
			let sx = 0;
			let sy = 0;
			for (let i = 0; i < k; i++) {
				const off = angle[slot[i]] - i * step;
				sx += Math.cos(off);
				sy += Math.sin(off);
			}
			const phi = Math.atan2(sy, sx);

			let fx = 0;
			let fy = 0;
			for (let i = 0; i < k; i++) {
				const j = slot[i];
				// Capped at a quarter turn per step as a safety net against wild swings.
				const diff = Math.max(-QUARTER, Math.min(QUARTER, wrapAngle(phi + i * step - angle[j])));
				// Leaves follow their only neighbour fully; well-connected nodes are shared between many.
				const weight = 1 / Math.max(1, degree[nb[j]]);
				const mag = diff * dist[j] * k0 * weight;
				tx[j] = -Math.sin(angle[j]) * mag;
				ty[j] = Math.cos(angle[j]) * mag;
				fx += tx[j];
				fy += ty[j];
			}
			// Remove any net push so the group only turns about its centre.
			fx /= k;
			fy /= k;
			for (let j = 0; j < k; j++) {
				const n = nodes[nb[j]];
				n.vx = (n.vx ?? 0) + tx[j] - fx;
				n.vy = (n.vy ?? 0) + ty[j] - fy;
			}
		}
	}) as SplayForce;

	force.initialize = (n: SplayNode[]) => {
		nodes = n;
	};
	force.strength = ((value?: number) => {
		if (value === undefined) return strength;
		strength = value;
		return force;
	}) as SplayForce["strength"];

	return force;
}

/**
 * How evenly spread a node's links are: 1 means perfectly even, 0 means all
 * links point the same way. Averaged over nodes with at least `minDegree` links.
 */
export function splayScore(
	positions: ArrayLike<number>,
	adjacency: readonly (readonly number[])[],
	minDegree = 3,
): number {
	let total = 0;
	let count = 0;
	for (let c = 0; c < adjacency.length; c++) {
		const nb = adjacency[c];
		if (nb.length < minDegree) continue;
		let sx = 0;
		let sy = 0;
		for (const j of nb) {
			const a = Math.atan2(positions[2 * j + 1] - positions[2 * c + 1], positions[2 * j] - positions[2 * c]);
			sx += Math.cos(a);
			sy += Math.sin(a);
		}
		// Length of the mean direction vector: 1 = all one way, 0 = balanced.
		total += 1 - Math.sqrt(sx * sx + sy * sy) / nb.length;
		count++;
	}
	return count === 0 ? 1 : total / count;
}
