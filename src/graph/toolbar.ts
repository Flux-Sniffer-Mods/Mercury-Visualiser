import { setIcon, setTooltip } from "obsidian";
import { icon, type IconKey } from "../icons";
import type { MercurySettings } from "../settings";

export type Feature = "autoColours" | "radialLayout" | "pieNodes" | "linkLabels" | "levelOfDetail";

export interface ToolbarHost {
	settings: MercurySettings;
	toggleFeature(feature: Feature): void;
	rerunLayout(): void;
}

const BUTTONS: Array<{ feature: Feature; icon: IconKey; label: string }> = [
	{ feature: "autoColours", icon: "palette", label: "Tag colours" },
	{ feature: "radialLayout", icon: "radial", label: "Spread-out links" },
	{ feature: "pieNodes", icon: "pie", label: "Pie-chart dots" },
	{ feature: "linkLabels", icon: "labels", label: "Line labels" },
	{ feature: "levelOfDetail", icon: "detail", label: "Smoother big graphs" },
];

/** The small on/off button strip shown in the corner of each graph view. */
export class GraphToolbar {
	readonly el: HTMLElement;
	private buttons = new Map<Feature, HTMLElement>();
	private rerunEl: HTMLElement;
	private progressEl: HTMLElement;

	constructor(parent: HTMLElement, private host: ToolbarHost, private radialApplies: () => boolean) {
		this.el = parent.createDiv({ cls: "mercury-toolbar" });
		for (const b of BUTTONS) {
			const el = this.el.createDiv({ cls: "mercury-toolbar-button clickable-icon" });
			el.setAttr("role", "button");
			el.setAttr("tabindex", "0");
			setIcon(el, icon(b.icon));
			setTooltip(el, b.label, { placement: "bottom" });
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				host.toggleFeature(b.feature);
			});
			el.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					host.toggleFeature(b.feature);
				}
			});
			this.buttons.set(b.feature, el);
		}
		this.rerunEl = this.el.createDiv({ cls: "mercury-toolbar-button clickable-icon" });
		setIcon(this.rerunEl, icon("rerun"));
		setTooltip(this.rerunEl, "Rearrange this graph again", { placement: "bottom" });
		this.rerunEl.addEventListener("click", (e) => {
			e.stopPropagation();
			host.rerunLayout();
		});
		this.progressEl = this.el.createDiv({ cls: "mercury-toolbar-progress" });
		this.update();
	}

	update(): void {
		const s = this.host.settings;
		this.el.toggleClass("is-hidden", !s.showGraphToolbar);
		for (const [feature, el] of this.buttons) {
			const on = s[feature];
			el.toggleClass("is-active", on);
			el.setAttr("aria-pressed", String(on));
		}
		const radialHere = this.radialApplies();
		this.buttons.get("radialLayout")?.toggleClass("is-off-here", s.radialLayout && !radialHere);
		this.rerunEl.toggleClass("is-hidden", !(s.radialLayout && radialHere));
	}

	setProgress(progress: number | null): void {
		this.progressEl.toggleClass("is-visible", progress !== null);
		this.progressEl.style.setProperty("--mercury-progress", String(progress ?? 0));
	}

	destroy(): void {
		this.el.remove();
	}
}
