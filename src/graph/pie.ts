import { sliceAngles, type Slice } from "../tags/slices";
import type { PixiGraphics } from "./internals";

export const PIE_NAME = "mercury-visualiser-pie";

export interface PieStyle {
	weighted: boolean;
	/** Colour of the thin lines between slices, or null for none. */
	outline: number | null;
}

/**
 * Draws a node as a pie chart: one wedge per tag colour. Drawn in the node
 * circle's own coordinate space so it moves, scales and fades with the node.
 */
export function drawPie(g: PixiGraphics, slices: readonly Slice[], radius: number, style: PieStyle): void {
	g.clear();
	if (slices.length === 0) return;
	if (slices.length === 1) {
		g.beginFill(slices[0].rgb, 1);
		g.drawCircle(0, 0, radius);
		g.endFill();
		return;
	}

	const angles = sliceAngles(slices, style.weighted);
	for (let i = 0; i < slices.length; i++) {
		const [a0, a1] = angles[i];
		g.beginFill(slices[i].rgb, 1);
		g.moveTo(0, 0);
		g.arc(0, 0, radius, a0, a1);
		g.lineTo(0, 0);
		g.endFill();
	}

	if (style.outline !== null) {
		g.lineStyle(Math.max(1, radius * 0.07), style.outline, 1);
		for (const [a0] of angles) {
			g.moveTo(0, 0);
			g.lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
		}
		g.lineStyle(0);
	}
}

export interface CircleShape {
	/** Centre of the drawn circle in the circle object's own coordinates. */
	x: number;
	y: number;
	radius: number;
}

interface Point {
	x: number;
	y: number;
}

const finite = (...v: number[]) => v.every((n) => Number.isFinite(n));

/**
 * Below this opacity a shape counts as invisible. The Graph view draws a big,
 * almost transparent circle round every dot as a touch target (five times the
 * dot's size); it must not be mistaken for the dot.
 */
const VISIBLE_ALPHA = 0.05;

/**
 * The circle-like shapes a Graphics object has visibly drawn, as centre +
 * radius. Filled shapes come first, then outlines (such as a highlight ring).
 */
export function drawnCircles(circle: PixiGraphics): CircleShape[] {
	const filled: CircleShape[] = [];
	const outlined: CircleShape[] = [];
	for (const d of circle.geometry?.graphicsData ?? []) {
		const shape = d.shape;
		if (!shape) continue;
		const fill = d.fillStyle;
		const line = d.lineStyle;
		const isFilled = fill ? fill.visible !== false && (fill.alpha ?? 1) >= VISIBLE_ALPHA : true;
		const isOutlined =
			!!line && line.visible === true && (line.width ?? 0) > 0 && (line.alpha ?? 1) >= VISIBLE_ALPHA;
		if (!isFilled && !isOutlined) continue;
		const out = isFilled ? filled : outlined;
		const { x = 0, y = 0, width, height, radius } = shape;
		if ((shape.type === 1 || shape.type === 4) && typeof width === "number" && typeof height === "number") {
			if (width > 0 && height > 0) out.push({ x: x + width / 2, y: y + height / 2, radius: Math.min(width, height) / 2 });
		} else if (shape.type === 3 && typeof width === "number" && typeof height === "number") {
			if (width > 0 && height > 0) out.push({ x, y, radius: Math.min(width, height) });
		} else if (typeof radius === "number" && radius > 0) {
			out.push({ x, y, radius });
		} else if (Array.isArray(shape.points) && shape.points.length >= 6) {
			const p = shape.points;
			let x0 = Infinity;
			let y0 = Infinity;
			let x1 = -Infinity;
			let y1 = -Infinity;
			for (let i = 0; i + 1 < p.length; i += 2) {
				x0 = Math.min(x0, p[i]);
				x1 = Math.max(x1, p[i]);
				y0 = Math.min(y0, p[i + 1]);
				y1 = Math.max(y1, p[i + 1]);
			}
			if (x1 > x0 && y1 > y0) out.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, radius: Math.min(x1 - x0, y1 - y0) / 2 });
		}
	}
	return [...filled, ...outlined];
}

/**
 * Where the Graph view actually drew a node's dot, in the dot object's own
 * coordinates.
 *
 * `centre` is where the note sits in the graph's physics, mapped into the
 * dot's coordinates: the visible dot is always drawn there, so it's used to
 * check the measurement. Shapes the dot draws invisibly (like a larger hit
 * area) are ignored.
 */
export function circleShape(circle: PixiGraphics, centre?: Point | null): CircleShape {
	const hint = centre && finite(centre.x, centre.y) ? centre : null;
	const shapes = drawnCircles(circle);

	if (shapes.length > 0) {
		if (!hint) return shapes[0];
		// The visible shape whose centre is nearest the note (the first one drawn wins a tie).
		let best = shapes[0];
		let bestD = Math.hypot(best.x - hint.x, best.y - hint.y);
		for (const c of shapes) {
			const d = Math.hypot(c.x - hint.x, c.y - hint.y);
			if (d < bestD - 1e-6) {
				bestD = d;
				best = c;
			}
		}
		if (bestD < best.radius * 0.35) return best;
		// Wildly far away: the position can't be trusted, so go by the drawing.
		if (bestD > best.radius * 4) return shapes[0];
		// No drawn shape is centred on the note: trust the note's position, keep the drawn size.
		return { x: hint.x, y: hint.y, radius: best.radius };
	}

	// No shape data: use what the object shows on screen (before the pie is added).
	try {
		const b = circle.getLocalBounds?.();
		if (b && finite(b.x, b.y, b.width, b.height) && b.width > 0 && b.height > 0) {
			const radius = Math.min(b.width, b.height) / 2;
			return hint ? { x: hint.x, y: hint.y, radius } : { x: b.x + b.width / 2, y: b.y + b.height / 2, radius };
		}
	} catch {
		/* fall through */
	}
	return { x: hint?.x ?? 0, y: hint?.y ?? 0, radius: 100 };
}

/**
 * Draws the tag colours as a thin ring of arcs around the normal dot, which
 * is left as it is. Calmer than a filled pie, especially on big, busy notes.
 */
export function drawRing(g: PixiGraphics, slices: readonly Slice[], radius: number, style: PieStyle): void {
	g.clear();
	if (slices.length === 0) return;
	const width = radius * 0.3;
	const r = radius * 1.1 + width / 2;
	const angles = sliceAngles(slices, style.weighted);
	// A small gap between colours instead of dividing lines.
	const gap = slices.length > 1 ? Math.min(0.22, ((Math.PI * 2) / slices.length) * 0.16) : 0;
	for (let i = 0; i < slices.length; i++) {
		const [a0, a1] = angles[i];
		const s = a0 + gap / 2;
		const e = a1 - gap / 2;
		if (e <= s) continue;
		g.lineStyle(width, slices[i].rgb, 1, 0.5);
		g.moveTo(Math.cos(s) * r, Math.sin(s) * r);
		g.arc(0, 0, r, s, e);
	}
	g.lineStyle(0);
}

type GraphicsCtor = new () => PixiGraphics;

/**
 * Obsidian ships its own copy of PIXI. Rather than bundle a second one, new
 * shapes are built with the same class the core used for the node circle.
 */
export function graphicsConstructorOf(circle: PixiGraphics): GraphicsCtor | null {
	const ctor = (circle as unknown as { constructor?: GraphicsCtor }).constructor;
	const proto = ctor?.prototype as Partial<PixiGraphics> | undefined;
	if (
		proto &&
		typeof proto.arc === "function" &&
		typeof proto.beginFill === "function" &&
		typeof proto.moveTo === "function" &&
		typeof proto.addChild === "function"
	) {
		return ctor as GraphicsCtor;
	}
	return null;
}
