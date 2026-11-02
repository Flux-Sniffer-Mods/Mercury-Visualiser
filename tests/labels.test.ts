import { describe, expect, it } from "vitest";
import { cleanTitle, labelFor, lineTitle, parseListings } from "../src/labels/listings";

const note = `---
tags:
  - Online/YouTuber
aliases:
  - Someone
---

Side Project: [[Ada Example]], [[Ben Example]],

Series:
- Episode 1: [[Cara Example]],
- Episode 2: [[Dan Example]], [[Eve Example|Eve]],
	- Behind the scenes: [[Fay Example]],
- Special (the long one): [[Gus Example]],
- Live Show (CONTENT) - [[Hal Example]],

Film (Movie):
- Cast: [[Ivy Example]],

Member of: [[Band Example]],
[[Jo Example]], [[Kit Example]]

# Collaborations
- [[Lee Example]]

\`\`\`
Code: [[Not A Link]]
\`\`\`

[[Wonder Example]]: [[Max Example]],

Plain sentence with [[Ned Example]] in it.
`;

const byTarget = () => Object.fromEntries(parseListings(note).map((l) => [l.target, l.path]));

describe("finding listings", () => {
	it("titles single-line listings by the text before the colon", () => {
		const t = byTarget();
		expect(t["Ada Example"]).toEqual(["Side Project"]);
		expect(t["Band Example"]).toEqual(["Member of"]);
	});

	it("gives list items the listing title and their own title", () => {
		const t = byTarget();
		expect(t["Cara Example"]).toEqual(["Series", "Episode 1"]);
		expect(t["Eve Example"]).toEqual(["Series", "Episode 2"]);
		expect(t["Gus Example"]).toEqual(["Series", "Special (the long one)"]);
		expect(t["Ivy Example"]).toEqual(["Film (Movie)", "Cast"]);
	});

	it("follows nested items", () => {
		expect(byTarget()["Fay Example"]).toEqual(["Series", "Episode 2", "Behind the scenes"]);
	});

	it("accepts a dash instead of a colon", () => {
		expect(byTarget()["Hal Example"]).toEqual(["Series", "Live Show (CONTENT)"]);
	});

	it("carries a listing on to the next line", () => {
		expect(byTarget()["Jo Example"]).toEqual(["Member of"]);
	});

	it("uses headings as listing titles", () => {
		expect(byTarget()["Lee Example"]).toEqual(["Collaborations"]);
	});

	it("handles a link used as the title", () => {
		const t = byTarget();
		expect(t["Max Example"]).toEqual(["Wonder Example"]);
		expect(t["Wonder Example"]).toBeUndefined();
	});

	it("ignores front matter and code blocks", () => {
		const targets = parseListings(note).map((l) => l.target);
		expect(targets).not.toContain("Not A Link");
		expect(targets).not.toContain("Someone");
	});

	it("leaves links in ordinary sentences untitled", () => {
		expect(byTarget()["Ned Example"]).toEqual([]);
	});
});

describe("label text", () => {
	const path = ["Series", "Episode 2"];

	it("offers the line's own title, the listing's, or both", () => {
		expect(labelFor(path, "own")).toBe("Episode 2");
		expect(labelFor(path, "listing")).toBe("Series");
		expect(labelFor(path, "path")).toBe("Series › Episode 2");
		expect(labelFor([], "own")).toBeNull();
	});

	it("puts the listing in front of bare numbers", () => {
		expect(labelFor(["Lateral", "3"], "own")).toBe("Lateral › 3");
		expect(labelFor(["Lateral", "Episode 3"], "own")).toBe("Episode 3");
	});

	it("shortens the outer part of a long joined label first", () => {
		const label = labelFor(["The Technical Difficulties", "Citation Needed S6E3"], "path", 34)!;
		expect(label.length).toBeLessThanOrEqual(34);
		expect(label.endsWith("Citation Needed S6E3")).toBe(true);
	});

	it("shortens long labels", () => {
		const long = labelFor(["A very long listing title that goes on and on and on"], "own", 20)!;
		expect(long.length).toBeLessThanOrEqual(20);
		expect(long.endsWith("…")).toBe(true);
	});

	it("cleans markdown out of titles", () => {
		expect(cleanTitle("**[[Wonder Example|WE]] (Movie)**")).toBe("WE (Movie)");
		expect(cleanTitle("  _Cast_ ,")).toBe("Cast");
		expect(lineTitle("Title:").title).toBe("Title");
		expect(lineTitle("No title here [[X]]").title).toBeNull();
	});
});
