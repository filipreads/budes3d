/**
 * Meshy image-to-3D provider (server-only) — the premium engine.
 *
 * Documented flow (https://docs.meshy.ai/en/api/image-to-3d):
 *   POST /openapi/v1/image-to-3d      -> { result: "<task id>" }
 *   GET  /openapi/v1/image-to-3d/:id  -> { status, progress, model_urls, task_error }
 *
 * Notes that shape this adapter:
 *  - `MESHY_API_KEY` is read inside functions only and never leaves the server.
 *  - Non-Enterprise API outputs are retained by Meshy for 3 days, so the caller
 *    downloads the GLB into our own private bucket as soon as a task succeeds.
 *  - A POST is only retried on 429 (the request was rejected, so no task was
 *    created). A 5xx on POST is ambiguous and is never retried, because a
 *    duplicate task would consume real credits twice.
 */

import type { PhotoTaskAdapter, ProviderOutputs, ProviderStatus } from "./photo3d-types";

const DEFAULT_BASE = "https://api.meshy.ai";

export class MeshyConfigError extends Error {}
export class MeshyTransientError extends Error {}
export class MeshyCreditError extends Error {}
export class MeshyAuthError extends Error {}

export function meshyBase(): string {
  return (process.env["MESHY_API_BASE"] || DEFAULT_BASE).replace(/\/+$/, "");
}

export function meshyAvailable(): boolean {
  return Boolean(process.env["MESHY_API_KEY"]);
}

function apiKey(): string {
  const key = process.env["MESHY_API_KEY"];
  if (!key) throw new MeshyConfigError("Premium engine is not configured");
  return key;
}

/** Server-side generation profile; tunable through `app_settings.meshy_profile`. */
export type MeshyProfile = {
  ai_model: string;
  model_type: "standard" | "smart-topology";
  should_texture: boolean;
  enable_pbr: boolean;
  texture_resolution: "2k" | "4k" | "8k";
  geometry_resolution: "standard" | "2k" | "4k";
  should_remesh: boolean;
  target_polycount: number;
  save_pre_remeshed_model: boolean;
  multi_view_thumbnails: boolean;
  moderation: boolean;
  /** Only GLB is requested: it is our canonical master and keeps latency down. */
  target_formats: string[];
  /** A single photo cannot infer real-world size reliably, so this stays off. */
  auto_size: boolean;
};

export const DEFAULT_MESHY_PROFILE: MeshyProfile = {
  ai_model: "meshy-7.1",
  model_type: "standard",
  should_texture: true,
  enable_pbr: true,
  texture_resolution: "4k",
  geometry_resolution: "2k",
  should_remesh: true,
  target_polycount: 150000,
  save_pre_remeshed_model: true,
  multi_view_thumbnails: false,
  moderation: true,
  target_formats: ["glb"],
  auto_size: false,
};

const ALLOWED_TEXTURE = new Set(["2k", "4k", "8k"]);
const ALLOWED_GEOMETRY = new Set(["standard", "2k", "4k"]);

/** Merges stored overrides onto the defaults, dropping anything invalid. */
export function mergeProfile(overrides: unknown): MeshyProfile {
  const source = (overrides ?? {}) as Record<string, unknown>;
  const profile: MeshyProfile = { ...DEFAULT_MESHY_PROFILE };
  if (typeof source["ai_model"] === "string" && source["ai_model"]) profile.ai_model = source["ai_model"];
  if (source["model_type"] === "standard" || source["model_type"] === "smart-topology") {
    profile.model_type = source["model_type"];
  }
  for (const flag of [
    "should_texture",
    "enable_pbr",
    "should_remesh",
    "save_pre_remeshed_model",
    "multi_view_thumbnails",
    "moderation",
    "auto_size",
  ] as const) {
    if (typeof source[flag] === "boolean") profile[flag] = source[flag] as boolean;
  }
  if (typeof source["texture_resolution"] === "string" && ALLOWED_TEXTURE.has(source["texture_resolution"])) {
    profile.texture_resolution = source["texture_resolution"] as MeshyProfile["texture_resolution"];
  }
  if (typeof source["geometry_resolution"] === "string" && ALLOWED_GEOMETRY.has(source["geometry_resolution"])) {
    profile.geometry_resolution = source["geometry_resolution"] as MeshyProfile["geometry_resolution"];
  }
  const polycount = Number(source["target_polycount"]);
  if (Number.isFinite(polycount)) profile.target_polycount = Math.min(300000, Math.max(100, Math.round(polycount)));
  if (Array.isArray(source["target_formats"])) {
    const formats = (source["target_formats"] as unknown[]).filter(
      (value): value is string => typeof value === "string" && ["glb", "obj", "fbx", "stl", "usdz", "3mf"].includes(value),
    );
    if (formats.length > 0) profile.target_formats = formats;
  }
  return profile;
}

/** Reads the tunable profile from app settings, falling back to the defaults. */
export async function readProfile(): Promise<MeshyProfile> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", "meshy_profile").maybeSingle();
    return mergeProfile(data?.value);
  } catch {
    return { ...DEFAULT_MESHY_PROFILE };
  }
}

/** The exact JSON body posted to Meshy. Pure, so it can be unit tested. */
export function buildCreatePayload(imageUrl: string, profile: MeshyProfile): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    image_url: imageUrl,
    model_type: profile.model_type,
    ai_model: profile.ai_model,
    should_texture: profile.should_texture,
    target_formats: profile.target_formats,
    moderation: profile.moderation,
    auto_size: profile.auto_size,
  };
  if (profile.should_texture) {
    payload["enable_pbr"] = profile.enable_pbr;
    payload["texture_resolution"] = profile.texture_resolution;
  }
  if (profile.model_type === "standard") {
    payload["geometry_resolution"] = profile.geometry_resolution;
    payload["should_remesh"] = profile.should_remesh;
    if (profile.should_remesh) payload["target_polycount"] = profile.target_polycount;
    payload["save_pre_remeshed_model"] = profile.save_pre_remeshed_model;
  }
  if (profile.multi_view_thumbnails) payload["multi_view_thumbnails"] = true;
  return payload;
}

export type MeshyTaskState = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

/** Maps a raw Meshy task body onto the provider-neutral status shape. */
export function mapTaskStatus(body: Record<string, unknown>): ProviderStatus {
  const raw = String(body["status"] ?? "").toUpperCase();
  const progress = Math.min(100, Math.max(0, Number(body["progress"] ?? 0) || 0));
  const taskError = (body["task_error"] ?? {}) as { message?: unknown };
  const message = typeof taskError.message === "string" && taskError.message ? taskError.message : null;

  if (raw === "SUCCEEDED") return { state: "succeeded", progress: 100, retryable: false };
  if (raw === "FAILED") {
    return {
      state: "failed",
      progress,
      retryable: false,
      error: message ?? "The premium 3D engine could not build this model",
    };
  }
  if (raw === "CANCELED") return { state: "canceled", progress, retryable: false, error: "The job was cancelled" };
  if (raw === "IN_PROGRESS") return { state: "running", progress, retryable: true };
  return { state: "queued", progress, retryable: true };
}

/** Picks the GLB from a task body. Nothing else is accepted as the master. */
export function pickGlbUrl(body: Record<string, unknown>): string | null {
  const urls = (body["model_urls"] ?? {}) as Record<string, unknown>;
  const glb = urls["glb"];
  return typeof glb === "string" && glb.startsWith("http") ? glb : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type FetchOptions = { method: "GET" | "POST"; path: string; body?: unknown; attempts?: number };

/**
 * One authenticated call with bounded backoff. GET retries transient failures;
 * POST retries only 429, so a paid task is never created twice.
 */
async function meshyFetch({ method, path, body, attempts = method === "GET" ? 3 : 2 }: FetchOptions): Promise<Record<string, unknown>> {
  let lastError: Error = new MeshyTransientError("The premium 3D engine did not answer");

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(Math.min(8000, 800 * 2 ** (attempt - 1)));

    let response: Response;
    try {
      response = await fetch(`${meshyBase()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (cause) {
      // A network failure on POST may still have reached Meshy — do not retry.
      if (method === "POST") throw new MeshyTransientError("Could not reach the premium 3D engine");
      lastError = new MeshyTransientError("Could not reach the premium 3D engine");
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new MeshyAuthError("The premium 3D engine rejected our credentials");
    }
    if (response.status === 402) {
      throw new MeshyCreditError("The premium 3D engine is out of credits");
    }
    if (response.status === 429) {
      lastError = new MeshyTransientError("The premium 3D engine is rate-limited — retrying shortly");
      continue;
    }
    if (response.status >= 500) {
      if (method === "POST") throw new MeshyTransientError("The premium 3D engine is unavailable right now");
      lastError = new MeshyTransientError("The premium 3D engine is unavailable right now");
      continue;
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`The premium 3D engine rejected the request (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    return ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  }

  throw lastError;
}

/** Remaining API credits, when the account exposes them. */
export async function readBalance(): Promise<number | null> {
  try {
    const body = await meshyFetch({ method: "GET", path: "/openapi/v1/balance" });
    const value = Number((body as { balance?: unknown }).balance ?? body["credits"]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export async function createTask(imageUrl: string, profile: MeshyProfile): Promise<string> {
  const body = await meshyFetch({ method: "POST", path: "/openapi/v1/image-to-3d", body: buildCreatePayload(imageUrl, profile) });
  const taskId = typeof body["result"] === "string" ? body["result"] : null;
  if (!taskId) throw new MeshyTransientError("The premium 3D engine did not start a task");
  return taskId;
}

export async function readTask(taskId: string): Promise<Record<string, unknown>> {
  return meshyFetch({ method: "GET", path: `/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}` });
}

/** The provider adapter consumed by the orchestrator. */
export const meshyAdapter: PhotoTaskAdapter = {
  id: "meshy",
  kind: "task",
  plan: "premium",
  label: "Meshy",
  available: meshyAvailable,

  async createJob(input) {
    const profile = await readProfile();
    const providerJobId = await createTask(input.imageUrl, profile);
    return {
      providerJobId,
      metadata: { profile, created_at: new Date().toISOString(), api_base: meshyBase() },
    };
  },

  async getStatus(providerJobId) {
    return mapTaskStatus(await readTask(providerJobId));
  },

  async fetchOutputs(providerJobId): Promise<ProviderOutputs> {
    const body = await readTask(providerJobId);
    const glbUrl = pickGlbUrl(body);
    if (!glbUrl) throw new MeshyTransientError("The premium 3D engine did not return a GLB file");
    return {
      glbUrl,
      metadata: {
        task_id: providerJobId,
        started_at: body["started_at"] ?? null,
        finished_at: body["finished_at"] ?? null,
        texture_urls: body["texture_urls"] ?? null,
        thumbnail_url: body["thumbnail_url"] ?? null,
        credits_balance_after: await readBalance(),
      },
    };
  },
};
