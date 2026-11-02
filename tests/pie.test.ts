import { describe, expect, it } from "vitest";
import { circleShape, drawnCircles } from "../src/graph/pie";
import type { PixiGraphics } from "../src/graph/internals";

/**
 * A dot drawn the way the Graph view on Obsidian mobile draws it (from a
 * diagnostics report): the visible circle at (100, 100) with radius 100, plus
 * a far bigger, almost transparent touch target around it.
 */
function obsidianDot(): PixiGraphics {
	return {
		geometry: {
			graphicsData: [
				{
					shape: { type: 2, x: 100, y: 100, radius: 100 },
					fillStyle: { visible: true, alpha: 1 },
					lineStyle: { visible: false, width: 0 },
				},
				{
					shape: { type: 2, x: 100, y: 100, radius: 500 },
					fillStyle: { visible: true, alpha: 0.0001 },
					lineStyle: { visible: false, width: 0 },
				},
			],
		},
		getLocalBounds: () => ({ x: -400, y: -400, width: 1000, height: 1000 }),
	} as unknown as PixiGraphics;
}

describe("measuring a dot", () => {
	it("ignores the almost transparent touch target", () => {
		expect(drawnCircles(obsidianDot())).toEqual([{ x: 100, y: 100, radius: 100 }]);
	});

	it("matches the visible dot when the note's position is known", () => {
		expect(circleShape(obsidianDot(), { x: 100, y: 100 })).toEqual({ x: 100, y: 100, radius: 100 });
	});

	it("still matches the dot when the position is stale (dot off screen)", () => {
		expect(circleShape(obsidianDot(), { x: -12569.7, y: -18195.9 })).toEqual({ x: 100, y: 100, radius: 100 });
		expect(circleShape(obsidianDot(), null)).toEqual({ x: 100, y: 100, radius: 100 });
	});

	it("follows the note when the drawing is a little off it", () => {
		expect(circleShape(obsidianDot(), { x: 160, y: 100 })).toEqual({ x: 160, y: 100, radius: 100 });
	});

	it("falls back to the outline when no shapes are listed", () => {
		const dot = { getLocalBounds: () => ({ x: 0, y: 0, width: 200, height: 200 }) } as unknown as PixiGraphics;
		expect(circleShape(dot)).toEqual({ x: 100, y: 100, radius: 100 });
	});
});
