import { Modal, Setting, type App } from "obsidian";

/** Asks before doing something that can't easily be undone. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmText: string,
		private onConfirm: () => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.title);
		contentEl.createEl("p", { text: this.message });
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.confirmText)
					.setWarning()
					.onClick(async () => {
						this.close();
						await this.onConfirm();
					}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
