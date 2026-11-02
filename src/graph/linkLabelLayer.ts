import type {
	CoreGraphLink,
	CoreGraphNode,
	CoreGraphRenderer,
	PixiContainer,
	PixiText,
	PixiTextStyle,
} from "./internals";
import { viewportOf } from "./internals";

export interface LinkLabelHost {
	enabled(): boolean;
	maxLabels(): number;
	/** Label for the line between two graph nodes, or null. */
	label(sourceId: string, targetId: string): string | null;
	/** Changes whenever labels may have changed. */
	version(): number;
}

type TextCtor = new (text: string, style?: unknown) => PixiText;
type ContainerCtor = new () => PixiContainer;

const LAYER_NAME = "mercury-visualiser-link-labels";
/** Lines shorter than this on screen don't get a label: it wouldn't fit. */
const MIN_SCREEN_LENGTH = 56;
/** Size of the screen grid used to stop labels overlapping, in pixels. */
const CELL = 9;
/** How far along a line (from its busier end) the label sits. Further out = more room. */
const ALONG = 0.62;

interface Labelled {
	link: CoreGraphLink;
	label: string;
	/** The busier end of the line, where its siblings fan out from. */
	hub: CoreGraphNode;
	other: CoreGraphNode;
}

/**
 * Writes each line's listing title along it, like the Graph view's own node
 * labels: same font, fading out with the same "text fade" as you zoom out,
 * and always shown for the lines of the note you hover. To stay readable:
 * - labels sit out along the line, away from busy notes where lines bunch up;
 * - a label is never drawn over another label or a note's name;
 * - a fan of lines with the same label from one note is labelled once;
 * - only lines on screen are labelled, nearest the middle first, up to a limit.
 */
export class LinkLabelLayer {
	private layer: PixiContainer | null = null;
	private texts = new Map<CoreGraphLink, PixiText>();
	private labelled: Labelled[] = [];
	private builtFor: { links: unknown; length: number; version: number } | null = null;
	private Text: TextCtor | null = null;
	private style: PixiTextStyle | null = null;
	private lastSignature = "";

	constructor(private renderer: CoreGraphRenderer, private host: LinkLabelHost) {}

	/** Call after each frame. Returns true if the graph should draw one more frame. */
	update(): boolean {
		if (!this.host.enabled()) return this.hide();
		const r = this.renderer;
		const hanger = r.hanger;
		if (!hanger || !this.ensureClasses()) return false;

		const highlight = r.getHighlightNode?.() ?? r.highlightNode ?? null;
		const sample = this.sampleText();
		const fade = typeof r.textAlpha === "number" ? r.textAlpha : (sample?.alpha ?? 1);
		if (fade < 0.03 && !highlight) return this.hide();

		const view = viewportOf(r);
		const m = hanger.worldTransform;
		if (!view || !m) return false;
		this.ensureLayer(hanger);
		this.rebuildList();

		// Candidates: on screen and long enough, the hovered note's lines first, then nearest the middle.
		const cx = (view.x0 + view.x1) / 2;
		const cy = (view.y0 + view.y1) / 2;
		const marginX = (view.x1 - view.x0) * 0.05;
		const marginY = (view.y1 - view.y0) * 0.05;
		const candidates: Array<{ item: Labelled; priority: number; hot: boolean; x: number; y: number }> = [];
		for (const item of this.labelled) {
			const { hub, other } = item;
			const hot = !!highlight && (hub === highlight || other === highlight);
			if (!hot && fade < 0.03) continue;
			const x = hub.x + (other.x - hub.x) * ALONG;
			const y = hub.y + (other.y - hub.y) * ALONG;
			if (!(x > view.x0 - marginX && x < view.x1 + marginX && y > view.y0 - marginY && y < view.y1 + marginY)) continue;
			if (Math.hypot(other.x - hub.x, other.y - hub.y) * view.scale < MIN_SCREEN_LENGTH) continue;
			candidates.push({ item, priority: hot ? -1 : (x - cx) ** 2 + (y - cy) ** 2, hot, x, y });
		}
		candidates.sort((a, b) => a.priority - b.priority);

		// Screen-space occupancy, so labels don't land on each other or on note names.
		const taken = new Set<number>();
		const toScreen = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty });
		const key = (gx: number, gy: number) => gx * 65536 + gy;
		const markRect = (x0: number, y0: number, x1: number, y1: number) => {
			for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
				for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) taken.add(key(gx, gy));
			}
		};
		if (fade > 0.1) {
			for (const n of r.nodes) {
				const t = n.text;
				if (!t || !t.visible || t.alpha < 0.2 || n.x < view.x0 || n.x > view.x1 || n.y < view.y0 || n.y > view.y1) continue;
				const w = (t as unknown as { width: number }).width * view.scale;
				const h = (t as unknown as { height: number }).height * view.scale;
				const p = toScreen(t.x, t.y);
				markRect(p.x - w / 2, p.y, p.x + w / 2, p.y + h);
			}
		}

		// Match the size the Graph view draws its own labels at.
		const sampleScale = sample?.worldTransform ? Math.hypot(sample.worldTransform.a, sample.worldTransform.b) : 1;
		const scale = (sampleScale || 1) / view.scale;

		const max = this.host.maxLabels();
		const used = new Set<CoreGraphLink>();
		const fans = new Set<string>();
		let signature = "";
		for (const { item, hot, x, y } of candidates) {
			if (used.size >= max) break;
			const { link, label, hub, other } = item;
			const fan = `${hub.id}\0${label}`;
			if (fans.has(fan)) continue;

			let angle = Math.atan2(other.y - hub.y, other.x - hub.x);
			if (angle > Math.PI / 2) angle -= Math.PI;
			else if (angle < -Math.PI / 2) angle += Math.PI;

			let text = this.texts.get(link);
			if (!text || text.destroyed) {
				text = new this.Text!(label, this.style);
				text.anchor?.set(0.5, 1);
				text.visible = false;
				this.layer!.addChild(text);
				this.texts.set(link, text);
			} else if (text.text !== label) {
				text.text = label;
			}
			text.scale.set(scale);

			// Footprint along the (rotated) text, sampled every few pixels.
			const half = ((text as unknown as { width: number }).width * view.scale) / 2;
			const height = (text as unknown as { height: number }).height * view.scale;
			const p = toScreen(x, y);
			const ux = Math.cos(angle);
			const uy = Math.sin(angle);
			// The text sits just above the line: centre of its box is half a line-height up.
			const ox = uy * (height / 2);
			const oy = -ux * (height / 2);
			const cells: number[] = [];
			let blocked = false;
			for (let d = -half; d <= half && !blocked; d += CELL * 0.7) {
				for (const k of [-0.35, 0.35]) {
					const sx = p.x + ox + ux * d + uy * height * k;
					const sy = p.y + oy + uy * d - ux * height * k;
					const c = key(Math.floor(sx / CELL), Math.floor(sy / CELL));
					if (taken.has(c)) {
						blocked = true;
						break;
					}
					cells.push(c);
				}
			}
			if (blocked) continue;
			for (const c of cells) taken.add(c);
			fans.add(fan);

			text.position.set(x, y);
			text.rotation = angle;
			text.alpha = hot ? 1 : fade * 0.8;
			text.visible = true;
			used.add(link);
			signature += `${Math.round(p.x)},${Math.round(p.y)},${Math.round(text.alpha * 20)};`;
		}

		for (const [link, text] of this.texts) if (!used.has(link)) text.visible = false;
		// Don't keep thousands of unused text objects around.
		if (this.texts.size > max * 3) {
			for (const [link, text] of this.texts) {
				if (used.has(link)) continue;
				text.destroy();
				this.texts.delete(link);
				if (this.texts.size <= max * 2) break;
			}
		}

		this.layer!.visible = true;
		// The Graph view only redraws while something moves; ask for one more frame if labels moved.
		const changed = signature !== this.lastSignature;
		this.lastSignature = signature;
		return changed;
	}

	private hide(): boolean {
		if (this.layer?.visible) {
			this.layer.visible = false;
			this.lastSignature = "";
			return true;
		}
		return false;
	}

	private sampleText(): PixiText | null {
		for (const n of this.renderer.nodes) if (n.text && !n.text.destroyed && n.type !== "focused") return n.text;
		return null;
	}

	/** Uses the Graph view's own PIXI classes, taken from its node labels. */
	private ensureClasses(): boolean {
		if (this.Text) return true;
		const sample = this.sampleText();
		if (!sample) return false;
		this.Text = (sample as unknown as { constructor: TextCtor }).constructor;
		const base = sample.style;
		const style = (typeof base.clone === "function" ? base.clone() : { ...base }) as PixiTextStyle;
		const size = typeof style.fontSize === "number" ? style.fontSize : parseFloat(String(style.fontSize ?? 14)) || 14;
		style.fontSize = Math.max(8, Math.round(size * 0.82));
		style.fontStyle = "italic";
		this.style = style;
		return true;
	}

	private ensureLayer(hanger: PixiContainer): void {
		if (this.layer && !this.layer.destroyed && this.layer.parent === hanger) return;
		const Container = (hanger as unknown as { constructor: ContainerCtor }).constructor;
		this.layer = new Container();
		(this.layer as unknown as { name: string }).name = LAYER_NAME;
		hanger.addChild(this.layer);
		this.texts.clear();
	}

	/** Which lines have a label; rebuilt when the graph's lines or the labels change. */
	private rebuildList(): void {
		const links = this.renderer.links;
		const version = this.host.version();
		const b = this.builtFor;
		if (b && b.links === links && b.length === links.length && b.version === version) return;
		this.labelled = [];
		const degree = new Map<CoreGraphNode, number>();
		for (const link of links) {
			if (link.source) degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
			if (link.target) degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
		}
		for (const link of links) {
			const s: CoreGraphNode | undefined = link.source;
			const t: CoreGraphNode | undefined = link.target;
			if (!s || !t) continue;
			const label = this.host.label(s.id, t.id);
			if (!label) continue;
			const sBusier = (degree.get(s) ?? 0) >= (degree.get(t) ?? 0);
			this.labelled.push({ link, label, hub: sBusier ? s : t, other: sBusier ? t : s });
		}
		this.builtFor = { links, length: links.length, version };
	}

	destroy(): void {
		for (const text of this.texts.values()) if (!text.destroyed) text.destroy();
		this.texts.clear();
		if (this.layer && !this.layer.destroyed) {
			this.layer.parent?.removeChild(this.layer);
			this.layer.destroy({ children: true });
		}
		this.layer = null;
	}
}
