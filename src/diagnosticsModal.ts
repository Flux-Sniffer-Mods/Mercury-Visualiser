import { Modal, Notice, Setting, type App } from "obsidian";

/** Shows how the Graph view draws its dots, with a button to copy it. */
export class DiagnosticsModal extends Modal {
	constructor(app: App, private report: string) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText("Graph diagnostics");
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "If pie-chart dots look the wrong size or in the wrong place, copy this and send it to whoever is helping you. It only describes how the graph is drawn, plus the names of up to three notes.",
		});
		contentEl.createEl("pre", { cls: "mercury-diagnostics", text: this.report });
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Copy")
					.setCta()
					.onClick(async () => {
						try {
							await navigator.clipboard.writeText(this.report);
							new Notice("Diagnostics copied");
						} catch {
							new Notice("Couldn't copy. Take a screenshot instead.");
						}
					}),
			)
			.addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
