/**
 * Slicing preview API used by the studio.
 *
 * The maths lives in `slice-core.ts` and runs inside `workers/mesh.worker.ts`;
 * this module only re-exports the shared types and the worker-backed calls, so
 * nothing heavy ever runs on the main thread.
 */
export {
  DEFAULT_SLICE,
  layerHeightOf,
  type LayerSlicer,
  type ModelBounds,
  type ModelSummary,
  type PreparedModel,
  type SliceLayer,
  type SliceSettings,
  type SliceStats,
} from "./slice-core";

export { buildSlicer, computeStats, fetchLayer, prepareModel, releaseModel, reportModel } from "./mesh-worker";
