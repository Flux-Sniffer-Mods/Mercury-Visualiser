/// <reference lib="webworker" />
import { createLayout, type Layout } from "./simulation";
import { PROGRESS_INTERVAL_MS, TICKS_PER_SLICE, type FromWorker, type ToWorker } from "./protocol";

/** Layout worker: runs the simulation off the main thread so the app stays responsive. */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let current = 0;

function post(msg: FromWorker) {
	ctx.postMessage(msg, msg.type === "error" ? [] : [msg.positions.buffer]);
}

function run(id: number, layout: Layout) {
	let lastSent = 0;
	const slice = () => {
		if (id !== current) return;
		try {
			const started = Date.now();
			let done = false;
			while (!done && Date.now() - started < 30) done = layout.step(TICKS_PER_SLICE);
			if (done) {
				post({ type: "done", id, positions: layout.positions() });
				return;
			}
			const now = Date.now();
			if (now - lastSent > PROGRESS_INTERVAL_MS) {
				lastSent = now;
				post({ type: "progress", id, positions: layout.positions(), progress: layout.progress() });
			}
			setTimeout(slice, 0);
		} catch (e) {
			post({ type: "error", id, message: String(e) });
		}
	};
	slice();
}

ctx.onmessage = (event: MessageEvent<ToWorker>) => {
	const msg = event.data;
	if (msg.type === "cancel") {
		if (msg.id === current) current = 0;
		return;
	}
	current = msg.id;
	try {
		run(msg.id, createLayout(msg.input));
	} catch (e) {
		post({ type: "error", id: msg.id, message: String(e) });
	}
};
