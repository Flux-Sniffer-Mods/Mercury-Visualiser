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

const finite = (...v: number[]) => v.every((n) => Number.isFinite(n));

/**
 * Where the Graph view actually drew a node's circle, in that object's own
 * coordinates. The circle isn't necessarily centred on (0, 0), so the pie is
 * placed on the measured centre rather than assumed to share it.
 */
export function circleShape(circle: PixiGraphics): CircleShape {
	// 1. The bounds of what the circle itself drew (ignores anything added on top).
	try {
		const b = circle.geometry?.bounds;
		if (b && finite(b.minX, b.minY, b.maxX, b.maxY) && b.maxX > b.minX && b.maxY > b.minY) {
			return {
				x: (b.minX + b.maxX) / 2,
				y: (b.minY + b.maxY) / 2,
				radius: Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2,
			};
		}
	} catch {
		/* fall through */
	}
	// 2. The first shape drawn: a circle (centre + radius) or a (rounded) rectangle.
	const shape = circle.geometry?.graphicsData?.[0]?.shape;
	if (shape) {
		const { x = 0, y = 0, width, height, radius } = shape;
		const rectLike = shape.type === 1 || shape.type === 4;
		if (rectLike && typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
			return { x: x + width / 2, y: y + height / 2, radius: Math.min(width, height) / 2 };
		}
		if (typeof radius === "number" && radius > 0) return { x, y, radius };
	}
	// 3. Whatever is on screen for the object (taken before the pie is added).
	try {
		const b = circle.getLocalBounds?.();
		if (b && finite(b.x, b.y, b.width, b.height) && b.width > 0 && b.height > 0) {
			return { x: b.x + b.width / 2, y: b.y + b.height / 2, radius: Math.min(b.width, b.height) / 2 };
		}
	} catch {
		/* fall through */
	}
	return { x: 0, y: 0, radius: 100 };
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
