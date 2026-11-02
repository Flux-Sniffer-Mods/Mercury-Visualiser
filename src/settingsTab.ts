import { debounce, Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { hexToRgbInt, rgbIntToHex, spreadColours } from "./colour/colour";
import { icon } from "./icons";
import type MercuryVisualiserPlugin from "./main";
import type { RadialStyle } from "./settings";
import type { TagLevel } from "./tags/tagKey";

export class MercurySettingTab extends PluginSettingTab {
	private filter = "";

	constructor(app: App, private plugin: MercuryVisualiserPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const plugin = this.plugin;
		const s = plugin.settings;
		const scroll = containerEl.scrollTop;
		containerEl.empty();
		containerEl.addClass("mercury-settings");

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Each feature can also be switched on and off from the buttons in the corner of any graph view, or from the command palette.",
		});

		// ------------------------------------------------------------ colours
		new Setting(containerEl).setName("Tag colours").setHeading();

		new Setting(containerEl)
			.setName("Colour tags automatically")
			.setDesc("Every tag gets its own colour, and each new tag is given the colour most different from the ones already in use.")
			.addToggle((t) => t.setValue(s.autoColours).onChange((v) => plugin.setFeature("autoColours", v)));

		new Setting(containerEl)
			.setName("Colour by")
			.setDesc("Top-level gives #Music/Singer and #Music/Rapper the same colour as #Music. Full tag gives each nested tag its own.")
			.addDropdown((d) =>
				d
					.addOption("top", "Top-level tag")
					.addOption("full", "Full nested tag")
					.setValue(s.tagLevel)
					.onChange(async (v) => {
						s.tagLevel = v as TagLevel;
						await plugin.tags.refresh({ reindex: true });
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Minimum notes per tag")
			.setDesc("Tags used on fewer notes than this don't get a colour.")
			.addSlider((sl) =>
				sl
					.setLimits(1, 25, 1)
					.setValue(s.minNotesPerTag)
					.setDynamicTooltip()
					.onChange(
						debounce(
							async (v: number) => {
								s.minNotesPerTag = v;
								await plugin.tags.refresh();
								this.display();
							},
							400,
							true,
						),
					),
			);

		new Setting(containerEl)
			.setName("Tags to skip")
			.setDesc("Comma-separated. Nested tags of a skipped tag are skipped too.")
			.addText((t) =>
				t
					.setPlaceholder("e.g. Bald, IRL-Friend")
					.setValue(s.ignoredTags)
					.onChange(
						debounce(
							async (v: string) => {
								s.ignoredTags = v;
								await plugin.tags.refresh();
							},
							700,
							true,
						),
					),
			);

		new Setting(containerEl)
			.setName("Update the Graph view's colour groups")
			.setDesc("Adds a colour group for each tag so the Graph view (and local graphs) use the same colours. Groups you made yourself are kept, and their colours are used.")
			.addToggle((t) =>
				t.setValue(s.syncGraphColourGroups).onChange(async (v) => {
					s.syncGraphColourGroups = v;
					if (!v) await plugin.tags.removeCreatedGroups();
					await plugin.tags.refresh();
				}),
			);

		new Setting(containerEl)
			.setName("Tidy up unused groups")
			.setDesc("Remove colour groups this plugin added once their tag is no longer used.")
			.addToggle((t) =>
				t.setValue(s.removeStaleGroups).onChange(async (v) => {
					s.removeStaleGroups = v;
					await plugin.tags.refresh();
				}),
			);

		const poolSetting = new Setting(containerEl)
			.setName("Colours to choose from")
			.setDesc(
				s.colourPool.mode === "custom"
					? `Your own ${s.colourPool.custom.length} colour${s.colourPool.custom.length === 1 ? "" : "s"}, then the spectrum.`
					: s.colourPool.mode === "mercury"
						? "The Mercury palette: colours sampled from an enhanced-colour image of the planet."
						: "The whole spectrum, within the brightness, vividness and hue ranges you pick.",
			)
			.addButton((b) => b.setButtonText("Edit…").onClick(() => plugin.openColourPool(() => this.display())));
		const strip = poolSetting.controlEl.createDiv({ cls: "mercury-pool-strip" });
		poolSetting.controlEl.prepend(strip);
		for (const c of spreadColours(10, [], s.colourPool)) strip.createDiv({ cls: "mercury-pool-strip-dot" }).style.background = rgbIntToHex(c);

		new Setting(containerEl)
			.setName("Re-spread colours")
			.setDesc("Recolour every unlocked tag so the whole set is as easy to tell apart as possible. Colours you set in the Graph view are locked and stay put.")
			.addButton((b) =>
				b.setButtonText("Re-spread").onClick(async () => {
					await plugin.tags.respreadAll();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Recolour every tag")
			.setDesc("Like re-spread, but also replaces the colours you chose yourself (including your Graph view colour groups), so every tag uses the current colour pool.")
			.addButton((b) =>
				b.setButtonText("Recolour all").setWarning().onClick(async () => {
					await plugin.tags.respreadAll(true);
					new Notice("Every tag recoloured from the colour pool");
					this.display();
				}),
			);

		this.renderPalette(containerEl);

		// ------------------------------------------------------------- radial
		new Setting(containerEl).setName("Spread-out links").setHeading();

		new Setting(containerEl)
			.setName("Spread out links")
			.setDesc("Each note's links fan out evenly all the way around it, like the spokes of a wheel, instead of bunching up on one side.")
			.addToggle((t) => t.setValue(s.radialLayout).onChange((v) => plugin.setFeature("radialLayout", v)));

		new Setting(containerEl)
			.setName("Style")
			.setDesc("Spokes: every note's links splay out evenly. Rings: the centre note in the middle with each step away on its own ring, every branch in its own slice.")
			.addDropdown((d) =>
				d
					.addOption("spokes", "Spokes")
					.addOption("rings", "Rings")
					.setValue(s.radialStyle)
					.onChange(async (v) => {
						s.radialStyle = v as RadialStyle;
						await plugin.saveSettings();
						plugin.graphs.rerunLayout();
					}),
			);

		new Setting(containerEl).setName("Use in the main graph").addToggle((t) =>
			t.setValue(s.radialGlobalGraph).onChange(async (v) => {
				s.radialGlobalGraph = v;
				await plugin.saveSettings();
				plugin.graphs.update();
			}),
		);

		new Setting(containerEl).setName("Use in local graphs").addToggle((t) =>
			t.setValue(s.radialLocalGraph).onChange(async (v) => {
				s.radialLocalGraph = v;
				await plugin.saveSettings();
				plugin.graphs.update();
			}),
		);

		const rerun = debounce(() => plugin.graphs.rerunLayout(), 600, true);

		new Setting(containerEl)
			.setName("Match the graph's link distance")
			.setDesc("Use the link distance from the Graph view's Forces panel as the spoke length.")
			.addToggle((t) =>
				t.setValue(s.matchGraphLinkDistance).onChange(async (v) => {
					s.matchGraphLinkDistance = v;
					await plugin.saveSettings();
					rerun();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Spoke length")
			.setDesc("How far linked notes sit from each other.")
			.setDisabled(s.matchGraphLinkDistance)
			.addSlider((sl) =>
				sl
					.setLimits(40, 1000, 10)
					.setValue(s.spokeLength)
					.setDisabled(s.matchGraphLinkDistance)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.spokeLength = v;
						await plugin.saveSettings();
						rerun();
					}),
			);

		new Setting(containerEl)
			.setName("Splay strength")
			.setDesc("How firmly links are pushed into even, pie-slice directions.")
			.addSlider((sl) =>
				sl
					.setLimits(0, 1, 0.05)
					.setValue(s.splayStrength)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.splayStrength = v;
						await plugin.saveSettings();
						rerun();
					}),
			);

		new Setting(containerEl)
			.setName("Spacing")
			.setDesc("How strongly unrelated notes push each other apart.")
			.addSlider((sl) =>
				sl
					.setLimits(0.2, 3, 0.1)
					.setValue(s.repelMultiplier)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.repelMultiplier = v;
						await plugin.saveSettings();
						rerun();
					}),
			);

		new Setting(containerEl)
			.setName("Animate")
			.setDesc("Show notes gliding into place. Turn off on slow devices or very large vaults.")
			.addToggle((t) =>
				t.setValue(s.animateLayout).onChange(async (v) => {
					s.animateLayout = v;
					await plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Rearrange the graph again").addButton((b) =>
			b.setButtonText("Rearrange").onClick(() => plugin.graphs.rerunLayout()),
		);

		// --------------------------------------------------------------- pies
		new Setting(containerEl).setName("Pie-chart dots").setHeading();

		new Setting(containerEl)
			.setName("Show tag colours on dots")
			.setDesc("Show every tag colour a note has, not just one.")
			.addToggle((t) => t.setValue(s.pieNodes).onChange((v) => plugin.setFeature("pieNodes", v)));

		new Setting(containerEl)
			.setName("Style")
			.setDesc("Ring: a thin ring of colours around the normal dot. Filled: the whole dot becomes a pie chart.")
			.addDropdown((d) =>
				d
					.addOption("ring", "Ring around the dot")
					.addOption("filled", "Filled pie")
					.setValue(s.pieStyle)
					.onChange(async (v) => {
						s.pieStyle = v === "filled" ? "filled" : "ring";
						await plugin.saveSettings();
						plugin.graphs.invalidatePies();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Only show when zoomed in")
			.setDesc("Colours fade in as you zoom in, at the same point as note names, and stay plain when zoomed out. The note you point at, and its neighbours, always show theirs.")
			.addToggle((t) =>
				t.setValue(s.pieFade).onChange(async (v) => {
					s.pieFade = v;
					await plugin.saveSettings();
					plugin.graphs.forEach((c) => c.requestRedraw());
				}),
			);

		new Setting(containerEl).setName("Show on").addDropdown((d) =>
			d
				.addOption("2", "Notes with two or more tag colours")
				.addOption("1", "Every note with a tag colour")
				.setValue(String(s.pieMinColours))
				.onChange(async (v) => {
					s.pieMinColours = v === "1" ? 1 : 2;
					await plugin.saveSettings();
					plugin.graphs.invalidatePies();
				}),
		);

		new Setting(containerEl)
			.setName("Size slices by tag count")
			.setDesc("Off: every colour gets an equal slice. On: a colour that stands for more of the note's tags gets a bigger slice.")
			.addToggle((t) =>
				t.setValue(s.pieWeighted).onChange(async (v) => {
					s.pieWeighted = v;
					await plugin.saveSettings();
					plugin.graphs.invalidatePies();
				}),
			);

		new Setting(containerEl)
			.setName("Lines between slices")
			.setDesc("Filled style only. The ring style always has small gaps between colours.")
			.setDisabled(s.pieStyle !== "filled")
			.addToggle((t) =>
				t.setValue(s.pieOutline).onChange(async (v) => {
					s.pieOutline = v;
					await plugin.saveSettings();
					plugin.graphs.invalidatePies();
				}),
			);

		new Setting(containerEl)
			.setName("Colour tag nodes")
			.setDesc("When the Graph view shows tags as nodes, fill each one with its tag's colour.")
			.addToggle((t) =>
				t.setValue(s.pieTagNodes).onChange(async (v) => {
					s.pieTagNodes = v;
					await plugin.saveSettings();
					plugin.graphs.invalidatePies();
				}),
			);

		// --------------------------------------------------------- link labels
		new Setting(containerEl).setName("Line labels").setHeading();

		new Setting(containerEl)
			.setName("Label the lines")
			.setDesc("Write the listing a link comes from along its line, e.g. the video in \"asdfmovie4: [[…]]\". Labels fade with zoom using the Graph view's own text fade setting.")
			.addToggle((t) => t.setValue(s.linkLabels).onChange((v) => plugin.setFeature("linkLabels", v)));

		new Setting(containerEl)
			.setName("Label with")
			.setDesc("For a link in \"asdf:\" › \"- asdfmovie4: [[…]]\".")
			.addDropdown((d) =>
				d
					.addOption("own", "Its own line (asdfmovie4)")
					.addOption("listing", "The listing (asdf)")
					.addOption("path", "Both (asdf › asdfmovie4)")
					.setValue(s.linkLabelMode)
					.onChange(async (v) => {
						s.linkLabelMode = v as typeof s.linkLabelMode;
						await plugin.saveSettings();
						plugin.labelIndex.bump();
					}),
			);

		new Setting(containerEl)
			.setName("Colour the labels")
			.setDesc("Tint each label with a blend of the tag colours of the two notes its line joins. Labels between notes without tag colours stay plain.")
			.addToggle((t) =>
				t.setValue(s.linkLabelColours).onChange(async (v) => {
					s.linkLabelColours = v;
					await plugin.saveSettings();
					plugin.graphs.forEach((c) => c.requestRedraw());
				}),
			);

		new Setting(containerEl)
			.setName("Most labels at once")
			.setDesc("Only lines on screen are labelled, nearest the middle first. Fewer is tidier and faster.")
			.addSlider((sl) =>
				sl
					.setLimits(10, 400, 10)
					.setValue(s.linkLabelMax)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.linkLabelMax = v;
						await plugin.saveSettings();
						plugin.graphs.forEach((c) => c.requestRedraw());
					}),
			);

		// ------------------------------------------------------ level of detail
		new Setting(containerEl).setName("Smoother big graphs").setHeading();

		new Setting(containerEl)
			.setName("Draw less when it can't be seen")
			.setDesc("Like level of detail in video games: keeps big graphs smooth.")
			.addToggle((t) => t.setValue(s.levelOfDetail).onChange((v) => plugin.setFeature("levelOfDetail", v)));

		const redraw = async () => {
			await plugin.saveSettings();
			plugin.graphs.forEach((c) => c.requestRedraw());
		};

		new Setting(containerEl)
			.setName("Skip what's off screen")
			.setDesc("When zoomed in, notes and lines outside the view aren't drawn.")
			.addToggle((t) =>
				t.setValue(s.lodCulling).onChange(async (v) => {
					s.lodCulling = v;
					await redraw();
				}),
			);

		new Setting(containerEl)
			.setName("Fewer shapes when zoomed out")
			.setDesc("As you zoom out, the least important lines and dots are dropped bit by bit: lines to notes with one link go first, busy notes stay. The note you point at always shows in full.")
			.addToggle((t) =>
				t.setValue(s.lodThinOut).onChange(async (v) => {
					s.lodThinOut = v;
					await redraw();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("How much to drop")
			.setDesc("The share of dots dropped by the time the density map takes over. Lines go a little sooner.")
			.setDisabled(!s.lodThinOut)
			.addSlider((sl) =>
				sl
					.setLimits(0.1, 0.9, 0.05)
					.setValue(s.lodThinAmount)
					.setDisabled(!s.lodThinOut)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.lodThinAmount = v;
						await redraw();
					}),
			);

		new Setting(containerEl)
			.setName("Density map when zoomed out")
			.setDesc("Far out, the dots and lines fade into a soft map: each area tinted by its notes' tag colours, lighter where notes are packed tighter.")
			.addToggle((t) =>
				t.setValue(s.lodDensityMap).onChange(async (v) => {
					s.lodDensityMap = v;
					await redraw();
				}),
			);

		new Setting(containerEl)
			.setName("Switch to the map below")
			.setDesc("Node size on screen, in pixels, at which the map has fully taken over. It starts fading in at about twice this.")
			.addSlider((sl) =>
				sl
					.setLimits(0.5, 6, 0.1)
					.setValue(s.lodMapBelowPx)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.lodMapBelowPx = v;
						await redraw();
					}),
			);

		new Setting(containerEl)
			.setName("Map softness")
			.setDesc("How much the map is blurred: 0 is crisp, 3 is very soft.")
			.addSlider((sl) =>
				sl
					.setLimits(0, 3, 1)
					.setValue(s.lodMapSoftness)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.lodMapSoftness = v;
						await redraw();
					}),
			);

		new Setting(containerEl).setName("Map colours").addDropdown((d) =>
			d
				.addOption("tags", "Tag colours, lighter where denser")
				.addOption("brightness", "One colour, lighter where denser")
				.setValue(s.lodDensityStyle)
				.onChange(async (v) => {
					s.lodDensityStyle = v as typeof s.lodDensityStyle;
					await redraw();
				}),
		);

		// ------------------------------------------------------------ general
		new Setting(containerEl).setName("Buttons").setHeading();

		new Setting(containerEl)
			.setName("Show buttons on graph views")
			.setDesc("Buttons in the top-left corner of each graph to switch the features on and off.")
			.addToggle((t) =>
				t.setValue(s.showGraphToolbar).onChange(async (v) => {
					s.showGraphToolbar = v;
					await plugin.saveSettings();
					plugin.graphs.update();
				}),
			);

		// ------------------------------------------------------ troubleshooting
		new Setting(containerEl).setName("Troubleshooting").setHeading();

		new Setting(containerEl)
			.setName("Graph diagnostics")
			.setDesc("If tag colours on dots look the wrong size or in the wrong place, open the Graph view, then press this and send what it shows to whoever is helping you.")
			.addButton((b) => b.setButtonText("Show").onClick(() => plugin.showDiagnostics()));

		containerEl.scrollTop = scroll;
	}

	private renderPalette(containerEl: HTMLElement): void {
		const plugin = this.plugin;
		const s = plugin.settings;
		const stats = plugin.tags.eligible();
		const wrap = containerEl.createDiv({ cls: "mercury-palette" });

		const header = new Setting(wrap)
			.setName("Tag colours")
			.setDesc(
				s.autoColours
					? `${stats.length} coloured tag${stats.length === 1 ? "" : "s"}. Pick a colour to change it, the lock keeps it during a re-spread, the dice picks a fresh distinct colour.`
					: "Switch on tag colours to manage colours here.",
			);
		if (!s.autoColours) return;
		header.addSearch((search) =>
			search
				.setPlaceholder("Filter tags")
				.setValue(this.filter)
				.onChange((v) => {
					this.filter = v.toLowerCase();
					renderRows();
				}),
		);

		const list = wrap.createDiv({ cls: "mercury-palette-list" });
		const renderRows = () => {
			list.empty();
			for (const stat of stats) {
				if (this.filter && !stat.id.includes(this.filter)) continue;
				const rec = s.palette[stat.id];
				if (!rec) continue;
				const row = new Setting(list)
					.setName(`#${rec.name}`)
					.setDesc(`${stat.count} note${stat.count === 1 ? "" : "s"}`);
				row.settingEl.addClass("mercury-palette-row");
				row.addColorPicker((cp) =>
					cp.setValue(rgbIntToHex(rec.rgb)).onChange(
						debounce(
							async (hex: string) => {
								const rgb = hexToRgbInt(hex);
								if (rgb === null) return;
								rec.locked = true;
								await plugin.tags.setColour(stat.id, rgb);
								renderRows();
							},
							300,
							true,
						),
					),
				);
				row.addExtraButton((b) =>
					b
						.setIcon(icon(rec.locked ? "lock" : "unlock"))
						.setTooltip(rec.locked ? "Locked: kept during a re-spread" : "Unlocked")
						.onClick(async () => {
							await plugin.tags.setLocked(stat.id, !rec.locked);
							renderRows();
						}),
				);
				row.addExtraButton((b) =>
					b
						.setIcon(icon("reroll"))
						.setTooltip("Pick another distinct colour")
						.onClick(async () => {
							await plugin.tags.rerollColour(stat.id);
							renderRows();
						}),
				);
			}
		};
		renderRows();
	}
}
