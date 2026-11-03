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
/** After a zoom step, wait this long (ms) before adding labels, so they don't pop in and out mid-zoom. */
const SETTLE_MS = 260;
/** How quickly labels fade in and out (ms; about three times this to finish). */
const FADE_MS = 90;

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
	/** 0 = the hovered note's lines, 1 = labels already showing, 2 = new labels. */
	tier: number;
	/** Which of `offsets` it used last frame, or -1 if it wasn't showing. */
	prevOffset: number;
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
	/** Labelled next to the names (true) or along the middle; switches with some slack, never mid-zoom. */
	nearNames?: boolean;
}

interface LabelState {
	/** How visible it is right now (eases towards its target). */
	alpha: number;
	/** Which offset it sat at last frame. */
	offset: number;
	/** Placed in the last frame. */
	placed: boolean;
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
 * - only lines on screen are labelled, nearest the middle first, up to a limit;
 * - labels stay put: one that is showing keeps its place for as long as it
 *   fits, new labels wait until zooming stops, and labels fade in and out
 *   instead of popping.
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
	/** Label text → its size in the label style (unscaled), so labels can be fitted before any are drawn. */
	private sizes = new Map<string, { w: number; h: number }>();
	private measureCtx: CanvasRenderingContext2D | null = null;
	private font = "";
	private sample: PixiText | null = null;
	private sampleFrame = 0;
	/** Per label: where it sat last frame and how visible it is now. */
	private state = new Map<PixiText, LabelState>();
	private lastScale = 0;
	private zoomedAt = -Infinity;
	private lastFrameAt = 0;

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

		// While zooming, labels already showing stay; new ones wait until it stops.
		const now = performance.now();
		const dt = this.lastFrameAt ? Math.min(100, Math.max(1, now - this.lastFrameAt)) : 16;
		this.lastFrameAt = now;
		if (this.lastScale > 0 && Math.abs(view.scale - this.lastScale) > this.lastScale * 0.0005) this.zoomedAt = now;
		this.lastScale = view.scale;
		const settling = now - this.zoomedAt < SETTLE_MS;
		const prior = (item: Labelled, slot: number): LabelState | undefined => {
			const text = this.texts.get(item.link)?.[slot];
			const st = text ? this.state.get(text) : undefined;
			return st?.placed ? st : undefined;
		};
		const push = (c: Omit<Candidate, "tier" | "prevOffset">) => {
			const st = prior(c.item, c.slot);
			if (!st && !c.hot && settling) return;
			candidates.push({ ...c, tier: c.hot ? 0 : st ? 1 : 2, prevOffset: st ? st.offset : -1 });
		};

		// Candidates, in screen space: the hovered note's lines first, then nearest the middle.
		const candidates: Candidate[] = [];
		// Quick reject in graph space: lines wholly to one side of the view.
		const mx = (view.x1 - view.x0) * 0.05;
		const my = (view.y1 - view.y0) * 0.05;
		const vx0 = view.x0 - mx;
		const vx1 = view.x1 + mx;
		const vy0 = view.y0 - my;
		const vy1 = view.y1 + my;
		for (const item of this.labelled) {
			const { hub, other } = item;
			if (
				(hub.x < vx0 && other.x < vx0) ||
				(hub.x > vx1 && other.x > vx1) ||
				(hub.y < vy0 && other.y < vy0) ||
				(hub.y > vy1 && other.y > vy1)
			) {
				continue;
			}
			const hot = !!highlight && (hub === highlight || other === highlight);
			if (!hot && fade < 0.03) continue;
			const ps = toScreen(hub.x, hub.y);
			const pt = toScreen(other.x, other.y);
			const length = Math.hypot(pt.x - ps.x, pt.y - ps.y);
			// A label already showing may stay on a slightly shorter line, so it doesn't blink at the limit.
			const showing = !!(prior(item, 0) || prior(item, 1) || prior(item, 2));
			if (!(length >= (showing ? MIN_SCREEN_LENGTH * 0.75 : MIN_SCREEN_LENGTH))) continue;
			const ux = (pt.x - ps.x) / length;
			const uy = (pt.y - ps.y) / length;

			// Middle or next to the names: switches with some slack either way, and never mid-zoom.
			if (item.nearNames === undefined) item.nearNames = length >= NEAR_NAMES_MIN_LENGTH;
			else if (!settling) {
				if (item.nearNames && length < NEAR_NAMES_MIN_LENGTH * 0.8) item.nearNames = false;
				else if (!item.nearNames && length > NEAR_NAMES_MIN_LENGTH * 1.2) item.nearNames = true;
			}

			if (!nearNames || !item.nearNames) {
				// One label out along the line, away from the busier end.
				const p = { x: ps.x + (pt.x - ps.x) * ALONG, y: ps.y + (pt.y - ps.y) * ALONG };
				if (!onScreen(p, 40)) continue;
				push({ item, slot: 2, at: p, ux, uy, offsets: [0], middle: true, hot, fan: `${hub.id}\0${item.label}`, priority: (p.x - cx) ** 2 + (p.y - cy) ** 2 });
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
				push({
					item,
					slot,
					at: pe,
					ux: sx,
					uy: sy,
					offsets: [r + 8, r + 34, r + 70],
					middle: false,
					hot,
					fan: `${end.id}\0${item.label}`,
					priority: (pe.x - cx) ** 2 + (pe.y - cy) ** 2,
				});
			}
			// The middle of the part in view: used when neither end is on screen, or both ends are too crowded.
			const seg = clipToRect(ps, pt, screenW, screenH);
			if (!seg) continue;
			const p = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 };
			push({
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
				priority: (p.x - cx) ** 2 + (p.y - cy) ** 2 + screenW * screenH,
			});
		}
		// The hovered note's lines first, then labels already showing (so they keep their places), then new ones.
		candidates.sort((a, b) => a.tier - b.tier || a.priority - b.priority);

		// Screen-space occupancy, so labels don't land on each other or on note names.
		const taken = new Set<number>();
		const key = (gx: number, gy: number) => gx * 65536 + gy;
		const markRect = (x0: number, y0: number, x1: number, y1: number) => {
			for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
				for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) taken.add(key(gx, gy));
			}
		};
		// Every note name on screen counts, however faded: a name that's fading in mustn't suddenly push labels out.
		for (const n of r.nodes) {
			const t = n.text;
			if (!t || t.visible === false || n.x < view.x0 || n.x > view.x1 || n.y < view.y0 || n.y > view.y1) continue;
			const w = (t as unknown as { width: number }).width * view.scale;
			const h = (t as unknown as { height: number }).height * view.scale;
			const p = toScreen(t.x, t.y);
			markRect(p.x - w / 2, p.y, p.x + w / 2, p.y + h);
		}

		// A little smaller than the Graph view's own note names.
		const sampleScale = sample?.worldTransform ? Math.hypot(sample.worldTransform.a, sample.worldTransform.b) : 1;
		const scale = (sampleScale || 1) / view.scale;

		const max = this.host.maxLabels();
		const used = new Set<PixiText>();
		/** Labels placed this frame → which offset, and whether they belong to the hovered note. */
		const placedNow = new Map<PixiText, { offset: number; hot: boolean }>();
		const fans = new Set<string>();
		const placedItems = new Set<Labelled>();
		const mode = this.host.labelColourMode();
		// Crowded views can have thousands of candidates: stop trying after a fair number of misses.
		let attempts = 0;
		const maxAttempts = max * 10;
		let signature = "";
		for (const cand of candidates) {
			if (used.size >= max || attempts >= maxAttempts) break;
			if (fans.has(cand.fan)) continue;
			if (cand.fallback && placedItems.has(cand.item)) continue;
			attempts++;
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

			// Fit the label using its measured size; the text itself is only made once it has a place.
			const size = this.sizeOf(label);
			const w = size.w * scale * view.scale;
			const h = size.h * scale * view.scale;
			const dx = Math.cos(angle);
			const dy = Math.sin(angle);
			// The box sits just above the line.
			const nx = dy * (h / 2);
			const ny = -dx * (h / 2);
			let placedAt: { x: number; y: number } | null = null;
			let placedOffset = -1;
			let cells: number[] = [];
			// A label already showing only tries the place it's in: it stays there or fades out, it never jumps.
			const tries = cand.prevOffset >= 0 && cand.prevOffset < cand.offsets.length ? [cand.prevOffset] : cand.offsets.map((_, i) => i);
			for (const oi of tries) {
				const off = cand.offsets[oi];
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
					placedOffset = oi;
					cells = tryCells;
					break;
				}
			}
			if (!placedAt) continue;
			for (const c of cells) taken.add(c);
			fans.add(cand.fan);
			placedItems.add(item);

			const text = this.textFor(link, slot, label);
			text.scale.set(scale);
			text.anchor?.set(anchorX, 1);
			let tint = 0xffffff;
			if (mode !== "off") {
				const listing = mode === "listing" ? this.host.listingColour(link.source.id, link.target.id) : null;
				tint = listing !== null ? lightenForLabel(listing) : labelTint(this.host.colourOf(hub), this.host.colourOf(other));
			}
			if (text.tint !== tint) text.tint = tint;

			const world = m.applyInverse(placedAt);
			text.position.set(world.x, world.y);
			text.rotation = angle;
			used.add(text);
			placedNow.set(text, { offset: placedOffset, hot });
			signature += `${Math.round(placedAt.x)},${Math.round(placedAt.y)};`;
		}

		// Fade every label towards where it should be: in if placed, out if not.
		const ease = 1 - Math.exp(-dt / FADE_MS);
		let animating = false;
		let total = 0;
		for (const [link, slots] of this.texts) {
			let anyShowing = false;
			for (let i = 0; i < slots.length; i++) {
				const t = slots[i];
				if (!t) continue;
				total++;
				const placed = placedNow.get(t);
				const st = this.state.get(t) ?? { alpha: 0, offset: -1, placed: false };
				st.placed = !!placed;
				if (placed) st.offset = placed.offset;
				const target = placed ? (placed.hot ? 1 : fade * 0.85) : 0;
				st.alpha += (target - st.alpha) * ease;
				if (Math.abs(target - st.alpha) < 0.01) st.alpha = target;
				else animating = true;
				this.state.set(t, st);
				t.alpha = st.alpha;
				t.visible = st.alpha > 0.005;
				if (t.visible) anyShowing = true;
			}
			if (total > max * 4 && !anyShowing) {
				for (const t of slots) {
					if (!t) continue;
					this.state.delete(t);
					t.destroy();
				}
				this.texts.delete(link);
			}
		}

		this.layer!.visible = true;
		// The Graph view only redraws while something moves: ask for more frames while labels
		// move or fade, and until zooming has settled so the waiting labels get their turn.
		const changed = signature !== this.lastSignature;
		this.lastSignature = signature;
		return changed || animating || settling;
	}

	private hide(): boolean {
		// Start from nothing next time, so labels fade back in.
		for (const st of this.state.values()) {
			st.alpha = 0;
			st.placed = false;
		}
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
		// Re-check now and then, or when the one we have stops being usable.
		const s = this.sample;
		if (s && !s.destroyed && s.visible !== false && s.alpha > 0.05 && ++this.sampleFrame % 30 !== 0) return s;
		this.sample = this.findSample();
		return this.sample;
	}

	private findSample(): PixiText | null {
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

	/**
	 * A label's size in the label style, before scaling: measured once, then
	 * remembered. Always this same measure (never swapped for the drawn text's
	 * size), so a label's space doesn't change from one frame to the next.
	 */
	private sizeOf(label: string): { w: number; h: number } {
		const known = this.sizes.get(label);
		if (known) return known;
		const style = this.style ?? {};
		const fontSize = typeof style.fontSize === "number" ? style.fontSize : parseFloat(String(style.fontSize ?? 12)) || 12;
		if (!this.measureCtx) {
			this.measureCtx = document.createElement("canvas").getContext("2d");
			const toFont = (style as { toFontString?: () => string }).toFontString;
			this.font =
				typeof toFont === "function"
					? toFont.call(style)
					: `italic ${String(style.fontWeight ?? "normal")} ${fontSize}px ${String(style.fontFamily ?? "sans-serif")}`;
		}
		let w = label.length * fontSize * 0.55;
		if (this.measureCtx) {
			this.measureCtx.font = this.font;
			w = this.measureCtx.measureText(label).width;
		}
		const size = { w: w + 4, h: fontSize * 1.3 };
		if (this.sizes.size > 20000) this.sizes.clear();
		this.sizes.set(label, size);
		return size;
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
		this.state.clear();
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
		this.state.clear();
		if (this.layer && !this.layer.destroyed) {
			this.layer.parent?.removeChild(this.layer);
			this.layer.destroy({ children: true });
		}
		this.layer = null;
	}
}
