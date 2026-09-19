/**
 * Provider adapter contract shared by every photo → 3D engine.
 *
 * Adapters only talk to their provider: no pricing, ownership or storage logic
 * lives here, so the orchestrator stays the single place that knows about our
 * business rules.
 */
import type { Photo3DPlan, Photo3DProvider } from "./photo3d";

export type ProviderState = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type ProviderStatus = {
  state: ProviderState;
  /** 0–100 when the provider reports it, otherwise a stage-based estimate. */
  progress: number;
  message?: string;
  error?: string;
  /** True when another poll or retry is worth attempting. */
  retryable: boolean;
};

export type ProviderOutputs = {
  /** Canonical master asset. Downloaded into our private bucket immediately. */
  glbUrl: string;
  metadata: Record<string, unknown>;
};

export type CreateJobInput = {
  /** Short-lived signed URL of the customer's photo. Never logged. */
  imageUrl: string;
  /** Stable key used for deterministic seeding where a provider supports it. */
  seedKey: string;
};

/** Providers that run as one asynchronous remote task (Meshy, Tripo3D). */
export type PhotoTaskAdapter = {
  id: Photo3DProvider;
  kind: "task";
  plan: Photo3DPlan;
  label: string;
  available: () => boolean;
  createJob: (input: CreateJobInput) => Promise<{ providerJobId: string; metadata: Record<string, unknown> }>;
  getStatus: (providerJobId: string) => Promise<ProviderStatus>;
  fetchOutputs: (providerJobId: string) => Promise<ProviderOutputs>;
  cancel?: (providerJobId: string) => Promise<void>;
};
