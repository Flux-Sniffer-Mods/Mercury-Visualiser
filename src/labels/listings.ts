/**
 * Finds the "listing" each link sits in, so graph lines can be labelled with
 * it. Notes in Project Mercury list people like this:
 *
 *     Turbopunch: [[Eddie Bowley]], [[Elliot Gough]],
 *
 *     asdf:
 *     - asdfmovie2: [[Slomozovo]], [[Scarfdemon]],
 *     - asdfmovie4: [[Jack Howard]],
 *
 * The title of a listing is whatever comes before the colon. A link gets the
 * path of titles above it: `Eddie Bowley` → ["Turbopunch"],
 * `Jack Howard` → ["asdf", "asdfmovie4"].
 */

export type LabelMode = "own" | "listing" | "path";

export interface ListedLink {
	/** The link target as written, e.g. `Jack Howard` (no heading, block or alias). */
	target: string;
	/** Titles from the outermost listing down to the link's own line. */
	path: string[];
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const LINK = /!?\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** Turns `**[[Wonder Woman|WW]] (Movie)**` into `WW (Movie)`. */
export function cleanTitle(raw: string): string | null {
	const text = raw
		.replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
		.replace(/!?\[\[([^\]]*)\]\]/g, (_, t: string) => t.replace(/[#^].*$/, ""))
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|~~|==|`)/g, "")
		.replace(/(^|\s)[*_](\S)/g, "$1$2")
		.replace(/(\S)[*_](\s|$)/g, "$1$2")
		.replace(/\s+/g, " ")
		.replace(/[\s,;]+$/, "")
		.trim();
	return text.length > 0 ? text : null;
}

/**
 * The title a line gives the links on it (and below it), or null.
 * - `Title: [[A]], [[B]]` and `Title - [[A]]` → `Title`
 * - `Title:` on its own → `Title`
 * - `[[Wonder Woman]]: [[Chris Pine]]` → `Wonder Woman`
 */
export function lineTitle(content: string): { title: string | null; linksFrom: number } {
	const firstLink = content.indexOf("[[");
	const before = firstLink === -1 ? content : content.slice(0, firstLink);
	const colon = before.lastIndexOf(":");
	if (colon !== -1) return { title: cleanTitle(before.slice(0, colon)), linksFrom: 0 };
	const dash = before.match(/^(.*\S)\s+[-–—]\s*$/);
	if (dash) return { title: cleanTitle(dash[1]), linksFrom: 0 };
	if (firstLink === -1) {
		return { title: /:\s*$/.test(content) ? cleanTitle(content.replace(/:\s*$/, "")) : null, linksFrom: 0 };
	}
	// A link used as the title: `[[Wonder Woman]]: [[Chris Pine]]`.
	if (before.trim() === "") {
		const m = content.match(/^\s*(!?\[\[[^\]]+\]\])\s*:/);
		if (m) return { title: cleanTitle(m[1]), linksFrom: m[0].length };
	}
	return { title: null, linksFrom: 0 };
}

function linksIn(content: string, from: number): string[] {
	const out: string[] = [];
	LINK.lastIndex = from;
	let m: RegExpExecArray | null;
	while ((m = LINK.exec(content)) !== null) {
		const target = m[1].trim();
		if (target) out.push(target);
	}
	return out;
}

function indentOf(ws: string): number {
	let n = 0;
	for (const ch of ws) n += ch === "\t" ? 4 : 1;
	return n;
}

export function parseListings(text: string): ListedLink[] {
	const lines = text.split(/\r?\n/);
	let i = 0;
	// Skip front matter.
	if (lines[0]?.trim() === "---") {
		const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
		i = end === -1 ? lines.length : end + 1;
	}

	const out: ListedLink[] = [];
	let header: string | null = null;
	let headerHasLinks = false;
	let stack: Array<{ indent: number; title: string | null }> = [];
	let fence: string | null = null;

	for (; i < lines.length; i++) {
		const line = lines[i];
		const fenceMatch = line.match(/^\s*(```+|~~~+)/);
		if (fence) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1];
			continue;
		}

		if (line.trim() === "") {
			stack = [];
			// A bare "Title:" line can be followed by a blank line before its list.
			if (headerHasLinks) header = null;
			continue;
		}

		const heading = line.match(HEADING);
		if (heading) {
			header = cleanTitle(heading[1].replace(/:\s*$/, ""));
			headerHasLinks = false;
			stack = [];
			continue;
		}

		const item = line.match(LIST_ITEM);
		if (item) {
			const indent = indentOf(item[1]);
			while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
			const { title, linksFrom } = lineTitle(item[2]);
			const path = [header, ...stack.map((s) => s.title), title].filter((t): t is string => !!t);
			for (const target of linksIn(item[2], linksFrom)) out.push({ target, path });
			stack.push({ indent, title });
			continue;
		}

		// An ordinary line: either starts a listing ("Title: ...") or carries on the one above.
		stack = [];
		const { title, linksFrom } = lineTitle(line);
		const links = linksIn(line, linksFrom);
		if (title) {
			header = title;
			headerHasLinks = links.length > 0;
			for (const target of links) out.push({ target, path: [title] });
		} else if (links.length > 0) {
			for (const target of links) out.push({ target, path: header ? [header] : [] });
		} else {
			header = null;
		}
	}
	return out;
}

/** Titles like "3", "#12" or "4b" say little on their own. */
const BARE_NUMBER = /^[#№]?\s*\d{1,4}[a-z]?\.?$/i;

function shorten(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}

/**
 * The label to show for a link, given its listing path.
 * - `own`: the link's own line (`asdfmovie4`), or the listing if the line has
 *   none. Bare numbers (`3`) get their listing in front (`Lateral › 3`).
 * - `listing`: the outermost listing (`asdf`).
 * - `path`: outermost and own, joined (`asdf › asdfmovie4`).
 * When a joined label is too long, the outer part is shortened first so the
 * specific part stays readable.
 */
export function labelFor(path: readonly string[], mode: LabelMode, maxLength = 42): string | null {
	if (path.length === 0) return null;
	const own = path[path.length - 1];
	const outer = path[0];
	if (mode === "listing") return shorten(outer, maxLength);
	const joined = (mode === "path" || BARE_NUMBER.test(own)) && path.length > 1;
	if (!joined) return shorten(own, maxLength);
	const sep = " › ";
	if (outer.length + sep.length + own.length <= maxLength) return outer + sep + own;
	const room = maxLength - sep.length - Math.min(own.length, Math.ceil(maxLength * 0.6));
	return shorten(outer, Math.max(4, room)) + sep + shorten(own, maxLength - sep.length - Math.max(4, room) + 1);
}
