/**
 * Main-thread client for the mesh worker.
 *
 * One worker instance per page is enough: it holds the prepared model, so
 * moving a slider only costs a message round-trip instead of re-parsing the
 * GLB. Every call is cancellable — a superseded request simply resolves into a
 * discarded promise while the UI keeps showing the last good result.
 */
import type { SoupReport } from "./glb-soup";
import type { ModelBounds, ModelSummary, SliceSettings, SliceStats } from "./slice-core";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/mesh.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data);
    else entry.reject(new Error(event.data.error ?? "Mesh worker failed"));
  };
  worker.onerror = () => {
    for (const entry of pending.values()) entry.reject(new Error("Mesh worker crashed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function call<T>(payload: Record<string, unknown>): Promise<T> {
  const instance = ensureWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    instance.postMessage({ ...payload, id });
  });
}

/** Parses the model once; later calls reuse it inside the worker. */
export function prepareModel(url: string, heightMm: number): Promise<ModelSummary> {
  return call<{ model: ModelSummary }>({ kind: "prepare", url, heightMm }).then((r) => r.model);
}

export function computeStats(settings: SliceSettings): Promise<SliceStats> {
  return call<{ stats: SliceStats }>({ kind: "stats", settings }).then((r) => r.stats);
}

export function buildSlicer(
  settings: SliceSettings,
): Promise<{ layerCount: number; layerHeightMm: number; bounds: ModelBounds }> {
  return call({ kind: "slicer", settings });
}

export function fetchLayer(index: number): Promise<{ index: number; zMm: number; segments: Float32Array }> {
  return call({ kind: "layer", index });
}

/** Watertightness / triangle count of a stored GLB, computed off the main thread. */
export function reportModel(url: string): Promise<SoupReport> {
  return call<{ report: SoupReport }>({ kind: "report", url }).then((r) => r.report);
}

/** Drops the parsed model so a long editing session does not hold it in memory. */
export function releaseModel(): Promise<void> {
  if (!worker) return Promise.resolve();
  return call<unknown>({ kind: "release" }).then(() => undefined);
}
