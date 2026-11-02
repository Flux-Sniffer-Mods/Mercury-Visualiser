import { describe, expect, it } from "vitest";
import { MERCURY_COLOURS } from "../src/colour/mercury";
import {
	DEFAULT_POOL,
	hueSteps,
	type ColourPool,
	cssColourToRgbInt,
	hexToRgbInt,
	minPairDistance,
	oklabDistance,
	oklchToRgbInt,
	pickDistinctColour,
	rgbIntToHex,
	rgbIntToOklab,
	spreadColours,
} from "../src/colour/colour";

describe("colour conversions", () => {
	it("round-trips hex and integers", () => {
		expect(rgbIntToHex(0xff8800)).toBe("#ff8800");
		expect(rgbIntToHex(0)).toBe("#000000");
		expect(hexToRgbInt("#ff8800")).toBe(0xff8800);
		expect(hexToRgbInt("f80")).toBe(0xff8800);
		expect(hexToRgbInt("nope")).toBeNull();
	});

	it("parses CSS colours", () => {
		expect(cssColourToRgbInt("#1e1e1e")).toBe(0x1e1e1e);
		expect(cssColourToRgbInt("rgb(30, 30, 30)")).toBe(0x1e1e1e);
		expect(cssColourToRgbInt("rgba(255,255,255,0.5)")).toBe(0xffffff);
		expect(cssColourToRgbInt("var(--x)")).toBeNull();
	});

	it("maps black and white to the ends of OKLab lightness", () => {
		expect(rgbIntToOklab(0x000000)[0]).toBeCloseTo(0, 3);
		expect(rgbIntToOklab(0xffffff)[0]).toBeCloseTo(1, 3);
	});

	it("converts OKLCH back to the same colour", () => {
		const rgb = oklchToRgbInt(0.7, 0.12, 250);
		expect(rgb).not.toBeNull();
		const lab = rgbIntToOklab(rgb!);
		expect(lab[0]).toBeCloseTo(0.7, 2);
		expect(Math.hypot(lab[1], lab[2])).toBeCloseTo(0.12, 2);
		expect(oklchToRgbInt(0.7, 0, 0)).toBe(0x9e9e9e);
	});

	it("rejects colours outside sRGB", () => {
		expect(oklchToRgbInt(0.9, 0.4, 140)).toBeNull();
	});
});

describe("distinct colour picking", () => {
	it("picks something far from the colours already in use", () => {
		const used = [0xe0524a, 0x4a90e0];
		const next = pickDistinctColour(used);
		const lab = rgbIntToOklab(next);
		for (const u of used) expect(oklabDistance(lab, rgbIntToOklab(u))).toBeGreaterThan(0.15);
	});

	const spectrum: ColourPool = { ...DEFAULT_POOL, mode: "spectrum" };

	it("never repeats a colour", () => {
		expect(new Set(spreadColours(86, [], spectrum)).size).toBe(86);
		expect(new Set(spreadColours(86)).size).toBe(86);
	});

	it("keeps a useful gap between colours for a typical number of tags", () => {
		expect(minPairDistance(spreadColours(12, [], spectrum))).toBeGreaterThan(0.12);
		expect(minPairDistance(spreadColours(30, [], spectrum))).toBeGreaterThan(0.07);
	});

	it("respects colours that are fixed", () => {
		const fixed = [0x000000, 0xb7001a];
		const added = spreadColours(5, fixed);
		for (const c of added) expect(fixed).not.toContain(c);
	});
});

describe("colour pools", () => {
	const hueOf = (rgb: number) => {
		const [, a, b] = rgbIntToOklab(rgb);
		return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
	};

	it("lists hue steps, wrapping round through red", () => {
		const wrap = hueSteps(300, 60, 30);
		expect(wrap).toContain(300);
		expect(wrap).toContain(0);
		expect(wrap).toContain(60);
		expect(wrap).not.toContain(180);
		expect(hueSteps(0, 360, 90)).toEqual([0, 90, 180, 270]);
		expect(hueSteps(120, 120)).toEqual([120]);
	});

	it("defaults to the Mercury palette, most distinct colours first", () => {
		expect(DEFAULT_POOL.mode).toBe("mercury");
		const picks = spreadColours(MERCURY_COLOURS.length);
		expect(picks[0]).toBe(MERCURY_COLOURS[0]);
		expect(new Set(picks)).toEqual(new Set(MERCURY_COLOURS));
		expect(minPairDistance(picks.slice(0, 12))).toBeGreaterThan(0.1);
		// After the palette is used up, new tags still get new colours.
		const more = spreadColours(MERCURY_COLOURS.length + 5).slice(MERCURY_COLOURS.length);
		for (const c of more) expect(MERCURY_COLOURS).not.toContain(c);
	});

	it("picks the Mercury colour least like the colours already taken", () => {
		const taken = [MERCURY_COLOURS[0], MERCURY_COLOURS[1]];
		const next = pickDistinctColour(taken);
		expect(MERCURY_COLOURS).toContain(next);
		expect(taken).not.toContain(next);
	});

	it("keeps spectrum picks inside the chosen hue and brightness ranges", () => {
		const pool: ColourPool = { ...DEFAULT_POOL, mode: "spectrum", hues: [200, 260], lightness: [0.5, 0.6] };
		for (const c of spreadColours(12, [], pool)) {
			const h = hueOf(c);
			expect(h).toBeGreaterThan(195);
			expect(h).toBeLessThan(265);
			const L = rgbIntToOklab(c)[0];
			expect(L).toBeGreaterThan(0.49);
			expect(L).toBeLessThan(0.61);
		}
	});

	it("uses your own colours first, then falls back to the spectrum", () => {
		const custom = [0xe63946, 0x457b9d, 0x2a9d8f];
		const pool: ColourPool = { ...DEFAULT_POOL, mode: "custom", custom };
		const picks = spreadColours(6, [], pool);
		expect(new Set(picks.slice(0, 3))).toEqual(new Set(custom));
		for (const c of picks.slice(3)) expect(custom).not.toContain(c);
		expect(new Set(picks).size).toBe(6);
	});

	it("skips your colours that are already taken", () => {
		const pool: ColourPool = { ...DEFAULT_POOL, mode: "custom", custom: [0xe63946, 0x457b9d] };
		expect(pickDistinctColour([0xe63946], pool)).toBe(0x457b9d);
	});

	it("still finds colours when the ranges are very narrow", () => {
		const pool: ColourPool = { ...DEFAULT_POOL, mode: "spectrum", lightness: [0.9, 0.9], vividness: [0.32, 0.32], hues: [140, 140] };
		expect(spreadColours(3, [], pool)).toHaveLength(3);
	});
});
