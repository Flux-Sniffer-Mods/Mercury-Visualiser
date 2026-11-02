import type { App, View } from "obsidian";
import { GraphController, type ControllerHost } from "./graphController";
import { graphKind, graphLeaves, isUsableRenderer, type CoreGraphView } from "./internals";

/** Finds every open graph view and keeps one controller attached to each. */
export class GraphManager {
	private controllers = new Map<View, GraphController>();

	constructor(private app: App, private host: ControllerHost) {}

	/** Attaches to new graph views and drops controllers for closed or rebuilt ones. */
	scan(): void {
		const seen = new Set<View>();
		for (const leaf of graphLeaves(this.app)) {
			const view = leaf.view as CoreGraphView;
			const kind = graphKind(view);
			if (!kind || !isUsableRenderer(view.renderer)) continue;
			seen.add(view);
			const existing = this.controllers.get(view);
			if (existing && existing.renderer === view.renderer) continue;
			existing?.detach();
			try {
				const controller = new GraphController(view, kind, this.host);
				controller.attach();
				this.controllers.set(view, controller);
			} catch (e) {
				console.warn("Mercury Visualiser: could not attach to a graph view", e);
				this.controllers.delete(view);
			}
		}
		for (const [view, controller] of this.controllers) {
			if (!seen.has(view)) {
				controller.detach();
				this.controllers.delete(view);
			}
		}
	}

	forEach(fn: (controller: GraphController) => void): void {
		for (const c of this.controllers.values()) fn(c);
	}

	/** The main graph's controller if open, otherwise any graph's. */
	preferred(): GraphController | undefined {
		let any: GraphController | undefined;
		for (const c of this.controllers.values()) {
			if (c.kind === "graph") return c;
			any ??= c;
		}
		return any;
	}

	get(view: View): GraphController | undefined {
		return this.controllers.get(view);
	}

	/** Re-applies settings to every graph. */
	update(): void {
		this.forEach((c) => c.update());
	}

	invalidatePies(): void {
		this.forEach((c) => c.invalidatePies());
	}

	refreshTheme(): void {
		this.forEach((c) => c.refreshTheme());
	}

	tick(): void {
		this.forEach((c) => c.tick());
	}

	rerunLayout(view?: View): void {
		this.forEach((c) => {
			if (!view || c.view === view) c.runLayout(true, true);
		});
	}

	detachAll(): void {
		this.forEach((c) => c.detach());
		this.controllers.clear();
	}
}
