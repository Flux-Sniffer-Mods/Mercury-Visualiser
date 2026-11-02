import { describe, expect, it } from "vitest";
import { mixColours, oklabDistance, rgbIntToOklab } from "../src/colour/colour";
import { listingColour } from "../src/labels/labelColour";

const dist = (a: number, b: number) => oklabDistance(rgbIntToOklab(a), rgbIntToOklab(b));
const COMEDIAN = 0xe0524a;
const PRESENTER = 0x3d61ea;
const ACTOR = 0x42d1b7;

describe("colour mixing", () => {
	it("gives back a single colour unchanged", () => {
		for (const c of [COMEDIAN, PRESENTER, ACTOR, 0x000000, 0xffffff]) {
			expect(dist(mixColours([{ rgb: c, weight: 1 }])!, c)).toBeLessThan(0.005);
		}
	});

	it("ignores colours with no weight", () => {
		expect(mixColours([{ rgb: COMEDIAN, weight: 0 }])).toBeNull();
	});
});

describe("listing colours", () => {
	it("leans clearly towards the tag most of the listing shares", () => {
		const one = (rgb: number) => [{ rgb, weight: 1 }];
		const c = listingColour([one(COMEDIAN), one(COMEDIAN), one(COMEDIAN), one(COMEDIAN), one(PRESENTER)])!;
		// 4 votes against 1, squared: 16 to 1.
		expect(dist(c, COMEDIAN)).toBeLessThan(dist(c, PRESENTER) / 4);
	});

	it("splits a person's vote between their tags", () => {
		const both = [
			{ rgb: COMEDIAN, weight: 1 },
			{ rgb: ACTOR, weight: 1 },
		];
		// One comedian-actor and one actor: actor has 1.5 votes, comedian 0.5.
		const c = listingColour([both, [{ rgb: ACTOR, weight: 1 }]])!;
		expect(dist(c, ACTOR)).toBeLessThan(dist(c, COMEDIAN));
	});

	it("is the person's own colour for a listing of one", () => {
		expect(dist(listingColour([[{ rgb: ACTOR, weight: 1 }]])!, ACTOR)).toBeLessThan(0.005);
	});

	it("has no colour when nobody listed has a tag colour", () => {
		expect(listingColour([[], []])).toBeNull();
	});
});
