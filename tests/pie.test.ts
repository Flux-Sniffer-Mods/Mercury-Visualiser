import { describe, expect, it } from "vitest";
import { labelTint } from "../src/graph/linkLabelLayer";
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

describe("label colours", () => {
	it("blends the two notes' colours and lightens them a little", () => {
		const t = labelTint(0xff0000, 0x0000ff);
		expect((t >> 16) & 255).toBeGreaterThan(150);
		expect(t & 255).toBeGreaterThan(150);
		expect((t >> 8) & 255).toBe(Math.round(0 + 255 * 0.35));
	});

	it("uses the only coloured note when the other has no colour", () => {
		expect(labelTint(0x00ff00, null)).toBe(labelTint(0x00ff00, 0x00ff00));
	});

	it("stays plain when neither note has a colour", () => {
		expect(labelTint(null, null)).toBe(0xffffff);
	});
});
