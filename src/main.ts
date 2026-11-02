import { Notice, Plugin, TFile } from "obsidian";
import { ColourPoolModal } from "./colourPoolModal";
import { DiagnosticsModal } from "./diagnosticsModal";
import { GraphController, type ControllerHost } from "./graph/graphController";
import { GraphManager } from "./graph/graphManager";
import type { Feature } from "./graph/toolbar";
import { listingColour } from "./labels/labelColour";
import { LinkLabelIndex } from "./labels/linkLabelIndex";
import { LayoutCache } from "./layout/layoutCache";
import { LayoutRunner } from "./layout/layoutRunner";
import { mergeSettings, type MercurySettings } from "./settings";
import { MercurySettingTab } from "./settingsTab";
import { TagColourManager } from "./tags/tagColours";

const FEATURE_NAMES: Record<Feature, string> = {
	autoColours: "Tag colours",
	radialLayout: "Spread-out links",
	pieNodes: "Pie-chart dots",
	linkLabels: "Line labels",
	levelOfDetail: "Smoother big graphs",
};

export default class MercuryVisualiserPlugin extends Plugin {
	settings!: MercurySettings;
	tags!: TagColourManager;
	graphs!: GraphManager;
	private layout!: LayoutRunner;
	layoutCache!: LayoutCache;
	labelIndex!: LinkLabelIndex;
	/** Set once the vault has loaded and tag colours are ready; nothing touches graphs before then. */
	private ready = false;
	/** Bumped whenever tag colours may have changed. */
	private colourEpoch = 0;
	private listingColours = new Map<string, number | null>();
	private listingColoursFor = "";
	private settingTab!: MercurySettingTab;

	async onload(): Promise<void> {
		const saved = (await this.loadData()) as Partial<MercurySettings> | null;
		this.settings = mergeSettings(saved);
		// Settings from before colour pools existed: redo the automatic colours once in the Mercury palette.
		const upgradeToMercury = !!saved && !saved.colourPool && Object.keys(saved.palette ?? {}).length > 0;
		this.layout = new LayoutRunner();
		this.layoutCache = new LayoutCache(
			this.app.vault.adapter,
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
		);

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const plugin = this;
		this.tags = new TagColourManager({
			app: this.app,
			get settings() {
				return plugin.settings;
			},
			saveSettings: () => this.saveSettings(),
			onColoursChanged: () => {
				this.colourEpoch++;
				this.graphs?.invalidatePies();
			},
		});

		this.labelIndex = new LinkLabelIndex(this.app, () => this.graphs?.forEach((c) => c.requestRedraw()));

		const host: ControllerHost = {
			get settings() {
				return plugin.settings;
			},
			layout: this.layout,
			layoutCache: this.layoutCache,
			slicesFor: (path) => this.tags.slicesFor(path),
			colourForTag: (tag) => this.tags.colourForTag(tag),
			linkLabel: (a, b) => this.labelIndex.label(a, b, this.settings.linkLabelMode),
			labelsVersion: () => this.labelIndex.version,
			listingColour: (a, b) => this.listingColour(a, b),
			graphLinkDistance: (view) => GraphController.linkDistanceOf(view),
			toggleFeature: (feature) => void this.setFeature(feature, !this.settings[feature]),
			rerunLayout: (view) => this.graphs.rerunLayout(view),
		};
		this.graphs = new GraphManager(this.app, host);

		this.settingTab = new MercurySettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerCommands();

		this.app.workspace.onLayoutReady(async () => {
			await this.layoutCache.load();
			await this.tags.refresh({ reindex: true });
			if (upgradeToMercury && this.settings.autoColours) {
				await this.tags.respreadAll();
				new Notice("Mercury Visualiser: tag colours now come from the Mercury palette. Colours you chose yourself are kept.", 8000);
			}
			this.ready = true;
			this.graphs.scan();
			if (this.settings.linkLabels) void this.labelIndex.ensureBuilt();
		});

		const scan = () => {
			if (this.ready) this.graphs.scan();
		};
		this.registerEvent(this.app.workspace.on("layout-change", scan));
		this.registerEvent(this.app.workspace.on("active-leaf-change", scan));
		this.registerEvent(this.app.workspace.on("css-change", () => this.graphs.refreshTheme()));
		this.registerEvent(
			this.app.metadataCache.on("changed", (file, data, cache) => {
				this.tags.onFileChanged(file, cache);
				this.labelIndex.update(file, data);
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("deleted", (file) => {
				this.tags.onFileDeleted(file.path);
				this.labelIndex.remove(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				this.tags.onFileRenamed(oldPath, file.path);
				if (file.extension === "md") this.labelIndex.rename(oldPath, file);
			}),
		);

		let ticks = 0;
		this.registerInterval(
			window.setInterval(() => {
				if (!this.ready) return;
				this.graphs.scan();
				this.graphs.tick();
				if (++ticks % 5 === 0 && this.settings.autoColours && this.settings.syncGraphColourGroups) {
					this.tags.checkForGraphEdits();
				}
			}, 1000),
		);
	}

	onunload(): void {
		this.ready = false;
		this.graphs?.detachAll();
		this.layout?.destroy();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** The colour of the listing a line comes from: everyone in it, weighted to its main tags. */
	private listingColour(sourceId: string, targetId: string): number | null {
		const epoch = `${this.labelIndex.version}|${this.colourEpoch}|${this.settings.tagLevel}`;
		if (epoch !== this.listingColoursFor) {
			this.listingColours.clear();
			this.listingColoursFor = epoch;
		}
		const listing = this.labelIndex.listingOf(sourceId, targetId);
		if (!listing) return null;
		const known = this.listingColours.get(listing.key);
		if (known !== undefined) return known;
		const colour = listingColour(listing.members.map((id) => this.tags.slicesFor(id)));
		this.listingColours.set(listing.key, colour);
		return colour;
	}

	/** Shows how the open Graph view draws its dots, for troubleshooting. */
	showDiagnostics(): void {
		const controller = this.graphs.preferred();
		if (!controller) {
			new Notice("Open the Graph view first, then try again.");
			return;
		}
		let report: string;
		try {
			report = controller.diagnostics();
		} catch (e) {
			report = `Couldn't read the graph: ${String(e)}`;
		}
		new DiagnosticsModal(this.app, `Mercury Visualiser ${this.manifest.version}\n${report}`).open();
	}

	/** Opens the editor for the colours automatic tag colouring picks from. */
	openColourPool(afterSave?: () => void): void {
		new ColourPoolModal(this.app, {
			pool: this.settings.colourPool,
			currentColours: Object.values(this.settings.palette).map((r) => r.rgb),
			onSave: async (pool, recolour) => {
				this.settings.colourPool = pool;
				await this.saveSettings();
				if (recolour) await this.tags.respreadAll(recolour === "all");
				new Notice(recolour ? "Colour pool saved and tags recoloured" : "Colour pool saved", 2000);
				afterSave?.();
			},
		}).open();
	}

	/** Switches one of the three features on or off, from anywhere in the app. */
	async setFeature(feature: Feature, on: boolean): Promise<void> {
		if (this.settings[feature] === on) return;
		this.settings[feature] = on;
		await this.saveSettings();

		if (feature === "autoColours") {
			if (!on && this.settings.syncGraphColourGroups) await this.tags.removeCreatedGroups();
			await this.tags.refresh();
		}
		if (feature === "linkLabels" && on) void this.labelIndex.ensureBuilt();
		this.graphs.update();
		if (this.settingTab.containerEl.isShown()) this.settingTab.display();
		new Notice(`${FEATURE_NAMES[feature]}: ${on ? "on" : "off"}`, 1500);
	}

	private registerCommands(): void {
		const toggles: Array<{ id: string; feature: Feature }> = [
			{ id: "toggle-auto-tag-colours", feature: "autoColours" },
			{ id: "toggle-radial-layout", feature: "radialLayout" },
			{ id: "toggle-pie-chart-nodes", feature: "pieNodes" },
			{ id: "toggle-link-labels", feature: "linkLabels" },
			{ id: "toggle-level-of-detail", feature: "levelOfDetail" },
		];
		for (const t of toggles) {
			this.addCommand({
				id: t.id,
				name: `Toggle ${FEATURE_NAMES[t.feature].toLowerCase()}`,
				callback: () => this.setFeature(t.feature, !this.settings[t.feature]),
			});
		}

		this.addCommand({
			id: "rerun-radial-layout",
			name: "Rearrange the graph again",
			callback: () => {
				if (!this.settings.radialLayout) {
					new Notice("Spread-out links is off. Switch it on first.");
					return;
				}
				this.graphs.rerunLayout();
			},
		});

		this.addCommand({
			id: "show-graph-diagnostics",
			name: "Show graph diagnostics",
			callback: () => this.showDiagnostics(),
		});

		this.addCommand({
			id: "edit-colour-pool",
			name: "Edit the colours new tags can get",
			callback: () => this.openColourPool(),
		});

		this.addCommand({
			id: "respread-tag-colours",
			name: "Re-spread tag colours",
			callback: async () => {
				await this.tags.respreadAll();
				new Notice("Tag colours re-spread");
			},
		});

		this.addCommand({
			id: "colour-new-tags-now",
			name: "Colour new tags now",
			callback: async () => {
				await this.tags.refresh({ reindex: true });
				new Notice("Tag colours updated");
			},
		});
	}
}
