/// <reference lib="webworker" />
/**
 * Mesh worker: keeps the parsed model and does all slicing / mesh-check work
 * off the main thread, so the editor stays responsive while sliders move.
 */
import { glbTriangles, soupReport, type SoupReport } from "@/lib/glb-soup";
import {
  computeStats,
  createSlicer,
  prepareFromTriangles,
  summarize,
  type LayerSlicer,
  type ModelSummary,
  type PreparedModel,
  type SliceSettings,
  type SliceStats,
} from "@/lib/slice-core";

type Request =
  | { id: number; kind: "prepare"; url: string; heightMm: number }
  | { id: number; kind: "stats"; settings: SliceSettings }
  | { id: number; kind: "slicer"; settings: SliceSettings }
  | { id: number; kind: "layer"; index: number }
  | { id: number; kind: "report"; url: string }
  | { id: number; kind: "release" };

export type WorkerResponse =
  | { id: number; ok: true; kind: "prepare"; model: ModelSummary }
  | { id: number; ok: true; kind: "stats"; stats: SliceStats }
  | { id: number; ok: true; kind: "slicer"; layerCount: number; layerHeightMm: number; bounds: ModelSummary["bounds"] }
  | { id: number; ok: true; kind: "layer"; index: number; zMm: number; segments: Float32Array }
  | { id: number; ok: true; kind: "report"; report: SoupReport }
  | { id: number; ok: true; kind: "release" }
  | { id: number; ok: false; error: string };

let model: PreparedModel | null = null;
let slicer: LayerSlicer | null = null;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not fetch the model file");
  return new Uint8Array(await response.arrayBuffer());
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  const fail = (error: unknown) =>
    (self as unknown as Worker).postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "Mesh worker failed",
    } satisfies WorkerResponse);

  try {
    switch (request.kind) {
      case "prepare": {
        const tris = glbTriangles(await fetchBytes(request.url));
        model = prepareFromTriangles(tris, request.heightMm);
        slicer = null;
        (self as unknown as Worker).postMessage({
          id: request.id,
          ok: true,
          kind: "prepare",
          model: summarize(model),
        } satisfies WorkerResponse);
        return;
      }
      case "stats": {
        if (!model) throw new Error("No model prepared");
        (self as unknown as Worker).postMessage({
          id: request.id,
          ok: true,
          kind: "stats",
          stats: computeStats(model, request.settings),
        } satisfies WorkerResponse);
        return;
      }
      case "slicer": {
        if (!model) throw new Error("No model prepared");
        slicer = createSlicer(model, request.settings);
        (self as unknown as Worker).postMessage({
          id: request.id,
          ok: true,
          kind: "slicer",
          layerCount: slicer.layerCount,
          layerHeightMm: slicer.layerHeightMm,
          bounds: slicer.bounds,
        } satisfies WorkerResponse);
        return;
      }
      case "layer": {
        if (!slicer) throw new Error("No slicer built");
        const layer = slicer.layer(request.index);
        // Copy so the cached layer inside the worker survives the transfer.
        const segments = layer.segments.slice();
        (self as unknown as Worker).postMessage(
          {
            id: request.id,
            ok: true,
            kind: "layer",
            index: layer.index,
            zMm: layer.zMm,
            segments,
          } satisfies WorkerResponse,
          [segments.buffer],
        );
        return;
      }
      case "report": {
        const tris = glbTriangles(await fetchBytes(request.url));
        (self as unknown as Worker).postMessage({
          id: request.id,
          ok: true,
          kind: "report",
          report: soupReport(tris),
        } satisfies WorkerResponse);
        return;
      }
      case "release": {
        model = null;
        slicer = null;
        (self as unknown as Worker).postMessage({ id: request.id, ok: true, kind: "release" } satisfies WorkerResponse);
        return;
      }
      default:
        throw new Error("Unknown request");
    }
  } catch (error) {
    fail(error);
  }
};
