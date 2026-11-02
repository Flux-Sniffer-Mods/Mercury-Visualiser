import type {
	CoreGraphLink,
	CoreGraphNode,
	CoreGraphRenderer,
	PixiContainer,
	PixiText,
	PixiTextStyle,
} from "./internals";
import { highlightOf, labelFade, viewportOf, type PixiGraphics } from "./internals";
import { circleShape } from "./pie";

export interface LinkLabelHost {
	enabled(): boolean;
	maxLabels(): number;
	/** Label for the line between two graph nodes, or null. */
	label(sourceId: string, targetId: string): string | null;
	/** Changes whenever labels may have changed. */
	version(): number;
	/** "names": next to the notes' names at each end of long lines; "middle": out along the line. */
	placement(): "names" | "middle";
	/** How labels are coloured. */
	labelColourMode(): "off" | "ends" | "listing";
	/** A note's tag colour (its colours mixed), or null if it has none. */
	colourOf(node: CoreGraphNode): number | null;
	/** The colour of the listing a line comes from (everyone in it, weighted to its main tags). */
	listingColour(sourceId: string, targetId: string): number | null;
}

/** Lightens a colour a little so text in it reads on a dark background. */
export function lightenForLabel(c: number): number {
	const lift = (v: number) => Math.round(v + (255 - v) * 0.5);
	return (lift((c >> 16) & 255) << 16) | (lift((c >> 8) & 255) << 8) | lift(c & 255);
}

/**
 * The colour for a label: the average of whichever of its two notes have a
 * colour, lightened a little so it reads on a dark background. White (no
 * tint) when neither has one.
 */
export function labelTint(a: number | null, b: number | null): number {
	const cs = [a, b].filter((c): c is number => c !== null);
	if (cs.length === 0) return 0xffffff;
	let r = 0;
	let g = 0;
	let bl = 0;
	for (const c of cs) {
		r += (c >> 16) & 255;
		g += (c >> 8) & 255;
		bl += c & 255;
	}
	const lift = (v: number) => Math.round(v / cs.length + (255 - v / cs.length) * 0.5);
	return (lift(r) << 16) | (lift(g) << 8) | lift(bl);
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
/** Lines at least this long on screen get their labels next to the names at each end. */
const NEAR_NAMES_MIN_LENGTH = 240;

interface Candidate {
	item: Labelled;
	/** 0 = next to the busier end, 1 = next to the other end, 2 = along the line. */
	slot: 0 | 1 | 2;
	/** Screen point the label is measured from (a dot, or a point on the line). */
	at: { x: number; y: number };
	/** Screen direction to move along from `at`. */
	ux: number;
	uy: number;
	/** Distances (px) to try along that direction, nearest first. */
	offsets: number[];
	middle: boolean;
	/** Only used when neither end of the line could take a label. */
	fallback?: boolean;
	hot: boolean;
	/** Labels sharing this key are shown once (a fan of same-label lines from one note). */
	fan: string;
	priority: number;
}

/** The part of the segment a–b inside the rectangle (0, 0)–(w, h), or null (Liang–Barsky). */
export function clipToRect(
	a: { x: number; y: number },
	b: { x: number; y: number },
	w: number,
	h: number,
): [{ x: number; y: number }, { x: number; y: number }] | null {
	let t0 = 0;
	let t1 = 1;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	for (const [p, q] of [
		[-dx, a.x],
		[dx, w - a.x],
		[-dy, a.y],
		[dy, h - a.y],
	]) {
		if (p === 0) {
			if (q < 0) return null;
			continue;
		}
		const r = q / p;
		if (p < 0) {
			if (r > t1) return null;
			if (r > t0) t0 = r;
		} else {
			if (r < t0) return null;
			if (r < t1) t1 = r;
		}
	}
	return [
		{ x: a.x + dx * t0, y: a.y + dy * t0 },
		{ x: a.x + dx * t1, y: a.y + dy * t1 },
	];
}

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
 * - on long lines, labels sit just past the dot at each end, next to the
 *   notes' names, and follow them as you pan and zoom; short lines get one
 *   label out along the line, away from the busy end where lines bunch up;
 * - a label is never drawn over another label or a note's name;
 * - a fan of lines with the same label from one note is labelled once;
 * - only lines on screen are labelled, nearest the middle first, up to a limit.
 */
export class LinkLabelLayer {
	private layer: PixiContainer | null = null;
	/** Up to three labels per line: next to each end, and along the middle. */
	private texts = new Map<CoreGraphLink, Array<PixiText | undefined>>();
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

		const highlight = highlightOf(r);
		const sample = this.sampleText();
		const fade = labelFade(r);
		if (fade < 0.03 && !highlight) return this.hide();

		const view = viewportOf(r);
		const m = hanger.worldTransform;
		if (!view || !m) return false;
		this.ensureLayer(hanger);
		this.rebuildList();

		const toScreen = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty });
		const screenW = (view.x1 - view.x0) * view.scale;
		const screenH = (view.y1 - view.y0) * view.scale;
		const onScreen = (p: { x: number; y: number }, margin = 0) =>
			p.x > -margin && p.x < screenW + margin && p.y > -margin && p.y < screenH + margin;
		const cx = screenW / 2;
		const cy = screenH / 2;
		const nearNames = this.host.placement() === "names";

		// Candidates, in screen space: the hovered note's lines first, then nearest the middle.
		const candidates: Candidate[] = [];
		for (const item of this.labelled) {
			const { hub, other } = item;
			const hot = !!highlight && (hub === highlight || other === highlight);
			if (!hot && fade < 0.03) continue;
			const ps = toScreen(hub.x, hub.y);
			const pt = toScreen(other.x, other.y);
			const length = Math.hypot(pt.x - ps.x, pt.y - ps.y);
			if (!(length >= MIN_SCREEN_LENGTH)) continue;
			const ux = (pt.x - ps.x) / length;
			const uy = (pt.y - ps.y) / length;

			if (!nearNames || length < NEAR_NAMES_MIN_LENGTH) {
				// One label out along the line, away from the busier end.
				const p = { x: ps.x + (pt.x - ps.x) * ALONG, y: ps.y + (pt.y - ps.y) * ALONG };
				if (!onScreen(p, 40)) continue;
				candidates.push({ item, slot: 2, at: p, ux, uy, offsets: [0], middle: true, hot, fan: `${hub.id}\0${item.label}`, priority: hot ? -1 : (p.x - cx) ** 2 + (p.y - cy) ** 2 });
				continue;
			}

			// Next to the names: a label just past each dot that's on screen, reading away from it.
			let any = false;
			for (const [end, pe, sx, sy, slot] of [
				[hub, ps, ux, uy, 0],
				[other, pt, -ux, -uy, 1],
			] as const) {
				if (!onScreen(pe)) continue;
				any = true;
				// Clear of the dot and any pie ring drawn around it.
				const r = this.dotRadiusPx(end, view.scale) * 1.45;
				candidates.push({
					item,
					slot,
					at: pe,
					ux: sx,
					uy: sy,
					offsets: [r + 8, r + 34, r + 70],
					middle: false,
					hot,
					fan: `${end.id}\0${item.label}`,
					priority: hot ? -1 : (pe.x - cx) ** 2 + (pe.y - cy) ** 2,
				});
			}
			// The middle of the part in view: used when neither end is on screen, or both ends are too crowded.
			const seg = clipToRect(ps, pt, screenW, screenH);
			if (!seg) continue;
			const p = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 };
			candidates.push({
				item,
				slot: 2,
				at: p,
				ux,
				uy,
				offsets: [0, -40, 40],
				middle: true,
				fallback: any,
				hot,
				fan: `${hub.id}\0${other.id}`,
				priority: hot ? -0.5 : (p.x - cx) ** 2 + (p.y - cy) ** 2 + screenW * screenH,
			});
		}
		candidates.sort((a, b) => a.priority - b.priority);

		// Screen-space occupancy, so labels don't land on each other or on note names.
		const taken = new Set<number>();
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

		// A little smaller than the Graph view's own note names.
		const sampleScale = sample?.worldTransform ? Math.hypot(sample.worldTransform.a, sample.worldTransform.b) : 1;
		const scale = (sampleScale || 1) / view.scale;

		const max = this.host.maxLabels();
		const used = new Set<PixiText>();
		const fans = new Set<string>();
		const placedItems = new Set<Labelled>();
		let signature = "";
		for (const cand of candidates) {
			if (used.size >= max) break;
			if (fans.has(cand.fan)) continue;
			if (cand.fallback && placedItems.has(cand.item)) continue;
			const { item, slot, hot } = cand;
			const { link, label, hub, other } = item;

			// Keep text the right way up; when it flips, anchor its far end so it still reads away from the dot.
			let angle = Math.atan2(cand.uy, cand.ux);
			let flipped = false;
			if (angle > Math.PI / 2) {
				angle -= Math.PI;
				flipped = true;
			} else if (angle < -Math.PI / 2) {
				angle += Math.PI;
				flipped = true;
			}
			const anchorX = cand.middle ? 0.5 : flipped ? 1 : 0;

			const text = this.textFor(link, slot, label);
			text.scale.set(scale);
			text.anchor?.set(anchorX, 1);
			const mode = this.host.labelColourMode();
			let tint = 0xffffff;
			if (mode !== "off") {
				const listing = mode === "listing" ? this.host.listingColour(link.source.id, link.target.id) : null;
				tint = listing !== null ? lightenForLabel(listing) : labelTint(this.host.colourOf(hub), this.host.colourOf(other));
			}
			if (text.tint !== tint) text.tint = tint;

			const w = (text as unknown as { width: number }).width * view.scale;
			const h = (text as unknown as { height: number }).height * view.scale;
			const dx = Math.cos(angle);
			const dy = Math.sin(angle);
			// The box sits just above the line.
			const nx = dy * (h / 2);
			const ny = -dx * (h / 2);
			let placedAt: { x: number; y: number } | null = null;
			let cells: number[] = [];
			for (const off of cand.offsets) {
				const p = { x: cand.at.x + cand.ux * off, y: cand.at.y + cand.uy * off };
				const s0 = -anchorX * w;
				const s1 = (1 - anchorX) * w;
				const tryCells: number[] = [];
				let blocked = false;
				for (let d = s0; d <= s1 && !blocked; d += CELL * 0.7) {
					for (const k of [-0.35, 0.35]) {
						const sx = p.x + nx + dx * d + dy * h * k;
						const sy = p.y + ny + dy * d - dx * h * k;
						const c = key(Math.floor(sx / CELL), Math.floor(sy / CELL));
						if (taken.has(c)) {
							blocked = true;
							break;
						}
						tryCells.push(c);
					}
				}
				if (!blocked) {
					placedAt = p;
					cells = tryCells;
					break;
				}
			}
			if (!placedAt) continue;
			for (const c of cells) taken.add(c);
			fans.add(cand.fan);
			placedItems.add(item);

			const world = m.applyInverse(placedAt);
			text.position.set(world.x, world.y);
			text.rotation = angle;
			text.alpha = hot ? 1 : fade * 0.85;
			text.visible = true;
			used.add(text);
			signature += `${Math.round(placedAt.x)},${Math.round(placedAt.y)},${Math.round(text.alpha * 20)};`;
		}

		let total = 0;
		for (const [link, slots] of this.texts) {
			for (let i = 0; i < slots.length; i++) {
				const t = slots[i];
				if (!t) continue;
				total++;
				if (!used.has(t)) t.visible = false;
			}
			if (total > max * 4 && !slots.some((t) => t && used.has(t))) {
				for (const t of slots) t?.destroy();
				this.texts.delete(link);
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

	/**
	 * A note name to copy the look from. One that's on screen: the Graph view
	 * hides the rest, and their sizes go stale.
	 */
	private sampleText(): PixiText | null {
		let any: PixiText | null = null;
		for (const n of this.renderer.nodes) {
			const t = n.text;
			if (!t || t.destroyed || n.type === "focused") continue;
			if (t.visible !== false && n.circle?.visible !== false && t.alpha > 0.05) return t;
			any ??= t;
		}
		return any;
	}

	private textFor(link: CoreGraphLink, slot: number, label: string): PixiText {
		let slots = this.texts.get(link);
		if (!slots) {
			slots = [];
			this.texts.set(link, slots);
		}
		let text = slots[slot];
		if (!text || text.destroyed) {
			text = new this.Text!(label, this.style);
			text.visible = false;
			this.layer!.addChild(text);
			slots[slot] = text;
		} else if (text.text !== label) {
			text.text = label;
		}
		return text;
	}

	/** A note's dot radius on screen, in pixels. */
	private dotRadiusPx(node: CoreGraphNode, scale: number): number {
		const c = node.circle as unknown as (PixiGraphics & { scale?: { x: number } }) | null;
		if (c?.scale) return circleShape(c).radius * Math.abs(c.scale.x) * scale;
		return (node.getSize?.() ?? 8) * scale;
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
		style.fontSize = Math.max(8, Math.round(size * 0.72));
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
		for (const slots of this.texts.values()) for (const text of slots) if (text && !text.destroyed) text.destroy();
		this.texts.clear();
		if (this.layer && !this.layer.destroyed) {
			this.layer.parent?.removeChild(this.layer);
			this.layer.destroy({ children: true });
		}
		this.layer = null;
	}
}
