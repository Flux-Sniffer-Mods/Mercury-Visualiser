/**
 * Starting positions for the "rings" style: a radial tree. The centre note
 * sits in the middle, its links on the first ring, their links on the next,
 * and every branch gets its own pie-slice of the circle sized by how much
 * hangs off it. Notes not connected to the centre form an outer belt, each
 * cluster in its own slice.
 */
export interface RadialTree {
	depth: Int32Array;
	/** Ring radius for each node. */
	radius: Float64Array;
	positions: Float64Array;
}

export function buildAdjacency(n: number, links: ArrayLike<number>): number[][] {
	const adj: number[][] = Array.from({ length: n }, () => []);
	for (let i = 0; i + 1 < links.length; i += 2) {
		const a = links[i];
		const b = links[i + 1];
		if (a === b || a >= n || b >= n) continue;
		adj[a].push(b);
		adj[b].push(a);
	}
	return adj;
}

export function radialTree(
	n: number,
	adj: readonly (readonly number[])[],
	root: number,
	ringGap: number,
	nodeSpacing: number,
): RadialTree {
	const depth = new Int32Array(n).fill(-1);
	const parent = new Int32Array(n).fill(-1);
	const bfsOrder: number[] = [];
	const children: number[][] = Array.from({ length: n }, () => []);

	const bfs = (start: number, baseDepth: number) => {
		depth[start] = baseDepth;
		const queue = [start];
		for (let q = 0; q < queue.length; q++) {
			const v = queue[q];
			bfsOrder.push(v);
			// Visit better-connected neighbours first so big branches sit together.
			const nb = [...adj[v]].sort((p, q2) => adj[q2].length - adj[p].length);
			for (const w of nb) {
				if (depth[w] !== -1) continue;
				depth[w] = depth[v] + 1;
				parent[w] = v;
				children[v].push(w);
				queue.push(w);
			}
		}
	};

	const safeRoot = root >= 0 && root < n ? root : 0;
	const componentRoots: number[] = [];
	if (n > 0) {
		bfs(safeRoot, 0);
		componentRoots.push(safeRoot);
	}
	const mainMax = bfsOrder.reduce((m, v) => Math.max(m, depth[v]), 0);

	// Remaining clusters, largest hub first, start on the ring just outside the main tree.
	const rest = [];
	for (let v = 0; v < n; v++) if (depth[v] === -1) rest.push(v);
	rest.sort((p, q) => adj[q].length - adj[p].length);
	const outerRoots: number[] = [];
	for (const v of rest) {
		if (depth[v] !== -1) continue;
		bfs(v, mainMax + 1);
		outerRoots.push(v);
	}

	// Subtree sizes (children before parents = reverse BFS order).
	const size = new Float64Array(n).fill(1);
	for (let i = bfsOrder.length - 1; i >= 0; i--) {
		const v = bfsOrder[i];
		if (parent[v] !== -1) size[parent[v]] += size[v];
	}

	// Ring radii: at least one gap apart, and wide enough for the nodes on them.
	const maxDepth = depth.reduce((m, d) => Math.max(m, d), 0);
	const perRing = new Float64Array(maxDepth + 1);
	for (let v = 0; v < n; v++) perRing[depth[v]]++;
	const ringRadius = new Float64Array(maxDepth + 1);
	for (let d = 1; d <= maxDepth; d++) {
		const needed = (perRing[d] * nodeSpacing) / (Math.PI * 2);
		ringRadius[d] = Math.max(ringRadius[d - 1] + ringGap, needed);
	}
	if (outerRoots.length > 0 && maxDepth >= mainMax + 1) {
		// Leave a clear gap between the main tree and the outer belt.
		const shift = ringGap * 0.5;
		for (let d = mainMax + 1; d <= maxDepth; d++) ringRadius[d] += shift;
	}

	// Angular wedges.
	const start = new Float64Array(n);
	const span = new Float64Array(n);
	const assign = (v: number) => {
		let a = start[v];
		const kids = children[v];
		const total = kids.reduce((s, c) => s + size[c], 0);
		for (const c of kids) {
			start[c] = a;
			span[c] = (span[v] * size[c]) / total;
			a += span[c];
		}
	};
	if (n > 0) {
		start[safeRoot] = 0;
		span[safeRoot] = Math.PI * 2;
	}
	const outerTotal = outerRoots.reduce((s, r) => s + size[r], 0);
	let a = 0;
	for (const r of outerRoots) {
		start[r] = a;
		span[r] = (Math.PI * 2 * size[r]) / outerTotal;
		a += span[r];
	}
	for (const v of bfsOrder) assign(v);

	const positions = new Float64Array(n * 2);
	const radius = new Float64Array(n);
	for (let v = 0; v < n; v++) {
		const r = ringRadius[depth[v]];
		const theta = start[v] + span[v] / 2;
		radius[v] = r;
		positions[2 * v] = r * Math.cos(theta);
		positions[2 * v + 1] = r * Math.sin(theta);
	}
	return { depth, radius, positions };
}
