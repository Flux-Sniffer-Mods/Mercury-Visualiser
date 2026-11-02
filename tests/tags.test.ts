import { describe, expect, it } from "vitest";
import groupsFixture from "./fixtures/colour-groups.json";
import { syncColourGroups, tagColoursFromGroups, type ColourGroup } from "../src/tags/colourGroups";
import { sliceAngles, slicesFromGroups, slicesFromPalette } from "../src/tags/slices";
import { isSameOrNested, parseTagList, parseTagQuery, tagKey } from "../src/tags/tagKey";

const vaultGroups = groupsFixture as ColourGroup[];

describe("tag keys", () => {
	it("groups by top-level or full tag", () => {
		expect(tagKey("#Music/Singer", "top")).toBe("Music");
		expect(tagKey("Music/Singer", "full")).toBe("Music/Singer");
		expect(tagKey("#Actor", "top")).toBe("Actor");
	});

	it("matches nested tags like Obsidian search", () => {
		expect(isSameOrNested("Music/Singer", "music")).toBe(true);
		expect(isSameOrNested("Music", "Music")).toBe(true);
		expect(isSameOrNested("Musical", "Music")).toBe(false);
	});

	it("parses typed lists", () => {
		expect(parseTagList("#Bald, IRL-Friend\n Music/ ")).toEqual(["Bald", "IRL-Friend", "Music"]);
	});

	it("reads single-tag colour group queries, including the vault's padded ones", () => {
		expect(parseTagQuery("tag:#Not-Public-Figure  ")).toBe("Not-Public-Figure");
		expect(parseTagQuery("tag:#Politician ")).toBe("Politician");
		expect(parseTagQuery("tag:Actor")).toBe("Actor");
		expect(parseTagQuery("#Music/Singer")).toBe("Music/Singer");
		expect(parseTagQuery("path:People")).toBeNull();
		expect(parseTagQuery("tag:#Actor OR tag:#Director")).toBeNull();
		expect(parseTagQuery("Actor")).toBeNull();
	});

	it("understands every colour group in the Project Mercury vault", () => {
		const parsed = vaultGroups.map((g) => parseTagQuery(g.query));
		expect(parsed.every((t) => t !== null)).toBe(true);
		expect(tagColoursFromGroups(vaultGroups)).toHaveLength(19);
	});
});

describe("syncing with the Graph view's colour groups", () => {
	const entries = [
		{ id: "actor", name: "Actor", rgb: 0x111111 },
		{ id: "music", name: "Music", rgb: 13107455 },
		{ id: "poketuber", name: "PokeTuber", rgb: 0x22aa44 },
	];

	it("adopts colours from hand-made groups and appends missing tags", () => {
		const result = syncColourGroups({
			groups: vaultGroups,
			entries,
			managed: {},
			created: [],
			removeStale: true,
		});
		// The hand-picked Actor colour wins over the palette's guess.
		expect(result.adopted.actor).toBe(179939);
		expect(result.groups.find((g) => g.query.includes("Actor"))!.color.rgb).toBe(179939);
		// New tag appended at the end with the palette colour.
		const last = result.groups[result.groups.length - 1];
		expect(last).toEqual({ query: "tag:#PokeTuber", color: { a: 1, rgb: 0x22aa44 } });
		expect(result.appended).toEqual(["poketuber"]);
		// All original groups are still there, in order.
		expect(result.groups.slice(0, vaultGroups.length)).toEqual(vaultGroups);
		expect(result.changed).toBe(true);
	});

	it("writes palette changes for groups it already manages", () => {
		const groups: ColourGroup[] = [{ query: "tag:#Music", color: { a: 1, rgb: 0xaaaaaa } }];
		const result = syncColourGroups({
			groups,
			entries: [{ id: "music", name: "Music", rgb: 0xbbbbbb }],
			managed: { music: 0xaaaaaa },
			created: [],
			removeStale: true,
		});
		expect(result.groups[0].color.rgb).toBe(0xbbbbbb);
		expect(result.adopted).toEqual({});
		expect(result.changed).toBe(true);
	});

	it("adopts edits made in the Graph view's own panel", () => {
		const groups: ColourGroup[] = [{ query: "tag:#Music", color: { a: 1, rgb: 0xcccccc } }];
		const result = syncColourGroups({
			groups,
			entries: [{ id: "music", name: "Music", rgb: 0xaaaaaa }],
			managed: { music: 0xaaaaaa },
			created: [],
			removeStale: true,
		});
		expect(result.adopted.music).toBe(0xcccccc);
		expect(result.groups[0].color.rgb).toBe(0xcccccc);
		expect(result.changed).toBe(false);
	});

	it("only removes stale groups it created itself", () => {
		const groups: ColourGroup[] = [
			{ query: "tag:#Gone", color: { a: 1, rgb: 1 } },
			{ query: "tag:#Handmade", color: { a: 1, rgb: 2 } },
			{ query: "path:Archive", color: { a: 1, rgb: 3 } },
		];
		const result = syncColourGroups({
			groups,
			entries: [],
			managed: { gone: 1, handmade: 2 },
			created: ["gone"],
			removeStale: true,
		});
		expect(result.groups.map((g) => g.query)).toEqual(["tag:#Handmade", "path:Archive"]);
		expect(result.removed).toEqual(["gone"]);
	});

	it("is stable: a second pass changes nothing", () => {
		const first = syncColourGroups({ groups: vaultGroups, entries, managed: {}, created: [], removeStale: true });
		const palette = entries.map((e) => ({ ...e, rgb: first.adopted[e.id] ?? e.rgb }));
		const second = syncColourGroups({
			groups: first.groups,
			entries: palette,
			managed: first.managed,
			created: first.appended,
			removeStale: true,
		});
		expect(second.changed).toBe(false);
		expect(second.groups).toEqual(first.groups);
	});
});

describe("pie slices", () => {
	const palette: Record<string, { rgb: number; order: number }> = {
		music: { rgb: 0xff0000, order: 1 },
		online: { rgb: 0x00ff00, order: 0 },
		actor: { rgb: 0x0000ff, order: 2 },
	};

	it("gives each tag colour a slice, in palette order", () => {
		const slices = slicesFromPalette(["Music/Singer", "Music/Rapper", "Online/YouTuber"], "top", (id) => palette[id]);
		expect(slices).toEqual([
			{ rgb: 0x00ff00, weight: 1 },
			{ rgb: 0xff0000, weight: 2 },
		]);
	});

	it("ignores tags without a colour", () => {
		expect(slicesFromPalette(["Bald"], "top", (id) => palette[id])).toEqual([]);
	});

	it("uses Graph view groups (with nested matching) when auto colours are off", () => {
		const groups = tagColoursFromGroups(vaultGroups);
		const slices = slicesFromGroups(["Music/Producer", "Online/YouTuber", "Athlete/eSports"], groups);
		expect(slices.map((s) => s.rgb)).toEqual([1376020, 15671071, 13107455]);
	});

	it("merges groups that share a colour into one slice", () => {
		const slices = slicesFromGroups(["A", "B"], [
			{ id: "a", rgb: 5 },
			{ id: "b", rgb: 5 },
		]);
		expect(slices).toEqual([{ rgb: 5, weight: 2 }]);
	});

	it("splits the circle evenly or by weight", () => {
		const slices = [
			{ rgb: 1, weight: 1 },
			{ rgb: 2, weight: 3 },
		];
		const even = sliceAngles(slices, false);
		expect(even[0][1] - even[0][0]).toBeCloseTo(Math.PI);
		const weighted = sliceAngles(slices, true);
		expect(weighted[1][1] - weighted[1][0]).toBeCloseTo((3 / 4) * Math.PI * 2);
		expect(weighted[1][1]).toBeCloseTo(-Math.PI / 2 + Math.PI * 2);
	});
});
