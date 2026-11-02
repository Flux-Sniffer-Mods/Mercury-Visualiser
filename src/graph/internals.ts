/**
 * Minimal typings for the parts of Obsidian's core Graph view this plugin uses.
 * These are not part of Obsidian's public API, so every access is defensive:
 * if something is missing the feature quietly stands down instead of throwing.
 */
import type { App, View, WorkspaceLeaf } from "obsidian";
import type { ColourGroup } from "../tags/colourGroups";

export interface ColourAttr {
	a: number;
	rgb: number;
}

/** The PIXI v7 `Graphics` methods used to draw pie slices. */
export interface PixiGraphics {
	name: string | null;
	eventMode?: string;
	interactive?: boolean;
	children: PixiGraphics[];
	parent: PixiGraphics | null;
	destroyed?: boolean;
	alpha?: number;
	visible?: boolean;
	worldTransform?: PixiMatrix;
	constructor: { name?: string };
	x?: number;
	y?: number;
	position?: { set(x: number, y: number): void };
	geometry?: {
		bounds?: { minX: number; minY: number; maxX: number; maxY: number };
		graphicsData?: Array<{
			shape?: {
				type?: number;
				x?: number;
				y?: number;
				radius?: number;
				width?: number;
				height?: number;
				points?: number[];
			};
			fillStyle?: { visible?: boolean; alpha?: number; color?: number };
			lineStyle?: { visible?: boolean; alpha?: number; width?: number };
		}>;
	};
	clear(): this;
	beginFill(color: number, alpha?: number): this;
	endFill(): this;
	lineStyle(width: number, color?: number, alpha?: number, alignment?: number): this;
	moveTo(x: number, y: number): this;
	lineTo(x: number, y: number): this;
	arc(cx: number, cy: number, r: number, start: number, end: number, anticlockwise?: boolean): this;
	drawCircle(x: number, y: number, r: number): this;
	addChild(child: PixiGraphics): PixiGraphics;
	removeChild(child: PixiGraphics): PixiGraphics;
	getLocalBounds?(): { x: number; y: number; width: number; height: number };
	destroy(options?: unknown): void;
}

/** The PIXI v7 display-object members used for labels and level of detail. */
export interface PixiMatrix {
	a: number;
	b: number;
	c: number;
	d: number;
	tx: number;
	ty: number;
	apply?(p: { x: number; y: number }): { x: number; y: number };
	applyInverse(p: { x: number; y: number }): { x: number; y: number };
}

export interface PixiDisplay {
	visible: boolean;
	renderable: boolean;
	alpha: number;
	cullable?: boolean;
	x: number;
	y: number;
	rotation: number;
	scale: { x: number; y: number; set(x: number, y?: number): void };
	position: { set(x: number, y: number): void };
	parent: PixiContainer | null;
	destroyed?: boolean;
	worldTransform?: PixiMatrix;
	destroy(options?: unknown): void;
}

export interface PixiContainer extends PixiDisplay {
	children: PixiDisplay[];
	addChild<T>(child: T): T;
	removeChild<T>(child: T): T;
}

export interface PixiText extends PixiDisplay {
	text: string;
	style: { clone?(): PixiTextStyle } & PixiTextStyle;
	anchor?: { set(x: number, y: number): void };
}

export interface PixiTextStyle {
	fontSize?: number | string;
	fill?: unknown;
	[key: string]: unknown;
}

export interface PixiSprite extends PixiDisplay {
	texture: { constructor: unknown; baseTexture?: { update?(): void } };
}

export interface CoreGraphNode {
	id: string;
	type: string;
	x: number;
	y: number;
	fx?: number | null;
	fy?: number | null;
	weight?: number;
	circle: PixiGraphics | null;
	text?: PixiText | null;
	forward?: Record<string, unknown>;
	reverse?: Record<string, unknown>;
	getSize?(): number;
	getFillColor?(): ColourAttr;
}

export interface CoreGraphLink {
	source: CoreGraphNode;
	target: CoreGraphNode;
	line?: PixiSprite | null;
	arrow?: PixiDisplay | null;
}

export interface CoreGraphRenderer {
	nodes: CoreGraphNode[];
	links: CoreGraphLink[];
	worker?: Worker;
	dragNode?: CoreGraphNode | null;
	hanger?: PixiContainer;
	px?: { screen?: { width: number; height: number } };
	/** How visible node labels are at the current zoom (the Graph view's "text fade"). */
	textAlpha?: number;
	highlightNode?: CoreGraphNode | null;
	getHighlightNode?(): CoreGraphNode | null;
	renderCallback(): void;
	setData(data: unknown): void;
	changed(): void;
}

export interface CoreGraphEngine {
	options?: Record<string, unknown>;
	getOptions?(): Record<string, unknown>;
	setOptions?(options: Record<string, unknown>): void;
}

export type GraphKind = "graph" | "localgraph";

export interface CoreGraphView extends View {
	contentEl: HTMLElement;
	renderer?: CoreGraphRenderer;
	dataEngine?: CoreGraphEngine;
	engine?: CoreGraphEngine;
	file?: { path: string } | null;
}

export interface GraphPluginInstance {
	options?: { colorGroups?: ColourGroup[]; linkDistance?: number; [k: string]: unknown };
	saveOptions?(): void;
}

export function graphKind(view: View): GraphKind | null {
	const type = view.getViewType();
	return type === "graph" || type === "localgraph" ? type : null;
}

export function isUsableRenderer(r: unknown): r is CoreGraphRenderer {
	const renderer = r as Partial<CoreGraphRenderer> | null | undefined;
	return (
		!!renderer &&
		Array.isArray(renderer.nodes) &&
		typeof renderer.renderCallback === "function" &&
		typeof renderer.setData === "function"
	);
}

export function engineOf(view: CoreGraphView): CoreGraphEngine | undefined {
	return view.dataEngine ?? view.engine;
}

export function graphPluginInstance(app: App): GraphPluginInstance | null {
	const internal = (app as unknown as {
		internalPlugins?: {
			getPluginById?(id: string): { instance?: GraphPluginInstance; enabled?: boolean } | null;
			plugins?: Record<string, { instance?: GraphPluginInstance }>;
		};
	}).internalPlugins;
	const plugin = internal?.getPluginById?.("graph") ?? internal?.plugins?.graph;
	return plugin?.instance ?? null;
}

/** Every open global or local graph view, including ones in pop-out windows. */
export function graphLeaves(app: App): WorkspaceLeaf[] {
	const out: WorkspaceLeaf[] = [];
	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view && graphKind(leaf.view)) out.push(leaf);
	});
	return out;
}

/** Reads the colour of the theme background behind a graph, for slice outlines. */
/**
 * How visible note names are at the current zoom (0–1): the Graph view's own
 * "text fade". Used so labels and slices fade in and out together with names.
 */
export function labelFade(renderer: CoreGraphRenderer): number {
	if (typeof renderer.textAlpha === "number" && Number.isFinite(renderer.textAlpha)) {
		return Math.max(0, Math.min(1, renderer.textAlpha));
	}
	for (const n of renderer.nodes) {
		if (n.text && !n.text.destroyed && n.type !== "focused") return Math.max(0, Math.min(1, n.text.alpha));
	}
	return 1;
}

/** The note the pointer is over, if any. */
export function highlightOf(renderer: CoreGraphRenderer): CoreGraphNode | null {
	try {
		return renderer.getHighlightNode?.() ?? renderer.highlightNode ?? null;
	} catch {
		return renderer.highlightNode ?? null;
	}
}

/** The visible part of the graph, in the graph's own (world) coordinates. */
export interface Viewport {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** Screen pixels per world unit. */
	scale: number;
}

export function viewportOf(renderer: CoreGraphRenderer): Viewport | null {
	const m = renderer.hanger?.worldTransform;
	const screen = renderer.px?.screen;
	if (!m || !screen || typeof m.applyInverse !== "function") return null;
	const a = m.applyInverse({ x: 0, y: 0 });
	const b = m.applyInverse({ x: screen.width, y: screen.height });
	const scale = Math.hypot(m.a, m.b);
	if (![a.x, a.y, b.x, b.y, scale].every(Number.isFinite) || scale <= 0) return null;
	return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y), scale };
}

export function backgroundColourOf(el: HTMLElement): string {
	const style = getComputedStyle(el);
	return (
		style.getPropertyValue("--graph-background").trim() ||
		style.getPropertyValue("--background-primary").trim() ||
		style.backgroundColor
	);
}
