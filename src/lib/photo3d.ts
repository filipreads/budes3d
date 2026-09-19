/**
 * Provider-neutral vocabulary for photo → 3D generation.
 *
 * This module is client-safe: the studio UI, the job pipeline and the server
 * adapters all speak these types, so nothing outside `*.server.ts` has to know
 * which engine produced a model.
 */

/** Engines the studio can run a portrait through. */
export type Photo3DProvider = "trellis2" | "meshy" | "tripo3d";

/** Commercial tier of a provider. Premium carries a product surcharge. */
export type Photo3DPlan = "basic" | "premium";

/**
 * Engine identifiers as persisted on `projects.generation_engine`. They predate
 * the provider abstraction, so the two vocabularies are mapped explicitly.
 */
export type EngineId = "trellis" | "meshy" | "tripo";

export const ENGINE_TO_PROVIDER: Record<EngineId, Photo3DProvider> = {
  trellis: "trellis2",
  meshy: "meshy",
  tripo: "tripo3d",
};

export const PROVIDER_TO_ENGINE: Record<Photo3DProvider, EngineId> = {
  trellis2: "trellis",
  meshy: "meshy",
  tripo3d: "tripo",
};

export function isEngineId(value: unknown): value is EngineId {
  return value === "trellis" || value === "meshy" || value === "tripo";
}

/** Engine as advertised to the studio. */
export type EngineInfo = {
  id: EngineId;
  provider: Photo3DProvider;
  label: string;
  plan: Photo3DPlan;
  /** False when the provider exists in code but has no API key configured. */
  configured: boolean;
  /** Product surcharge in minor units for the active currency (0 for basic). */
  surchargeCents: number;
};

/**
 * Stages shown to the customer. They are deliberately provider-neutral: a
 * TRELLIS sculpt and a Meshy task both map onto the same four steps.
 */
export const NEUTRAL_STAGES = ["preparing", "generating", "finalizing", "printcheck"] as const;
export type NeutralStage = (typeof NEUTRAL_STAGES)[number];

/** Raw pipeline stage persisted on the project / job row. */
export type JobStage = "queued" | "preprocessing" | "sculpting" | "extracting" | "storing" | "ready" | "failed";

export function neutralStage(stage: JobStage): NeutralStage | "ready" | "failed" {
  switch (stage) {
    case "queued":
    case "preprocessing":
      return "preparing";
    case "sculpting":
      return "generating";
    case "extracting":
      return "finalizing";
    case "storing":
      return "printcheck";
    default:
      return stage;
  }
}

/** Printability verdict produced by our own server-side mesh check. */
export type PrintabilityReport = {
  triangles: number;
  openEdges: number;
  watertight: boolean;
  /** Bounding box in the model's own units. */
  size: { x: number; y: number; z: number };
  printable: boolean;
  issues: string[];
};
