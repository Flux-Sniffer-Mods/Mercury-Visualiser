import { clonePool, DEFAULT_POOL, type ColourPool } from "./colour/colour";
import type { DensityStyle } from "./graph/detailLayer";
import type { LabelMode } from "./labels/listings";
import type { TagLevel } from "./tags/tagKey";

export type RadialStyle = "spokes" | "rings";

export interface PaletteRecord {
	/** Tag as first seen, e.g. `Music` (the id is the lower-cased key). */
	name: string;
	rgb: number;
	/** Locked colours are kept when colours are re-spread. */
	locked: boolean;
	/** Stable position used to order pie slices. */
	order: number;
}

export interface MercurySettings {
	// 1. Automatic tag colours
	autoColours: boolean;
	tagLevel: TagLevel;
	minNotesPerTag: number;
	ignoredTags: string;
	/** Where new tag colours are picked from. */
	colourPool: ColourPool;
	syncGraphColourGroups: boolean;
	removeStaleGroups: boolean;
	palette: Record<string, PaletteRecord>;
	/** Tag id → colour last written to the Graph view; marks the groups this plugin maintains. */
	managedGroups: Record<string, number>;
	/** Tag ids whose colour group this plugin added (removed again when the feature is switched off). */
	createdGroups: string[];
	nextOrder: number;

	// 2. Radial layout
	radialLayout: boolean;
	radialStyle: RadialStyle;
	radialGlobalGraph: boolean;
	radialLocalGraph: boolean;
	matchGraphLinkDistance: boolean;
	spokeLength: number;
	splayStrength: number;
	repelMultiplier: number;
	animateLayout: boolean;

	// 3. Pie-chart nodes
	pieNodes: boolean;
	pieMinColours: 1 | 2;
	pieWeighted: boolean;
	pieOutline: boolean;
	pieTagNodes: boolean;
	/** "ring": coloured arcs around the normal dot; "filled": the dot becomes a pie. */
	pieStyle: "ring" | "filled";
	/** Show slices only when zoomed in, fading in with note names. */
	pieFade: boolean;

	// 4. Link labels
	linkLabels: boolean;
	/** Tint labels at all. */
	linkLabelColours: boolean;
	/** "ends": blend the two notes the line joins; "listing": everyone in the listing, weighted to its main tags. */
	linkLabelColourBy: "ends" | "listing";
	linkLabelMode: LabelMode;
	/** "names": next to the note names at each end of a long line; "middle": once along the line. */
	linkLabelPlacement: "names" | "middle";
	linkLabelMax: number;

	// 5. Level of detail
	levelOfDetail: boolean;
	lodCulling: boolean;
	lodDensityMap: boolean;
	lodMapBelowPx: number;
	lodDensityStyle: DensityStyle;
	/** 0 = crisp, 3 = very soft. */
	lodMapSoftness: number;
	/** Drop the least important dots and lines as you zoom out. */
	lodThinOut: boolean;
	/** Most of the dots (0–1) dropped, just before the density map takes over. */
	lodThinAmount: number;

	// General
	showGraphToolbar: boolean;
}

export const DEFAULT_SETTINGS: MercurySettings = {
	autoColours: true,
	tagLevel: "top",
	minNotesPerTag: 1,
	ignoredTags: "",
	colourPool: clonePool(DEFAULT_POOL),
	syncGraphColourGroups: true,
	removeStaleGroups: true,
	palette: {},
	managedGroups: {},
	createdGroups: [],
	nextOrder: 0,

	radialLayout: true,
	radialStyle: "spokes",
	radialGlobalGraph: true,
	radialLocalGraph: true,
	matchGraphLinkDistance: true,
	spokeLength: 250,
	splayStrength: 0.6,
	repelMultiplier: 1,
	animateLayout: true,

	pieNodes: true,
	pieMinColours: 2,
	pieWeighted: false,
	pieOutline: true,
	pieTagNodes: true,
	pieStyle: "ring",
	pieFade: true,

	linkLabels: true,
	linkLabelColours: true,
	linkLabelColourBy: "ends",
	linkLabelMode: "own",
	linkLabelPlacement: "names",
	linkLabelMax: 120,

	levelOfDetail: true,
	lodCulling: true,
	lodDensityMap: true,
	lodMapBelowPx: 1.6,
	lodDensityStyle: "tags",
	lodMapSoftness: 1,
	lodThinOut: true,
	lodThinAmount: 0.7,

	showGraphToolbar: true,
};

export function mergeSettings(saved: Partial<MercurySettings> | null | undefined): MercurySettings {
	const s: MercurySettings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	s.palette = { ...(saved?.palette ?? {}) };
	s.managedGroups = { ...(saved?.managedGroups ?? {}) };
	s.createdGroups = [...(saved?.createdGroups ?? [])];
	s.colourPool = clonePool({ ...DEFAULT_POOL, ...(saved?.colourPool ?? {}) });
	return s;
}
