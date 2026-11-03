import { around } from "monkey-around";
import { cssColourToRgbInt } from "../colour/colour";
import type { MercurySettings } from "../settings";
import type { LayoutCache } from "../layout/layoutCache";
import type { LayoutHandle, LayoutRunner } from "../layout/layoutRunner";
import type { LayoutInput } from "../layout/simulation";
import type { Slice } from "../tags/slices";
import {
	backgroundColourOf,
	engineOf,
	highlightOf,
	labelFade,
	type CoreGraphNode,
	type CoreGraphRenderer,
	type CoreGraphView,
	type GraphKind,
	type PixiGraphics,
} from "./internals";
import { DetailLayer } from "./detailLayer";
import { LinkLabelLayer } from "./linkLabelLayer";
import { circleShape, drawnCircles, drawPie, drawRing, graphicsConstructorOf, PIE_NAME } from "./pie";
import { GraphToolbar, type Feature } from "./toolbar";

export interface ControllerHost {
	settings: MercurySettings;
	layout: LayoutRunner;
	/** Remembers the main graph's layout between sessions. */
	layoutCache?: LayoutCache;
	slicesFor(path: string): Slice[];
	colourForTag(tag: string): number | null;
	/** Label for the line between two graph nodes (from the notes' listings), or null. */
	linkLabel(sourceId: string, targetId: string): string | null;
	/** Changes whenever link labels may have changed. */
	labelsVersion(): number;
	/** The colour of the listing a line comes from, weighted to its main tags. */
	listingColour(sourceId: string, targetId: string): number | null;
	/** Link distance from the Graph view's own "Forces" settings. */
	graphLinkDistance(view: CoreGraphView): number | null;
	toggleFeature(feature: Feature): void;
	rerunLayout(view?: CoreGraphView): void;
}

interface PieState {
	version: number;
	circle: PixiGraphics | null;
	g: PixiGraphics | null;
	sig: string;
}

/** Roughly how many node positions per second are streamed into the Graph view while a layout animates. */
const PINS_PER_SECOND = 6000;
/** While a layout animates, notes that moved less than this (graph units) since their last pin aren't sent again. */
const PIN_MIN_MOVE = 1.5;

/**
 * Attaches to one core Graph view (global or local) and layers the three
 * features on top of Obsidian's own renderer:
 * - pie-chart wedges drawn on each node circle,
 * - a radial layout whose positions are pinned into the Graph view's physics,
 * - the toolbar of on/off buttons.
 */
export class GraphController {
	readonly renderer: CoreGraphRenderer;
	private unpatch: Array<() => void> = [];
	private destroyed = false;

	// Pies
	private pies = new WeakMap<CoreGraphNode, PieState>();
	private pieNodes = new Set<CoreGraphNode>();
	private pieVersion = 1;
	private outline: number | null = null;
	private graphicsUnsupported = false;
	/** Current zoom fade for slices (0 hidden … 1 shown). */
	private pieFade = 1;
	/** What the slices were last faded for, so unchanged frames can skip the work. */
	private fadedFor: { base: number; highlight: CoreGraphNode | null; pies: number; version: number } | null = null;
	/** What the last full pie check saw, so quiet frames can skip it. */
	private syncedFor: { version: number; nodes: unknown; length: number } | null = null;
	private syncFrame = 0;

	// Radial layout
	private job: LayoutHandle | null = null;
	private pinned = new Set<string>();
	private lastSignature = "";
	/** Links (as "idA\0idB") the last layout was made with, to spot what an edit changed. */
	private prevLinks: Set<string> | null = null;
	private layoutTimer: number | null = null;
	private lastApplied = 0;
	/** Where each pinned note was last sent. */
	private pinnedAt = new Map<string, [number, number]>();
	private dragNode: CoreGraphNode | null = null;

	private toolbar: GraphToolbar | null = null;
	private labels: LinkLabelLayer | null = null;
	private detail: DetailLayer | null = null;
	private accent = 0x8a5cf5;

	constructor(
		readonly view: CoreGraphView,
		readonly kind: GraphKind,
		private host: ControllerHost,
	) {
		this.renderer = view.renderer as CoreGraphRenderer;
	}

	attach(): void {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const controller = this;
		this.unpatch.push(
			around(this.renderer as unknown as Record<string, (...args: unknown[]) => unknown>, {
				renderCallback(next) {
					return function (this: unknown, ...args: unknown[]) {
						const result = next.apply(this, args);
						controller.afterRender();
						return result;
					};
				},
				setData(next) {
					return function (this: unknown, ...args: unknown[]) {
						const result = next.apply(this, args);
						controller.onData();
						return result;
					};
				},
			}),
		);
		const host = this.host;
		this.toolbar = new GraphToolbar(
			this.view.contentEl,
			{
				get settings() {
					return host.settings;
				},
				toggleFeature: (feature) => host.toggleFeature(feature),
				// The toolbar's re-run button only re-lays out its own graph.
				rerunLayout: () => host.rerunLayout(this.view),
			},
			() => this.radialApplies(),
		);
		const s = () => host.settings;
		this.labels = new LinkLabelLayer(this.renderer, {
			enabled: () => s().linkLabels,
			maxLabels: () => s().linkLabelMax,
			placement: () => s().linkLabelPlacement,
			label: (a, b) => host.linkLabel(a, b),
			version: () => host.labelsVersion(),
			labelColourMode: () => (!s().linkLabelColours ? "off" : s().linkLabelColourBy),
			colourOf: (node) => this.mapColour(node),
			listingColour: (a, b) => host.listingColour(a, b),
		});
		this.detail = new DetailLayer(this.renderer, {
			culling: () => s().levelOfDetail && s().lodCulling,
			densityMap: () => s().levelOfDetail && s().lodDensityMap,
			mapBelowPx: () => s().lodMapBelowPx,
			densityStyle: () => s().lodDensityStyle,
			softness: () => s().lodMapSoftness,
			thinning: () => s().levelOfDetail && s().lodThinOut,
			thinAmount: () => s().lodThinAmount,
			nodeColour: (node) => this.mapColour(node),
			accent: () => this.accent,
			colourVersion: () => this.pieVersion,
		});
		this.refreshTheme();
		this.update();
	}

	/** Asks the Graph view to draw a fresh frame (e.g. after labels changed). */
	requestRedraw(): void {
		if (!this.destroyed) this.renderer.changed?.();
	}

	/** A node's colour on the density map: its pie slices mixed, or null for the Graph view's own colour. */
	private mapColour(node: CoreGraphNode): number | null {
		const slices = this.slicesFor(node)?.slices;
		if (!slices || slices.length === 0) return null;
		let r = 0;
		let g = 0;
		let b = 0;
		let w = 0;
		for (const sl of slices) {
			r += sl.weight * ((sl.rgb >> 16) & 255);
			g += sl.weight * ((sl.rgb >> 8) & 255);
			b += sl.weight * (sl.rgb & 255);
			w += sl.weight;
		}
		return (Math.round(r / w) << 16) | (Math.round(g / w) << 8) | Math.round(b / w);
	}

	detach(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.cancelLayout();
		this.unpinAll();
		this.removeAllPies();
		this.labels?.destroy();
		this.labels = null;
		this.detail?.destroy();
		this.detail = null;
		for (const undo of this.unpatch) undo();
		this.unpatch = [];
		this.toolbar?.destroy();
		this.toolbar = null;
		this.renderer.changed?.();
	}

	/** Re-reads settings: call after any toggle or option changes. */
	update(): void {
		if (this.destroyed) return;
		this.toolbar?.update();
		this.invalidatePies();
		if (this.radialApplies()) {
			if (this.pinned.size === 0 && !this.job) this.scheduleLayout(50, true);
		} else {
			this.cancelLayout();
			this.unpinAll();
		}
	}

	refreshTheme(): void {
		const css = backgroundColourOf(this.view.contentEl);
		this.outline = cssColourToRgbInt(css) ?? 0x1e1e1e;
		const accent = getComputedStyle(this.view.contentEl).getPropertyValue("--interactive-accent").trim();
		this.accent = cssColourToRgbInt(accent) ?? this.accent;
		this.invalidatePies();
	}

	// ---------------------------------------------------------------- hooks

	/** Safety net in case the render hook is bypassed: called about once a second. */
	tick(): void {
		if (!this.destroyed) this.syncPies();
	}

	private afterRender(): void {
		if (this.destroyed) return;
		this.syncPies();
		this.trackDrag();
		let more = this.fadePies();
		try {
			more = this.labels?.update() ?? false;
		} catch (e) {
			console.warn("Mercury Visualiser: link labels stopped", e);
			this.labels?.destroy();
			this.labels = null;
		}
		try {
			more = (this.detail?.update() ?? false) || more;
		} catch (e) {
			console.warn("Mercury Visualiser: level of detail stopped", e);
			this.detail?.destroy();
			this.detail = null;
		}
		if (more) this.renderer.changed();
	}

	private onData(): void {
		if (this.destroyed) return;
		// New data may mean new notes in the Graph view's physics: send every position again next time.
		this.pinnedAt.clear();
		this.invalidatePies();
		// Forget pie bookkeeping for nodes that left the graph.
		const live = new Set(this.renderer.nodes);
		for (const node of this.pieNodes) {
			if (!live.has(node)) {
				const st = this.pies.get(node);
				if (st?.g) this.destroyPie(st.g);
				this.pies.delete(node);
				this.pieNodes.delete(node);
			}
		}
		if (this.radialApplies()) this.scheduleLayout(400, false);
	}

	// ----------------------------------------------------------------- pies

	invalidatePies(): void {
		this.pieVersion++;
		this.renderer.changed?.();
	}

	private slicesFor(node: CoreGraphNode): { slices: Slice[]; min: number } | null {
		const s = this.host.settings;
		if (node.type === "tag") {
			if (!s.pieTagNodes) return null;
			const rgb = this.host.colourForTag(node.id);
			return rgb === null ? null : { slices: [{ rgb, weight: 1 }], min: 1 };
		}
		if (node.type !== "" && node.type !== "focused") return null;
		return { slices: this.host.slicesFor(node.id), min: s.pieMinColours };
	}

	private syncPies(): void {
		const enabled = this.host.settings.pieNodes && !this.graphicsUnsupported;
		if (!enabled && this.pieNodes.size === 0) return;
		const version = this.pieVersion;
		// Nothing changed since the last full check: only look again every so often,
		// in case the Graph view rebuilt some dots on its own.
		const nodes = this.renderer.nodes;
		const s = this.syncedFor;
		if (s && s.version === version && s.nodes === nodes && s.length === nodes.length && ++this.syncFrame % 12 !== 0) return;
		this.syncedFor = { version, nodes, length: nodes.length };
		let drew = false;
		for (const node of this.renderer.nodes) {
			const st = this.pies.get(node);
			const circle = node.circle;
			if (st && st.version === version && st.circle === circle && (!st.g || st.g.parent === circle)) continue;
			drew = this.updatePie(node, st, enabled, version) || drew;
		}
		if (drew) this.renderer.changed();
	}

	/** Returns true when something was drawn or removed. */
	private updatePie(node: CoreGraphNode, st: PieState | undefined, enabled: boolean, version: number): boolean {
		const circle = node.circle;
		const wanted = enabled && circle ? this.slicesFor(node) : null;
		const slices = wanted && wanted.slices.length >= wanted.min ? wanted.slices : null;

		if (!slices || !circle) {
			const had = !!st?.g;
			if (st?.g) this.destroyPie(st.g);
			this.pies.set(node, { version, circle, g: null, sig: "" });
			this.pieNodes.delete(node);
			return had;
		}

		const s = this.host.settings;
		const focused = node.type === "focused";
		const sig = `${slices.map((x) => `${x.rgb}:${x.weight}`).join(",")}|${focused}|${s.pieWeighted}|${s.pieOutline ? this.outline : "-"}|${s.pieStyle}`;
		if (st && st.g && st.circle === circle && st.sig === sig && st.g.parent === circle && !st.g.destroyed) {
			st.version = version;
			return false;
		}
		if (st?.g) this.destroyPie(st.g);

		const Graphics = graphicsConstructorOf(circle);
		if (!Graphics) {
			this.graphicsUnsupported = true;
			console.warn("Mercury Visualiser: this version of the Graph view can't be drawn on; pie-chart nodes are off.");
			return false;
		}
		const g = new Graphics();
		g.name = PIE_NAME;
		if ("eventMode" in g) g.eventMode = "none";
		else g.interactive = false;
		const shape = circleShape(circle, this.noteCentreIn(node, circle));
		const style = { weighted: s.pieWeighted, outline: s.pieOutline ? this.outline : null };
		if (s.pieStyle === "ring") drawRing(g, slices, shape.radius, style);
		// The current note keeps a ring of its highlight colour around the pie.
		else drawPie(g, slices, focused ? shape.radius * 0.7 : shape.radius, style);
		g.position?.set(shape.x, shape.y);
		g.alpha = this.pieFade;
		circle.addChild(g);
		this.pies.set(node, { version, circle, g, sig });
		this.pieNodes.add(node);
		return true;
	}

	/**
	 * Where the note sits (its position in the graph's physics) in its dot's own
	 * coordinates. The Graph view always draws the dot centred there.
	 */
	private noteCentreIn(node: CoreGraphNode, circle: PixiGraphics): { x: number; y: number } | null {
		if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
		// Usually the dot sits straight in the graph's layer: work it out from the dot's own
		// position, scale and pivot. (Its on-screen transform goes stale while it's off screen.)
		const c = circle as unknown as {
			parent?: unknown;
			x?: number;
			y?: number;
			rotation?: number;
			scale?: { x: number; y: number };
			pivot?: { x: number; y: number };
		};
		if (c.parent === (this.renderer.hanger as unknown) && c.scale && Math.abs(c.rotation ?? 0) < 1e-9) {
			const sx = c.scale.x;
			const sy = c.scale.y;
			if (sx !== 0 && sy !== 0 && Number.isFinite(c.x) && Number.isFinite(c.y)) {
				return {
					x: (node.x - (c.x ?? 0)) / sx + (c.pivot?.x ?? 0),
					y: (node.y - (c.y ?? 0)) / sy + (c.pivot?.y ?? 0),
				};
			}
		}
		const hm = this.renderer.hanger?.worldTransform;
		const cm = circle.worldTransform;
		if (!hm || !cm || circle.visible === false) return null;
		try {
			const p = cm.applyInverse({ x: hm.a * node.x + hm.c * node.y + hm.tx, y: hm.b * node.x + hm.d * node.y + hm.ty });
			return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
		} catch {
			return null;
		}
	}

	/**
	 * Fades slices in and out with zoom, together with note names. The hovered
	 * note and its neighbours always show theirs. Returns true if anything changed.
	 */
	private fadePies(): boolean {
		if (this.pieNodes.size === 0) return false;
		const base = this.host.settings.pieFade ? labelFade(this.renderer) : 1;
		this.pieFade = base;
		const hl = highlightOf(this.renderer);
		const f = this.fadedFor;
		if (f && Math.abs(f.base - base) < 0.005 && f.highlight === hl && f.pies === this.pieNodes.size && f.version === this.pieVersion) {
			return false;
		}
		this.fadedFor = { base, highlight: hl, pies: this.pieNodes.size, version: this.pieVersion };
		const near = new Set<string>();
		if (hl) {
			near.add(hl.id);
			for (const id of Object.keys(hl.forward ?? {})) near.add(id);
			for (const id of Object.keys(hl.reverse ?? {})) near.add(id);
		}
		let changed = false;
		for (const node of this.pieNodes) {
			const g = this.pies.get(node)?.g;
			if (!g) continue;
			const a = near.has(node.id) ? 1 : base;
			if (Math.abs((g.alpha ?? 1) - a) > 0.01) {
				g.alpha = a;
				changed = true;
			}
		}
		return changed;
	}

	/** A plain-text report of how this Graph view draws its dots, for troubleshooting. */
	diagnostics(): string {
		const r = this.renderer as unknown as Record<string, unknown> & CoreGraphRenderer;
		const n3 = (v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
		const pt = (p: unknown) => {
			const q = p as { x?: number; y?: number } | null | undefined;
			return q ? `${n3(q.x)},${n3(q.y)}` : "-";
		};
		const m = (t: unknown) => {
			const w = t as { a: number; b: number; c: number; d: number; tx: number; ty: number } | undefined;
			return w ? `a=${n3(w.a)} b=${n3(w.b)} c=${n3(w.c)} d=${n3(w.d)} tx=${n3(w.tx)} ty=${n3(w.ty)}` : "-";
		};
		const out: string[] = [];
		const hanger = r.hanger as unknown as (Record<string, unknown> & { children?: unknown[] }) | undefined;
		out.push(`view=${this.kind} nodes=${r.nodes.length} links=${r.links.length} pies=${this.pieNodes.size}`);
		out.push(
			`renderer: scale=${n3(r.scale)} nodeScale=${n3(r.nodeScale)} fNodeSizeMult=${n3(r.fNodeSizeMult)} textAlpha=${n3(r.textAlpha)} panX=${n3(r.panX)} panY=${n3(r.panY)}`,
		);
		out.push(`hanger: children=${hanger?.children?.length ?? "-"} world: ${m(hanger?.worldTransform)}`);

		// Prefer notes on screen: Obsidian hides the rest, and their numbers go stale.
		const all = r.nodes.filter((n) => (n.type === "" || n.type === "focused") && n.circle);
		const onScreen = all.filter((n) => n.circle?.visible !== false);
		const files = onScreen.length >= 3 ? onScreen : all;
		const byWeight = [...files].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
		const pieOnScreen = [...this.pieNodes].find((n) => n.circle?.visible !== false) ?? [...this.pieNodes][0];
		const samples = [byWeight[0], pieOnScreen, byWeight[byWeight.length - 1]].filter(
			(n, i, all): n is CoreGraphNode => !!n && all.indexOf(n) === i,
		);
		for (const node of samples) {
			const c = node.circle as unknown as Record<string, unknown> & PixiGraphics;
			const pie = this.pies.get(node)?.g ?? null;
			out.push("");
			out.push(`node "${node.id.replace(/^.*\//, "").replace(/\.md$/, "")}" type=${node.type || "file"} weight=${node.weight} size=${n3(node.getSize?.())} at ${n3(node.x)},${n3(node.y)}`);
			out.push(
				`  dot: class=${c.constructor?.name ?? "?"} parent=${c.parent === (r.hanger as unknown) ? "hanger" : "other"} pos=${pt(c.position ?? c)} scale=${pt(c.scale)} pivot=${pt(c.pivot)} rot=${n3(c.rotation)} alpha=${n3(c.alpha)} visible=${c.visible}`,
			);
			out.push(`  dot world: ${m(c.worldTransform)}`);
			const kids = (c.children ?? []).map((k) => {
				const kk = k as unknown as Record<string, unknown> & { constructor?: { name?: string } };
				return `${kk.constructor?.name ?? "?"}${kk === (pie as unknown) ? "(our pie)" : ""}${kk.name ? `[${String(kk.name)}]` : ""}${kk.visible === false ? "(hidden)" : ""}`;
			});
			out.push(`  dot children: ${kids.length ? kids.join(", ") : "none"}`);
			(c.geometry?.graphicsData ?? []).slice(0, 4).forEach((d, i) => {
				const sh = d.shape ?? {};
				out.push(
					`  shape ${i}: type=${sh.type} x=${n3(sh.x)} y=${n3(sh.y)} r=${n3(sh.radius)} w=${n3(sh.width)} h=${n3(sh.height)} fill=${d.fillStyle?.visible}/${n3(d.fillStyle?.alpha)} line=${d.lineStyle?.visible}/${n3(d.lineStyle?.width)}`,
				);
			});
			try {
				const b = c.geometry?.bounds;
				out.push(`  geometry bounds: ${b ? `${n3(b.minX)},${n3(b.minY)} → ${n3(b.maxX)},${n3(b.maxY)}` : "-"}`);
			} catch {
				out.push("  geometry bounds: error");
			}
			const wasVisible = pie?.visible;
			if (pie) pie.visible = false;
			try {
				const lb = c.getLocalBounds?.();
				out.push(`  local bounds (no pie): ${lb ? `${n3(lb.x)},${n3(lb.y)} ${n3(lb.width)}×${n3(lb.height)}` : "-"}`);
			} catch {
				out.push("  local bounds: error");
			}
			if (pie) pie.visible = wasVisible ?? true;
			const centre = this.noteCentreIn(node, c);
			out.push(`  note centre in dot: ${pt(centre)}  drawn circles: ${drawnCircles(c).map((x) => `${n3(x.x)},${n3(x.y)} r${n3(x.radius)}`).join(" | ") || "none"}`);
			const shape = circleShape(c, centre);
			out.push(`  pie placed at: ${n3(shape.x)},${n3(shape.y)} r=${n3(shape.radius)}${pie ? ` (now ${pt(pie.position ?? pie)})` : ""}`);
			const t = node.text as unknown as (Record<string, unknown> & { parent?: unknown }) | null | undefined;
			if (t) out.push(`  label: parent=${t.parent === c ? "dot" : t.parent === (r.hanger as unknown) ? "hanger" : "other"} pos=${pt(t.position ?? t)} scale=${pt(t.scale)} alpha=${n3(t.alpha)}`);
		}
		return out.join("\n");
	}

	private destroyPie(g: PixiGraphics): void {
		try {
			g.parent?.removeChild(g);
			if (!g.destroyed) g.destroy();
		} catch {
			/* already gone with its node */
		}
	}

	private removeAllPies(): void {
		for (const node of this.pieNodes) {
			const st = this.pies.get(node);
			if (st?.g) this.destroyPie(st.g);
			this.pies.delete(node);
		}
		this.pieNodes.clear();
	}

	// --------------------------------------------------------------- radial

	radialApplies(): boolean {
		const s = this.host.settings;
		return s.radialLayout && (this.kind === "graph" ? s.radialGlobalGraph : s.radialLocalGraph);
	}

	isLayoutRunning(): boolean {
		return this.job !== null;
	}

	scheduleLayout(delay: number, force: boolean): void {
		if (this.layoutTimer !== null) window.clearTimeout(this.layoutTimer);
		this.layoutTimer = window.setTimeout(() => {
			this.layoutTimer = null;
			this.runLayout(force);
		}, delay);
	}

	private signature(nodes: readonly CoreGraphNode[]): string {
		let h = 0;
		for (const n of nodes) for (let i = 0; i < n.id.length; i++) h = (h * 31 + n.id.charCodeAt(i)) | 0;
		return `${nodes.length}:${this.renderer.links.length}:${h}`;
	}

	/** Lays the graph out radially. `fresh` starts from scratch instead of adjusting the current shape. */
	runLayout(force: boolean, fresh = false): void {
		if (this.destroyed || !this.radialApplies()) return;
		const nodes = this.renderer.nodes.slice();
		if (nodes.length === 0) {
			// The graph hasn't loaded its data yet.
			this.scheduleLayout(500, force);
			return;
		}
		const sig = this.signature(nodes);
		if (!force && sig === this.lastSignature && !this.job) return;
		this.cancelLayout();

		const index = new Map<string, number>();
		nodes.forEach((n, i) => index.set(n.id, i));
		const positions = new Float64Array(nodes.length * 2);
		const sizes = new Float32Array(nodes.length);
		let known = 0;
		nodes.forEach((n, i) => {
			positions[2 * i] = Number.isFinite(n.x) ? n.x : NaN;
			positions[2 * i + 1] = Number.isFinite(n.y) ? n.y : NaN;
			sizes[i] = n.getSize?.() ?? 8;
			if (this.pinned.has(n.id)) known++;
		});
		const pairs: number[] = [];
		for (const link of this.renderer.links) {
			const a = index.get(link.source?.id);
			const b = index.get(link.target?.id);
			if (a !== undefined && b !== undefined && a !== b) pairs.push(a, b);
		}

		const s = this.host.settings;
		const spokeLength = s.matchGraphLinkDistance
			? (this.host.graphLinkDistance(this.view) ?? s.spokeLength)
			: s.spokeLength;
		let root = -1;
		if (this.kind === "localgraph") {
			const focus = this.view.file?.path;
			root = nodes.findIndex((n) => n.type === "focused" || n.id === focus);
		}
		const settingsKey = `${s.radialStyle}|${Math.round(spokeLength)}|${s.splayStrength}|${s.repelMultiplier}|${s.dynamicSpacing ? "c" : ""}`;
		const cacheKey = this.kind === "graph" ? "graph" : null;

		// Reopening the main graph: show the remembered layout straight away.
		let fromCache = false;
		if (cacheKey && !fresh && known === 0) {
			const cached = this.host.layoutCache?.get(cacheKey);
			if (cached && cached.settings === settingsKey) {
				const at = new Map(cached.ids.map((id, i) => [id, i]));
				const seeded = new Float64Array(nodes.length * 2).fill(NaN);
				let hits = 0;
				nodes.forEach((n, i) => {
					const j = at.get(n.id);
					if (j === undefined) return;
					seeded[2 * i] = cached.positions[2 * j];
					seeded[2 * i + 1] = cached.positions[2 * j + 1];
					hits++;
				});
				if (hits >= nodes.length * 0.6) {
					this.pinPositions(nodes, seeded);
					if (cached.signature === sig) {
						this.lastSignature = sig;
						return;
					}
					// Some notes came or went: settle them in around the remembered layout.
					positions.set(seeded);
					fromCache = true;
				}
			}
		}

		// Mostly-unchanged graphs are adjusted gently so the picture doesn't jump.
		const adjust = !fresh && (fromCache || known > nodes.length * 0.6);

		const linkKeys = new Set<string>();
		for (let i = 0; i < pairs.length; i += 2) {
			const a = nodes[pairs[i]].id;
			const b = nodes[pairs[i + 1]].id;
			linkKeys.add(a < b ? `${a}\0${b}` : `${b}\0${a}`);
		}

		// After an edit, only the notes it touched (and their neighbours) move; the rest stay put.
		let fixed: Uint8Array | undefined;
		if (adjust) {
			const changed = new Set<string>();
			for (const n of nodes) if (!this.pinned.has(n.id)) changed.add(n.id);
			if (this.prevLinks) {
				for (const k of linkKeys) if (!this.prevLinks.has(k)) for (const id of k.split("\0")) changed.add(id);
				for (const k of this.prevLinks) if (!linkKeys.has(k)) for (const id of k.split("\0")) changed.add(id);
			}
			const movable = new Uint8Array(nodes.length);
			let count = 0;
			const mark = (i: number) => {
				if (!movable[i]) {
					movable[i] = 1;
					count++;
				}
			};
			nodes.forEach((n, i) => {
				if (changed.has(n.id)) mark(i);
			});
			for (let i = 0; i < pairs.length; i += 2) {
				const a = pairs[i];
				const b = pairs[i + 1];
				if (changed.has(nodes[a].id)) mark(b);
				if (changed.has(nodes[b].id)) mark(a);
			}
			if (count === 0) {
				// Same notes and links, just reordered: nothing to do.
				this.lastSignature = sig;
				this.prevLinks = linkKeys;
				return;
			}
			if (count <= nodes.length * 0.5) fixed = movable.map((m) => (m ? 0 : 1));
		}

		const input: LayoutInput = {
			n: nodes.length,
			positions,
			sizes,
			links: Uint32Array.from(pairs),
			fixed,
			params: {
				style: s.radialStyle,
				spokeLength: Math.max(20, spokeLength),
				splay: s.splayStrength,
				repel: s.repelMultiplier,
				clusters: s.dynamicSpacing,
				root,
				alpha: adjust ? 0.3 : 1,
			},
		};

		this.lastSignature = sig;
		this.prevLinks = linkKeys;
		this.toolbar?.setProgress(0);
		this.job = this.host.layout.run(input, {
			onProgress: (pos, progress) => {
				this.toolbar?.setProgress(progress);
				if (!s.animateLayout) return;
				// Big graphs: fewer, larger steps so the pin messages don't swamp the Graph view.
				const now = performance.now();
				const gap = Math.max(90, (nodes.length / PINS_PER_SECOND) * 1000);
				if (now - this.lastApplied < gap) return;
				this.lastApplied = now;
				this.pinPositions(nodes, pos, PIN_MIN_MOVE);
			},
			onDone: (pos) => {
				this.job = null;
				this.toolbar?.setProgress(null);
				this.pinPositions(nodes, pos);
				if (cacheKey) {
					this.host.layoutCache?.set(cacheKey, {
						signature: sig,
						settings: settingsKey,
						ids: nodes.map((n) => n.id),
						positions: Array.from(pos, (v) => Math.round(v)),
					});
				}
			},
			onError: (message) => {
				this.job = null;
				this.toolbar?.setProgress(null);
				console.warn("Mercury Visualiser: radial layout failed", message);
			},
		});
	}

	cancelLayout(): void {
		if (this.layoutTimer !== null) {
			window.clearTimeout(this.layoutTimer);
			this.layoutTimer = null;
		}
		this.job?.cancel();
		this.job = null;
		this.toolbar?.setProgress(null);
	}

	/**
	 * Fixes nodes at the given positions inside the Graph view's own physics.
	 * Notes that have barely moved since they were last pinned are skipped, which
	 * saves thousands of messages per step on big graphs as the layout settles.
	 */
	private pinPositions(nodes: readonly CoreGraphNode[], positions: Float64Array, minMove = -1): void {
		const worker = this.renderer.worker;
		if (!worker || this.destroyed || !this.radialApplies()) return;
		const dragging = this.renderer.dragNode;
		let pending: Record<string, unknown> | null = null;
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (node === dragging) continue;
			const x = positions[2 * i];
			const y = positions[2 * i + 1];
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			const was = this.pinnedAt.get(node.id);
			if (was && this.pinned.has(node.id) && Math.abs(was[0] - x) + Math.abs(was[1] - y) <= minMove) continue;
			if (pending) worker.postMessage(pending);
			pending = { forceNode: { id: node.id, x, y } };
			this.pinnedAt.set(node.id, [x, y]);
			this.pinned.add(node.id);
		}
		// The last message also wakes the Graph view's physics so it picks the new places up.
		if (pending) worker.postMessage(Object.assign(pending, { alpha: 0.1, alphaTarget: 0, run: true }));
		this.renderer.changed();
	}

	/** Hands every pinned node back to the Graph view's normal physics. */
	private unpinAll(): void {
		const worker = this.renderer.worker;
		if (!worker || this.pinned.size === 0) {
			this.pinned.clear();
			this.pinnedAt.clear();
			return;
		}
		const ids = [...this.pinned];
		this.pinnedAt.clear();
		ids.forEach((id, i) => {
			const msg: Record<string, unknown> = { forceNode: { id, x: null, y: null } };
			if (i === ids.length - 1) Object.assign(msg, { alpha: 0.3, alphaTarget: 0, run: true });
			worker.postMessage(msg);
		});
		this.pinned.clear();
		this.lastSignature = "";
		this.prevLinks = null;
		this.renderer.changed?.();
	}

	/** A node dragged while the radial layout is on stays where it was dropped. */
	private trackDrag(): void {
		const current = this.renderer.dragNode ?? null;
		if (this.dragNode && !current && this.pinned.size > 0) {
			const node = this.dragNode;
			window.setTimeout(() => {
				const worker = this.renderer.worker;
				if (!worker || this.destroyed || !this.radialApplies()) return;
				if (!this.renderer.nodes.includes(node)) return;
				worker.postMessage({ forceNode: { id: node.id, x: node.x, y: node.y }, alpha: 0.05, alphaTarget: 0, run: true });
				this.pinned.add(node.id);
				if (this.kind === "graph") this.host.layoutCache?.move("graph", node.id, node.x, node.y);
			}, 40);
		}
		this.dragNode = current;
	}

	/** Link distance chosen in the Graph view's own Forces panel. */
	static linkDistanceOf(view: CoreGraphView): number | null {
		const engine = engineOf(view);
		const options = engine?.getOptions?.() ?? engine?.options;
		const d = options?.linkDistance;
		return typeof d === "number" && d > 0 ? d : null;
	}
}
