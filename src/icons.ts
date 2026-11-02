import { getIcon } from "obsidian";

/**
 * Icon names have changed between versions of the icon set Obsidian ships
 * (e.g. `pie-chart` became `chart-pie`), so each icon lists the names to try.
 */
const ICONS = {
	palette: ["palette"],
	radial: ["sun"],
	pie: ["chart-pie", "pie-chart"],
	rerun: ["refresh-cw"],
	lock: ["lock"],
	unlock: ["lock-open", "unlock"],
	reroll: ["shuffle", "dices", "dice"],
	labels: ["tag", "tags"],
	detail: ["layers", "layers-3", "gauge"],
} as const;

export type IconKey = keyof typeof ICONS;

const resolved = new Map<IconKey, string>();

/** The first of the icon's names that this version of Obsidian knows. */
export function icon(key: IconKey): string {
	let name = resolved.get(key);
	if (name) return name;
	const names = ICONS[key];
	name = names.find((n) => {
		try {
			return getIcon(n) !== null;
		} catch {
			return false;
		}
	}) ?? names[0];
	resolved.set(key, name);
	return name;
}
