import { MERCURY_COLOURS } from "./mercury";

/**
 * Colour maths for picking tag colours that are as easy to tell apart as possible.
 *
 * Colours are stored the way Obsidian's graph stores them: a 24-bit integer
 * (0xRRGGBB). Distances are measured in OKLab, a perceptual colour space, so
 * "far apart" numerically means "looks different" to a person.
 */

export type Oklab = [number, number, number];

export function rgbIntToHex(rgb: number): string {
	return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0");
}

export function hexToRgbInt(hex: string): number | null {
	let h = hex.trim().replace(/^#/, "");
	if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
	if (!/^[0-9a-f]{6}$/i.test(h)) return null;
	return parseInt(h, 16);
}

/** Parses `#rgb`, `#rrggbb`, `rgb(r, g, b)` and `rgba(...)`. Returns null when unknown. */
export function cssColourToRgbInt(css: string): number | null {
	const value = css.trim();
	if (value.startsWith("#")) return hexToRgbInt(value);
	const m = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
	if (!m) return null;
	const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(parseFloat(v)))));
	return (r << 16) | (g << 8) | b;
}

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbIntToOklab(rgb: number): Oklab {
	const r = srgbToLinear(((rgb >> 16) & 0xff) / 255);
	const g = srgbToLinear(((rgb >> 8) & 0xff) / 255);
	const b = srgbToLinear((rgb & 0xff) / 255);

	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

/** Converts OKLCH to an sRGB integer, or null if the colour is outside the sRGB gamut. */
export function oklchToRgbInt(L: number, C: number, hueDeg: number): number | null {
	const h = (hueDeg * Math.PI) / 180;
	const a = C * Math.cos(h);
	const b = C * Math.sin(h);

	const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
	const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
	const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);

	const lin = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	const eps = 1e-4;
	if (lin.some((v) => v < -eps || v > 1 + eps)) return null;
	const [r, g, bl] = lin.map((v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(v))) * 255));
	return (r << 16) | (g << 8) | bl;
}

/** OKLab back to an sRGB integer, clamped into the screen's range. */
export function oklabToRgbInt([L, a, b]: Oklab): number {
	const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
	const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
	const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
	const lin = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	const [r, g, bl] = lin.map((v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(Math.max(0, Math.min(1, v))))) * 255));
	return (r << 16) | (g << 8) | bl;
}

/**
 * A weighted blend of colours, mixed in OKLab so the result keeps its
 * brightness and doesn't turn muddy the way an RGB average does.
 */
export function mixColours(entries: ReadonlyArray<{ rgb: number; weight: number }>): number | null {
	let total = 0;
	const acc: Oklab = [0, 0, 0];
	for (const { rgb, weight } of entries) {
		if (!(weight > 0)) continue;
		const lab = rgbIntToOklab(rgb);
		acc[0] += lab[0] * weight;
		acc[1] += lab[1] * weight;
		acc[2] += lab[2] * weight;
		total += weight;
	}
	if (total === 0) return null;
	return oklabToRgbInt([acc[0] / total, acc[1] / total, acc[2] / total]);
}

export function oklabDistance(p: Oklab, q: Oklab): number {
	const dl = p[0] - q[0];
	const da = p[1] - q[1];
	const db = p[2] - q[2];
	return Math.sqrt(dl * dl + da * da + db * db);
}

interface Candidate {
	rgb: number;
	lab: Oklab;
	chroma: number;
}

/**
 * Where automatic colours come from: the Mercury palette (default), the whole
 * spectrum within some ranges, or a list of the user's own colours.
 */
export interface ColourPool {
	mode: "mercury" | "spectrum" | "custom";
	/** OKLCH lightness range, 0 (black) to 1 (white). */
	lightness: [number, number];
	/** OKLCH chroma range: 0 is grey, about 0.3 is as vivid as screens go. */
	vividness: [number, number];
	/** Hue range in degrees; a start after the end wraps round through red (e.g. 300 → 60). */
	hues: [number, number];
	/** The user's own colours, used first in "custom" mode. */
	custom: number[];
}

export const DEFAULT_POOL: ColourPool = {
	mode: "mercury",
	lightness: [0.58, 0.82],
	vividness: [0.1, 0.26],
	hues: [0, 360],
	custom: [],
};

export function clonePool(pool: ColourPool): ColourPool {
	return {
		mode: pool.mode,
		lightness: [pool.lightness[0], pool.lightness[1]],
		vividness: [pool.vividness[0], pool.vividness[1]],
		hues: [pool.hues[0], pool.hues[1]],
		custom: [...pool.custom],
	};
}

function spaced(lo: number, hi: number, n: number): number[] {
	const a = Math.min(lo, hi);
	const b = Math.max(lo, hi);
	if (b - a < 1e-6 || n <= 1) return [(a + b) / 2];
	return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/**
 * Hues in the range, every `step` degrees (ends included). A start after the
 * end wraps round through 0°, so 300 → 60 means magentas, reds and oranges.
 * Equal ends mean a single hue; a span of 360° or more means every hue.
 */
export function hueSteps(start: number, end: number, step = 4): number[] {
	const mod = (h: number) => ((h % 360) + 360) % 360;
	if (Math.abs(end - start) >= 360) return Array.from({ length: Math.round(360 / step) }, (_, i) => i * step);
	const s = mod(start);
	const span = (mod(end) - s + 360) % 360;
	const out: number[] = [];
	for (let d = 0; d <= span + 1e-9; d += step) out.push(mod(s + d));
	if (span - (out.length - 1) * step > 1e-6) out.push(mod(end));
	return out;
}

const candidateCache = new Map<string, Candidate[]>();

function makeCandidate(rgb: number, chroma: number): Candidate {
	return { rgb, lab: rgbIntToOklab(rgb), chroma };
}

/** Every colour the spectrum pool may hand out, within its ranges and the sRGB gamut. */
function spectrumCandidates(pool: ColourPool): Candidate[] {
	const key = JSON.stringify([pool.lightness, pool.vividness, pool.hues]);
	const hit = candidateCache.get(key);
	if (hit) return hit;
	const out: Candidate[] = [];
	const seen = new Set<number>();
	const add = (rgb: number | null, C: number) => {
		if (rgb === null || seen.has(rgb)) return;
		seen.add(rgb);
		out.push(makeCandidate(rgb, C));
	};
	const Ls = spaced(pool.lightness[0], pool.lightness[1], 4);
	const Cs = spaced(pool.vividness[0], pool.vividness[1], 5);
	const hues = hueSteps(pool.hues[0], pool.hues[1]);
	for (const L of Ls) for (const C of Cs) for (const h of hues) add(oklchToRgbInt(L, C, h), C);
	// Very vivid choices can fall outside what a screen shows: fall back to the most vivid that fits.
	if (out.length < 8) {
		for (const L of Ls) {
			for (const h of hues) {
				for (let C = Math.max(...Cs); C >= 0; C -= 0.01) {
					const rgb = oklchToRgbInt(L, C, h);
					if (rgb !== null) {
						add(rgb, C);
						break;
					}
				}
			}
		}
	}
	const result = out.length > 0 ? out : spectrumCandidates(DEFAULT_POOL);
	candidateCache.set(key, result);
	return result;
}

/** A warm, saturated starting point used when nothing has a colour yet. */
const FIRST_COLOUR = oklchToRgbInt(0.66, 0.18, 28) ?? 0xe0524a;

function bestOf(list: readonly Candidate[], used: readonly Oklab[]): { c: Candidate; score: number } | null {
	let best: Candidate | null = null;
	let bestScore = -Infinity;
	for (const c of list) {
		// Small preference for vivid colours when two candidates are equally distinct.
		const bonus = c.chroma * 0.01;
		let min = Infinity;
		for (const u of used) {
			const d = oklabDistance(c.lab, u);
			if (d < min) min = d;
			if (min + bonus <= bestScore) break;
		}
		const score = min + bonus;
		if (score > bestScore) {
			bestScore = score;
			best = c;
		}
	}
	return best ? { c: best, score: bestScore } : null;
}

const listCache = new Map<string, Candidate[]>();

/** A fixed list of colours as pick candidates (in list order, so ties go to the earlier one). */
function listCandidates(list: readonly number[]): Candidate[] {
	const key = list.join(",");
	let out = listCache.get(key);
	if (!out) {
		out = [...new Set(list)].map((rgb) => {
			const lab = rgbIntToOklab(rgb);
			return { rgb, lab, chroma: 0 };
		});
		if (listCache.size > 8) listCache.clear();
		listCache.set(key, out);
	}
	return out;
}

/** Below this distance two colours count as the same one. */
const SAME_COLOUR = 0.02;

/**
 * Picks the colour from the pool that is furthest from every colour already
 * in use, so each new tag looks as different as possible from the others.
 * In "mercury" and "custom" modes the Mercury palette or the user's own
 * colours are used first; once they have all been handed out, new tags get
 * colours from the spectrum ranges instead.
 */
export function pickDistinctColour(existing: readonly number[], pool: ColourPool = DEFAULT_POOL): number {
	const used = existing.map(rgbIntToOklab);
	const fixedList = pool.mode === "custom" ? pool.custom : pool.mode === "mercury" ? MERCURY_COLOURS : null;
	if (fixedList && fixedList.length > 0) {
		const own = listCandidates(fixedList);
		if (used.length === 0) return own[0].rgb;
		const pick = bestOf(own, used);
		if (pick && pick.score >= SAME_COLOUR) return pick.c.rgb;
	}
	const list = spectrumCandidates(pool);
	if (used.length === 0) {
		const first = rgbIntToOklab(FIRST_COLOUR);
		return list.reduce((a, b) => (oklabDistance(b.lab, first) < oklabDistance(a.lab, first) ? b : a)).rgb;
	}
	return bestOf(list, used)?.c.rgb ?? FIRST_COLOUR;
}

/**
 * Builds `count` colours that are mutually distinct and also distinct from
 * `fixed` (colours that must not change, such as locked tags).
 */
export function spreadColours(count: number, fixed: readonly number[] = [], pool: ColourPool = DEFAULT_POOL): number[] {
	const used = [...fixed];
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const rgb = pickDistinctColour(used, pool);
		used.push(rgb);
		out.push(rgb);
	}
	return out;
}

/** The smallest pairwise OKLab distance in a palette — a quick "how distinct is this" score. */
export function minPairDistance(colours: readonly number[]): number {
	const labs = colours.map(rgbIntToOklab);
	let min = Infinity;
	for (let i = 0; i < labs.length; i++) {
		for (let j = i + 1; j < labs.length; j++) {
			min = Math.min(min, oklabDistance(labs[i], labs[j]));
		}
	}
	return min;
}
