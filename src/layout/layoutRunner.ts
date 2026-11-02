import workerSource from "inline-worker:./worker.ts";
import { createLayout, type LayoutInput } from "./simulation";
import { PROGRESS_INTERVAL_MS, TICKS_PER_SLICE, type FromWorker, type ToWorker } from "./protocol";

export interface LayoutCallbacks {
	onProgress(positions: Float64Array, progress: number): void;
	onDone(positions: Float64Array): void;
	onError?(message: string): void;
}

export interface LayoutHandle {
	cancel(): void;
}

/**
 * Runs layouts in a background worker, falling back to small time-sliced
 * chunks on the main thread where workers are unavailable.
 */
export class LayoutRunner {
	private worker: Worker | null = null;
	private workerFailed = false;
	private url: string | null = null;
	private nextId = 1;
	private jobs = new Map<number, LayoutCallbacks>();

	private ensureWorker(): Worker | null {
		if (this.worker || this.workerFailed) return this.worker;
		try {
			this.url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
			const worker = new Worker(this.url);
			worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
			worker.onerror = (e) => {
				console.warn("Mercury Visualiser: layout worker failed, using the main thread", e);
				this.workerFailed = true;
				this.disposeWorker();
			};
			this.worker = worker;
		} catch (e) {
			console.warn("Mercury Visualiser: workers unavailable, using the main thread", e);
			this.workerFailed = true;
		}
		return this.worker;
	}

	private onMessage(msg: FromWorker) {
		const job = this.jobs.get(msg.id);
		if (!job) return;
		if (msg.type === "progress") job.onProgress(msg.positions, msg.progress);
		else if (msg.type === "done") {
			this.jobs.delete(msg.id);
			job.onDone(msg.positions);
		} else {
			this.jobs.delete(msg.id);
			job.onError?.(msg.message);
		}
	}

	run(input: LayoutInput, callbacks: LayoutCallbacks): LayoutHandle {
		const id = this.nextId++;
		this.jobs.set(id, callbacks);
		const worker = this.ensureWorker();
		if (worker) {
			const msg: ToWorker = { type: "start", id, input };
			worker.postMessage(msg);
			return {
				cancel: () => {
					if (!this.jobs.delete(id)) return;
					const cancel: ToWorker = { type: "cancel", id };
					this.worker?.postMessage(cancel);
				},
			};
		}
		return this.runOnMainThread(id, input);
	}

	private runOnMainThread(id: number, input: LayoutInput): LayoutHandle {
		let cancelled = false;
		let layout: ReturnType<typeof createLayout>;
		try {
			layout = createLayout(input);
		} catch (e) {
			queueMicrotask(() => this.onMessage({ type: "error", id, message: String(e) }));
			return { cancel: () => this.jobs.delete(id) };
		}
		let lastSent = 0;
		const slice = () => {
			if (cancelled) return;
			const started = performance.now();
			let done = false;
			while (!done && performance.now() - started < 12) done = layout.step(TICKS_PER_SLICE);
			if (done) return this.onMessage({ type: "done", id, positions: layout.positions() });
			const now = performance.now();
			if (now - lastSent > PROGRESS_INTERVAL_MS) {
				lastSent = now;
				this.onMessage({ type: "progress", id, positions: layout.positions(), progress: layout.progress() });
			}
			window.setTimeout(slice, 0);
		};
		window.setTimeout(slice, 0);
		return {
			cancel: () => {
				cancelled = true;
				this.jobs.delete(id);
			},
		};
	}

	private disposeWorker() {
		this.worker?.terminate();
		this.worker = null;
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
	}

	destroy() {
		this.jobs.clear();
		this.disposeWorker();
	}
}
