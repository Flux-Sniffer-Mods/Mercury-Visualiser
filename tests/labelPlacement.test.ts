import { describe, expect, it } from "vitest";
import { clipToRect } from "../src/graph/linkLabelLayer";

describe("clipping a line to the screen", () => {
	it("keeps a line that is fully on screen", () => {
		expect(clipToRect({ x: 10, y: 10 }, { x: 90, y: 50 }, 100, 100)).toEqual([
			{ x: 10, y: 10 },
			{ x: 90, y: 50 },
		]);
	});

	it("cuts a line that runs off both sides down to the part in view", () => {
		const seg = clipToRect({ x: -100, y: 50 }, { x: 300, y: 50 }, 200, 100);
		expect(seg).toEqual([
			{ x: 0, y: 50 },
			{ x: 200, y: 50 },
		]);
	});

	it("cuts a diagonal line at the screen edge", () => {
		const seg = clipToRect({ x: 50, y: 50 }, { x: 150, y: 150 }, 100, 100)!;
		expect(seg[0]).toEqual({ x: 50, y: 50 });
		expect(seg[1].x).toBeCloseTo(100);
		expect(seg[1].y).toBeCloseTo(100);
	});

	it("returns nothing for a line entirely off screen", () => {
		expect(clipToRect({ x: -50, y: -50 }, { x: -10, y: 80 }, 100, 100)).toBeNull();
		expect(clipToRect({ x: 120, y: 10 }, { x: 140, y: 90 }, 100, 100)).toBeNull();
	});
});
