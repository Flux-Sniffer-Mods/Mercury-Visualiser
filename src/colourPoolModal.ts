import { Modal, Setting, type App } from "obsidian";
import {
	clonePool,
	DEFAULT_POOL,
	hexToRgbInt,
	hueSteps,
	oklchToRgbInt,
	rgbIntToHex,
	spreadColours,
	type ColourPool,
} from "./colour/colour";
import { MERCURY_COLOURS } from "./colour/mercury";

const PREVIEW_COUNT = 18;

export interface ColourPoolModalOptions {
	pool: ColourPool;
	/** Colours the tags have now, for "Use my current tag colours". */
	currentColours: number[];
	/** `recolour`: "unlocked" recolours automatic colours, "all" also the user's own. */
	onSave(pool: ColourPool, recolour: false | "unlocked" | "all"): void | Promise<void>;
}

/** Most vivid in-gamut colour at a lightness and hue, for drawing range previews. */
function swatchAt(L: number, C: number, hue: number): string {
	for (let c = C; c >= 0; c -= 0.01) {
		const rgb = oklchToRgbInt(L, c, hue);
		if (rgb !== null) return rgbIntToHex(rgb);
	}
	return "#808080";
}

/** A row of colour stops as a CSS gradient. */
function gradient(stops: string[]): string {
	return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * Lets the user choose which colours automatic tag colouring may pick from:
 * the whole spectrum within brightness / vividness / hue ranges, or their own
 * swatches. A live preview shows the colours new tags would get.
 */
export class ColourPoolModal extends Modal {
	private pool: ColourPool;
	private previewEl!: HTMLElement;
	private spectrumEl!: HTMLElement;
	private customEl!: HTMLElement;
	private mercuryEl!: HTMLElement;

	constructor(app: App, private options: ColourPoolModalOptions) {
		super(app);
		this.pool = clonePool(options.pool);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mercury-pool");
		this.titleEl.setText("Colours for new tags");

		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Each new tag gets the colour from this pool that is most different from the colours already in use.",
		});

		new Setting(contentEl).setName("Pick from").addDropdown((d) =>
			d
				.addOption("mercury", "Mercury (sampled from the planet)")
				.addOption("spectrum", "The whole spectrum")
				.addOption("custom", "My own colours")
				.setValue(this.pool.mode)
				.onChange((v) => {
					this.pool.mode = v as ColourPool["mode"];
					this.renderSections();
				}),
		);

		this.mercuryEl = contentEl.createDiv();
		this.customEl = contentEl.createDiv();
		this.spectrumEl = contentEl.createDiv();

		contentEl.createEl("h4", { text: "Preview", cls: "mercury-pool-heading" });
		this.previewEl = contentEl.createDiv({ cls: "mercury-pool-preview" });

		const buttons = new Setting(contentEl);
		buttons.addButton((b) => b.setButtonText("Reset").onClick(() => {
			const custom = this.pool.custom;
			this.pool = clonePool(DEFAULT_POOL);
			this.pool.custom = custom;
			this.renderSections();
		}));
		buttons.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		buttons.addButton((b) =>
			b
				.setButtonText("Save and recolour every tag")
				.setTooltip("Recolour all tags from this pool, including colours you chose yourself")
				.onClick(async () => {
					await this.options.onSave(clonePool(this.pool), "all");
					this.close();
				}),
		);
		buttons.addButton((b) =>
			b.setButtonText("Save").onClick(async () => {
				await this.options.onSave(clonePool(this.pool), false);
				this.close();
			}),
		);
		buttons.addButton((b) =>
			b
				.setButtonText("Save and recolour tags")
				.setCta()
				.setTooltip("Also give every tag whose colour you didn't choose yourself a new colour from this pool")
				.onClick(async () => {
					await this.options.onSave(clonePool(this.pool), "unlocked");
					this.close();
				}),
		);

		this.renderSections();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderSections(): void {
		this.renderMercury();
		this.renderCustom();
		this.renderSpectrum();
		this.renderPreview();
	}

	// ------------------------------------------------------------- spectrum

	private renderSpectrum(): void {
		const el = this.spectrumEl;
		el.empty();
		const p = this.pool;
		const fallback = p.mode !== "spectrum";
		el.createEl("h4", {
			text: p.mode === "custom" ? "When your colours run out" : p.mode === "mercury" ? "When the Mercury colours run out" : "Spectrum",
			cls: "mercury-pool-heading",
		});
		if (fallback) {
			el.createEl("p", {
				cls: "setting-item-description",
				text: "Once every one of those colours is in use, new tags get colours from these ranges instead.",
			});
		}

		const midL = (p.lightness[0] + p.lightness[1]) / 2;
		const midC = (p.vividness[0] + p.vividness[1]) / 2;
		const hues = hueSteps(p.hues[0], p.hues[1], 30);
		const midHue = hues[Math.floor(hues.length / 2)] ?? 0;

		const range = (
			name: string,
			desc: string,
			key: "lightness" | "vividness" | "hues",
			min: number,
			max: number,
			step: number,
			bar: () => string,
		) => {
			const bars: HTMLElement[] = [];
			const setBar = () => bars.forEach((b) => (b.style.background = bar()));
			for (const [i, label] of [
				[0, "from"],
				[1, "to"],
			] as const) {
				new Setting(el)
					.setName(`${name} ${label}`)
					.setDesc(i === 0 ? desc : "")
					.addSlider((sl) =>
						sl
							.setLimits(min, max, step)
							.setValue(p[key][i])
							.setDynamicTooltip()
							.onChange((v) => {
								p[key][i] = v;
								setBar();
								this.renderPreview();
							}),
					);
			}
			bars.push(el.createDiv({ cls: "mercury-pool-bar" }));
			setBar();
		};

		range("Brightness", "Darkest to lightest colour allowed.", "lightness", 0.3, 0.95, 0.01, () =>
			gradient(spacedStops(p.lightness[0], p.lightness[1]).map((L) => swatchAt(L, midC, midHue))),
		);
		range("Vividness", "From muted to vivid.", "vividness", 0.02, 0.32, 0.01, () =>
			gradient(spacedStops(p.vividness[0], p.vividness[1]).map((C) => swatchAt(midL, C, midHue))),
		);
		range(
			"Hue",
			"Which part of the colour wheel to use. A start after the end wraps round through red.",
			"hues",
			0,
			360,
			5,
			() => gradient(hueSteps(p.hues[0], p.hues[1], 15).map((h) => swatchAt(midL, midC, h))),
		);
	}

	// -------------------------------------------------------------- mercury

	private renderMercury(): void {
		const el = this.mercuryEl;
		el.empty();
		if (this.pool.mode !== "mercury") return;
		el.createEl("h4", { text: "Mercury palette", cls: "mercury-pool-heading" });
		el.createEl("p", {
			cls: "setting-item-description",
			text: `${MERCURY_COLOURS.length} colours sampled from an enhanced-colour image of the planet, most distinct first. New tags take whichever is most different from the colours already in use.`,
		});
		const grid = el.createDiv({ cls: "mercury-pool-dots" });
		for (const c of MERCURY_COLOURS) {
			const dot = grid.createDiv({ cls: "mercury-pool-dot is-small" });
			dot.style.background = rgbIntToHex(c);
			dot.setAttr("title", rgbIntToHex(c));
		}
		new Setting(el)
			.setDesc("Want to tweak them? Copy them into your own colours and edit from there.")
			.addButton((b) =>
				b.setButtonText("Copy to my own colours").onClick(() => {
					this.pool.custom = [...MERCURY_COLOURS];
					this.pool.mode = "custom";
					this.onOpen();
				}),
			);
	}

	// --------------------------------------------------------------- custom

	private renderCustom(): void {
		const el = this.customEl;
		el.empty();
		if (this.pool.mode !== "custom") return;
		const p = this.pool;
		el.createEl("h4", { text: "Your colours", cls: "mercury-pool-heading" });
		el.createEl("p", {
			cls: "setting-item-description",
			text: "Tap a swatch to change it, × to remove it. New tags use these first.",
		});

		const grid = el.createDiv({ cls: "mercury-pool-swatches" });
		p.custom.forEach((rgb, i) => {
			const cell = grid.createDiv({ cls: "mercury-pool-swatch" });
			const input = cell.createEl("input", { type: "color" });
			input.value = rgbIntToHex(rgb);
			input.addEventListener("input", () => {
				const v = hexToRgbInt(input.value);
				if (v !== null) {
					p.custom[i] = v;
					this.renderPreview();
				}
			});
			const remove = cell.createEl("button", { text: "×", cls: "mercury-pool-remove" });
			remove.setAttr("aria-label", "Remove colour");
			remove.addEventListener("click", () => {
				p.custom.splice(i, 1);
				this.renderSections();
			});
		});
		const add = grid.createEl("button", { text: "+", cls: "mercury-pool-add" });
		add.setAttr("aria-label", "Add a colour");
		add.addEventListener("click", () => {
			const spectrum = { ...clonePool(p), mode: "spectrum" as const };
			p.custom.push(spreadColours(1, p.custom, spectrum)[0]);
			this.renderSections();
		});

		let pasted = "";
		new Setting(el)
			.setName("Add several")
			.setDesc("Paste hex codes, e.g. #e63946, #457b9d, #2a9d8f")
			.addText((t) => {
				t.setPlaceholder("#e63946 #457b9d …").onChange((v) => (pasted = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") addPasted(t.getValue());
				});
			})
			.addButton((b) => b.setButtonText("Add").onClick(() => addPasted(pasted)));
		const addPasted = (text: string) => {
			const found = text.match(/#?[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? [];
			for (const hex of found) {
				const v = hexToRgbInt(hex);
				if (v !== null && !p.custom.includes(v)) p.custom.push(v);
			}
			this.renderSections();
		};

		new Setting(el)
			.addButton((b) =>
				b.setButtonText("Use my current tag colours").onClick(() => {
					for (const c of this.options.currentColours) if (!p.custom.includes(c)) p.custom.push(c);
					this.renderSections();
				}),
			)
			.addButton((b) =>
				b.setButtonText("Clear").onClick(() => {
					p.custom = [];
					this.renderSections();
				}),
			);
	}

	// -------------------------------------------------------------- preview

	private renderPreview(): void {
		const el = this.previewEl;
		el.empty();
		const colours = spreadColours(PREVIEW_COUNT, [], this.pool);
		el.createEl("p", {
			cls: "setting-item-description",
			text: `The first ${PREVIEW_COUNT} colours new tags would get, in order:`,
		});
		const row = el.createDiv({ cls: "mercury-pool-dots" });
		for (const c of colours) {
			const dot = row.createDiv({ cls: "mercury-pool-dot" });
			dot.style.background = rgbIntToHex(c);
			dot.setAttr("title", rgbIntToHex(c));
		}
		el.createEl("p", { cls: "setting-item-description", text: "As pie-chart dots:" });
		const pies = el.createDiv({ cls: "mercury-pool-pies" });
		for (let i = 0; i + 1 < Math.min(colours.length, 12); i += 2) {
			const n = i % 3 === 0 ? 3 : 2;
			const slice = colours.slice(i, i + n).map(rgbIntToHex);
			const stops = slice.map((c, j) => `${c} ${(j / slice.length) * 100}% ${((j + 1) / slice.length) * 100}%`);
			const pie = pies.createDiv({ cls: "mercury-pool-pie" });
			pie.style.background = `conic-gradient(${stops.join(", ")})`;
		}
	}
}

function spacedStops(a: number, b: number, n = 6): number[] {
	return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}
