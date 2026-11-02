/** How finely tags are grouped into colours. */
export type TagLevel = "top" | "full";

/** Strips the leading `#` and surrounding whitespace: `#Music/Singer` → `Music/Singer`. */
export function cleanTag(tag: string): string {
	return tag.trim().replace(/^#+/, "").replace(/\/+$/, "");
}

/**
 * The tag a colour is keyed on.
 * - `top`:  `Music/Singer` → `Music`
 * - `full`: `Music/Singer` → `Music/Singer`
 */
export function tagKey(tag: string, level: TagLevel): string {
	const clean = cleanTag(tag);
	if (level === "full") return clean;
	const slash = clean.indexOf("/");
	return slash === -1 ? clean : clean.slice(0, slash);
}

/** Obsidian treats tags case-insensitively, so ids are lower-cased. */
export function tagId(tag: string): string {
	return cleanTag(tag).toLowerCase();
}

/** True when `tag` is `ancestor` or nested somewhere beneath it (`Music/Singer` is under `Music`). */
export function isSameOrNested(tag: string, ancestor: string): boolean {
	const t = tagId(tag);
	const a = tagId(ancestor);
	return t === a || t.startsWith(a + "/");
}

/** Splits a comma/newline separated list of tags typed by the user. */
export function parseTagList(text: string): string[] {
	return text
		.split(/[,\n]/)
		.map((t) => cleanTag(t))
		.filter((t) => t.length > 0);
}

/** Builds the Graph view search query for a tag. */
export function tagQuery(tag: string): string {
	return `tag:#${cleanTag(tag)}`;
}

/**
 * Reads a Graph view colour-group query that targets exactly one tag, such as
 * `tag:#Actor  ` or `tag:Actor`. Returns the tag, or null for anything else
 * (paths, file names, combined queries...).
 */
export function parseTagQuery(query: string): string | null {
	const m = query.match(/^\s*(?:tag:\s*)?#?([^\s#"()[\]:]+)\s*$/i);
	if (!m) return null;
	// A bare word without "tag:" or "#" is a text search, not a tag.
	if (!/^\s*(tag:|#)/i.test(query)) return null;
	return cleanTag(m[1]);
}
