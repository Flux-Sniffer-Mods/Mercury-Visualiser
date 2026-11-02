import { debounce, normalizePath, type DataAdapter } from "obsidian";

export interface CachedLayout {
	/** Shape of the graph the layout was made for (node count, link count, id hash). */
	signature: string;
	/** Layout settings it was made with; a change means it is out of date. */
	settings: string;
	ids: string[];
	/** x0, y0, x1, y1, ... rounded to whole units. */
	positions: number[];
}

interface CacheFile {
	version: 1;
	layouts: Record<string, CachedLayout>;
}

/**
 * Remembers the main graph's radial layout between sessions, so reopening the
 * Graph view in a big vault shows the finished layout straight away instead of
 * working it out again. Stored beside the plugin, not in its settings, so the
 * settings file stays small.
 */
export class LayoutCache {
	private data: CacheFile = { version: 1, layouts: {} };
	private loaded = false;
	private readonly path: string;
	private readonly scheduleSave = debounce(() => void this.save(), 2000, true);

	constructor(private adapter: DataAdapter, pluginDir: string) {
		this.path = normalizePath(`${pluginDir}/layout-cache.json`);
	}

	async load(): Promise<void> {
		try {
			if (await this.adapter.exists(this.path)) {
				const parsed = JSON.parse(await this.adapter.read(this.path)) as CacheFile;
				if (parsed?.version === 1 && parsed.layouts) this.data = parsed;
			}
		} catch (e) {
			console.warn("Mercury Visualiser: ignoring unreadable layout cache", e);
		}
		this.loaded = true;
	}

	get(key: string): CachedLayout | undefined {
		return this.loaded ? this.data.layouts[key] : undefined;
	}

	set(key: string, layout: CachedLayout): void {
		this.data.layouts[key] = layout;
		this.scheduleSave();
	}

	/** Moves one node in a cached layout (after it was dragged somewhere new). */
	move(key: string, id: string, x: number, y: number): void {
		const layout = this.data.layouts[key];
		if (!layout) return;
		const i = layout.ids.indexOf(id);
		if (i === -1) return;
		layout.positions[2 * i] = Math.round(x);
		layout.positions[2 * i + 1] = Math.round(y);
		this.scheduleSave();
	}

	async clear(): Promise<void> {
		this.data = { version: 1, layouts: {} };
		await this.save();
	}

	private async save(): Promise<void> {
		try {
			await this.adapter.write(this.path, JSON.stringify(this.data));
		} catch (e) {
			console.warn("Mercury Visualiser: could not save the layout cache", e);
		}
	}
}
