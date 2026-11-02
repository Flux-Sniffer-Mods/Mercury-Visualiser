import type { LayoutInput } from "./simulation";

export type ToWorker = { type: "start"; id: number; input: LayoutInput } | { type: "cancel"; id: number };

export type FromWorker =
	| { type: "progress"; id: number; positions: Float64Array; progress: number }
	| { type: "done"; id: number; positions: Float64Array }
	| { type: "error"; id: number; message: string };

/** Ticks per slice of work before checking for new messages. */
export const TICKS_PER_SLICE = 4;
/** Minimum time between progress updates sent back to the graph. */
export const PROGRESS_INTERVAL_MS = 90;
