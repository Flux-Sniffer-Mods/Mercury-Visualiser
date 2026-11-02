import type { CoreGraphNode, CoreGraphRenderer, PixiContainer, PixiSprite } from "./internals";
import { viewportOf } from "./internals";
import { circleShape } from "./pie";

export type DensityStyle = "tags" | "brightness";

export interface DetailHost {
	culling(): boolean;
	densityMap(): boolean;
	/** Show the density map once nodes are smaller than this many pixels across. */
	mapBelowPx(): number;
	densityStyle(): DensityStyle;
	/** How much the map is smoothed: 0 = crisp, 3 = very soft. */
	softness(): number;
	/** The colour a node stands for on the density map (its tag colours mixed). */
	nodeColour(node: CoreGraphNode): number | null;
	/** Theme accent, used by the single-colour density style. */
	accent(): number;
	/** Changes whenever node colours may have changed. */
	colourVersion(): number;
}

type SpriteCtor = new (texture?: unknown) => PixiSprite;
interface TextureStatic {
	from(source: HTMLCanvasElement): PixiSprite["texture"] & { destroy(b?: boolean): void };
}

const MAP_NAME = "mercury-visualiser-density";
/** Size of one density cell on screen, in pixels; the map is smoothed between cells. */
const CELL_PX = 5;
const MAX_CELLS = 512 * 512;
/** Blur radius (cells) and number of passes for each softness level, crisp to very soft. */
const SOFTNESS: ReadonlyArray<[number, number]> = [
	[0, 0],
	[1, 2],
	[2, 2],
	[2, 3],
];

/**
 * Level of detail for big graphs:
 * - Zoomed in: anything off screen is skipped when drawing.
 * - Zoomed far out: individual dots and lines give way to a soft density map,
 *   tinted by the tag colours of the notes in each area and lighter where
 *   notes are packed tighter. It fades in gradually as you zoom out.
 */
export class DetailLayer {
	private cullingOn = false;
	private frame = 0;
	private hiddenForMap = false;

	private sprite: PixiSprite | null = null;
	private texture: (PixiSprite["texture"] & { destroy(b?: boolean): void }) | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private built: {
		scale: number;
		sig: number;
		colours: number;
		at: number;
		style: DensityStyle;
		softness: number;
	} | null = null;
	private mapUnsupported = false;
	private graphArea = 0;

	constructor(private renderer: CoreGraphRenderer, private host: DetailHost) {}

	/** Call after each frame. Returns true if the graph should draw one more frame. */
	update(): boolean {
		this.frame++;
		const view = viewportOf(this.renderer);
		if (!view) return false;
		let redraw = false;

		// --- Skip what's off screen (only worth it when part of the graph is out of view).
		if (this.frame % 15 === 1) this.graphArea = this.measureGraphArea();
		const viewArea = (view.x1 - view.x0) * (view.y1 - view.y0);
		const wantCulling = this.host.culling() && this.graphArea > 0 && viewArea < this.graphArea * 0.6;
		if (wantCulling !== this.cullingOn || (wantCulling && this.frame % 30 === 0)) {
			this.setCulling(wantCulling);
		}

		// --- Density map when zoomed far out.
		const t = this.host.densityMap() && !this.mapUnsupported ? this.mapAmount() : 0;
		if (t > 0) {
			redraw = this.ensureMap(view.scale) || redraw;
			if (this.sprite) {
				const alpha = Math.min(1, t) * 0.95;
				if (Math.abs(this.sprite.alpha - alpha) > 0.01 || !this.sprite.visible) redraw = true;
				this.sprite.alpha = alpha;
				this.sprite.visible = true;
			}
		} else if (this.sprite?.visible) {
			this.sprite.visible = false;
			redraw = true;
		}
		// Once the map has all but taken over, stop drawing the thousands of tiny dots and lines.
		const hide = t >= 0.9 && !!this.sprite;
		if (hide !== this.hiddenForMap || (hide && this.frame % 30 === 0)) {
			this.setElementsHidden(hide);
			redraw = true;
		}
		return redraw;
	}

	/** 0 = zoomed in enough to see nodes, 1 = so far out that only the map is shown. */
	private mapAmount(): number {
		const px = this.typicalNodePx();
		if (px === null) return 0;
		const below = Math.max(0.5, this.host.mapBelowPx());
		const start = below * 2.2;
		return Math.max(0, Math.min(1, (start - px) / (start - below)));
	}

	/** Median on-screen diameter of a sample of nodes. */
	private typicalNodePx(): number | null {
		const nodes = this.renderer.nodes;
		if (nodes.length === 0) return null;
		const sizes: number[] = [];
		const step = Math.max(1, Math.floor(nodes.length / 48));
		for (let i = 0; i < nodes.length && sizes.length < 48; i += step) {
			const c = nodes[i].circle as unknown as { worldTransform?: { a: number; b: number } } | null;
			if (!c?.worldTransform || !nodes[i].circle) continue;
			const r = circleShape(nodes[i].circle!).radius;
			sizes.push(2 * r * Math.hypot(c.worldTransform.a, c.worldTransform.b));
		}
		if (sizes.length === 0) return null;
		sizes.sort((a, b) => a - b);
		return sizes[Math.floor(sizes.length / 2)];
	}

	private measureGraphArea(): number {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const n of this.renderer.nodes) {
			if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
			if (n.x < minX) minX = n.x;
			if (n.x > maxX) maxX = n.x;
			if (n.y < minY) minY = n.y;
			if (n.y > maxY) maxY = n.y;
		}
		return maxX > minX && maxY > minY ? (maxX - minX) * (maxY - minY) : 0;
	}

	private setCulling(on: boolean): void {
		this.cullingOn = on;
		for (const n of this.renderer.nodes) {
			if (n.circle) (n.circle as unknown as { cullable: boolean }).cullable = on;
			if (n.text) n.text.cullable = on;
		}
		for (const l of this.renderer.links) {
			if (l.line) l.line.cullable = on;
			if (l.arrow) l.arrow.cullable = on;
		}
	}

	private setElementsHidden(hide: boolean): void {
		this.hiddenForMap = hide;
		for (const n of this.renderer.nodes) {
			if (n.circle) (n.circle as unknown as { renderable: boolean }).renderable = !hide;
		}
		for (const l of this.renderer.links) if (l.line) l.line.renderable = !hide;
	}

	// ------------------------------------------------------------ the map

	private classes(): { Sprite: SpriteCtor; Texture: TextureStatic } | null {
		const line = this.renderer.links.find((l) => l.line && !l.line.destroyed)?.line;
		if (!line) return null;
		const Sprite = (line as unknown as { constructor: SpriteCtor }).constructor;
		const Texture = line.texture?.constructor as unknown as TextureStatic | undefined;
		if (typeof Sprite !== "function" || typeof Texture?.from !== "function") return null;
		return { Sprite, Texture };
	}

	/** Builds or refreshes the map when zoom, positions or colours changed. Returns true if it changed. */
	private ensureMap(scale: number): boolean {
		const hanger = this.renderer.hanger;
		if (!hanger) return false;
		const now = performance.now();
		const sig = this.positionSignature();
		const colours = this.host.colourVersion();
		const style = this.host.densityStyle();
		const softness = this.host.softness();
		const b = this.built;
		const stale =
			!b ||
			scale > b.scale * 1.5 ||
			scale < b.scale / 1.5 ||
			b.colours !== colours ||
			b.style !== style ||
			b.softness !== softness ||
			Math.abs(b.sig - sig) > 1e-6 * Math.max(1, Math.abs(sig));
		if (!stale || (b && now - b.at < 250)) return false;

		const classes = this.classes();
		if (!classes) {
			this.mapUnsupported = true;
			console.warn("Mercury Visualiser: this version of the Graph view can't show the density map.");
			return false;
		}
		this.draw(scale, classes, hanger);
		this.built = { scale, sig, colours, at: now, style, softness };
		return true;
	}

	/** Cheap fingerprint of node positions (every 37th node). */
	private positionSignature(): number {
		let sig = 0;
		const nodes = this.renderer.nodes;
		for (let i = 0; i < nodes.length; i += 37) sig += nodes[i].x * 1.7 + nodes[i].y * 2.3;
		return sig + nodes.length;
	}

	private draw(scale: number, classes: { Sprite: SpriteCtor; Texture: TextureStatic }, hanger: PixiContainer): void {
		const nodes = this.renderer.nodes;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const n of nodes) {
			if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
			minX = Math.min(minX, n.x);
			maxX = Math.max(maxX, n.x);
			minY = Math.min(minY, n.y);
			maxY = Math.max(maxY, n.y);
		}
		if (!(maxX >= minX)) return;

		let cell = CELL_PX / scale;
		const pad = 4;
		let cols = Math.ceil((maxX - minX) / cell) + 2 * pad;
		let rows = Math.ceil((maxY - minY) / cell) + 2 * pad;
		if (cols * rows > MAX_CELLS) {
			const k = Math.sqrt((cols * rows) / MAX_CELLS);
			cell *= k;
			cols = Math.ceil((maxX - minX) / cell) + 2 * pad;
			rows = Math.ceil((maxY - minY) / cell) + 2 * pad;
		}
		const ox = minX - pad * cell;
		const oy = minY - pad * cell;

		const count = new Float32Array(cols * rows);
		const red = new Float32Array(cols * rows);
		const green = new Float32Array(cols * rows);
		const blue = new Float32Array(cols * rows);
		for (const n of nodes) {
			if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
			const cx = Math.floor((n.x - ox) / cell);
			const cy = Math.floor((n.y - oy) / cell);
			const i = cy * cols + cx;
			const w = n.type === "unresolved" ? 0.35 : 1;
			const rgb = this.host.nodeColour(n) ?? n.getFillColor?.().rgb ?? 0x888888;
			count[i] += w;
			red[i] += w * ((rgb >> 16) & 255);
			green[i] += w * ((rgb >> 8) & 255);
			blue[i] += w * (rgb & 255);
		}
		// Smooth into a round-edged field (repeated box blurs ≈ a Gaussian), as soft as the user wants.
		const [radius, passes] = SOFTNESS[Math.max(0, Math.min(SOFTNESS.length - 1, Math.round(this.host.softness())))];
		for (const a of [count, red, green, blue]) for (let p = 0; p < passes; p++) blur(a, cols, rows, radius);

		let max = 0;
		for (let i = 0; i < count.length; i++) if (count[i] > max) max = count[i];
		if (max <= 0) return;
		const logMax = Math.log1p(max * 4);

		const canvas = this.canvas ?? document.createElement("canvas");
		const resized = canvas.width !== cols || canvas.height !== rows;
		canvas.width = cols;
		canvas.height = rows;
		this.canvas = canvas;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const img = ctx.createImageData(cols, rows);
		const px = img.data;
		const style = this.host.densityStyle();
		const accent = this.host.accent();
		const ar = (accent >> 16) & 255;
		const ag = (accent >> 8) & 255;
		const ab = accent & 255;
		for (let i = 0; i < count.length; i++) {
			const c = count[i];
			if (c < 1e-6) continue;
			const v = Math.log1p(c * 4) / logMax; // 0 (sparse) … 1 (densest)
			let r: number;
			let g: number;
			let b: number;
			if (style === "tags") {
				r = red[i] / c;
				g = green[i] / c;
				b = blue[i] / c;
			} else {
				r = ar;
				g = ag;
				b = ab;
			}
			// Denser areas are lighter.
			const lift = 0.45 * v * v;
			px[4 * i] = r + (255 - r) * lift;
			px[4 * i + 1] = g + (255 - g) * lift;
			px[4 * i + 2] = b + (255 - b) * lift;
			// Fades smoothly to nothing at the edges, so lone notes become soft glows.
			px[4 * i + 3] = 255 * Math.min(1, Math.pow(v, 0.8) * 1.1);
		}
		ctx.putImageData(img, 0, 0);

		if (!this.texture || resized) {
			this.texture?.destroy(true);
			this.texture = classes.Texture.from(canvas);
		} else {
			this.texture.baseTexture?.update?.();
		}
		if (!this.sprite || this.sprite.destroyed || this.sprite.parent !== hanger) {
			this.sprite = new classes.Sprite(this.texture);
			(this.sprite as unknown as { name: string }).name = MAP_NAME;
			hanger.addChild(this.sprite);
		}
		this.sprite.texture = this.texture;
		this.sprite.position.set(ox, oy);
		this.sprite.scale.set(cell);
	}

	destroy(): void {
		if (this.cullingOn) this.setCulling(false);
		if (this.hiddenForMap) this.setElementsHidden(false);
		if (this.sprite && !this.sprite.destroyed) {
			this.sprite.parent?.removeChild(this.sprite);
			this.sprite.destroy();
		}
		this.texture?.destroy(true);
		this.sprite = null;
		this.texture = null;
		this.canvas = null;
	}
}

/** In-place box blur of a cols × rows grid. */
function blur(a: Float32Array, cols: number, rows: number, radius: number): void {
	const tmp = new Float32Array(Math.max(cols, rows));
	const span = 2 * radius + 1;
	for (let y = 0; y < rows; y++) {
		let sum = 0;
		const row = y * cols;
		for (let x = -radius; x <= radius; x++) sum += a[row + Math.min(cols - 1, Math.max(0, x))];
		for (let x = 0; x < cols; x++) {
			tmp[x] = sum / span;
			sum += a[row + Math.min(cols - 1, x + radius + 1)] - a[row + Math.max(0, x - radius)];
		}
		a.set(tmp.subarray(0, cols), row);
	}
	for (let x = 0; x < cols; x++) {
		let sum = 0;
		for (let y = -radius; y <= radius; y++) sum += a[Math.min(rows - 1, Math.max(0, y)) * cols + x];
		for (let y = 0; y < rows; y++) {
			tmp[y] = sum / span;
			sum += a[Math.min(rows - 1, y + radius + 1) * cols + x] - a[Math.max(0, y - radius) * cols + x];
		}
		for (let y = 0; y < rows; y++) a[y * cols + x] = tmp[y];
	}
}
