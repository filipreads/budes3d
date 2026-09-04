/**
 * Tripo3D provider (server-only) — the premium image-to-3D engine.
 *
 * REST task flow (https://api.tripo3d.ai/v2/openapi):
 *   POST /task            { type: "image_to_model", file: { type, url } } -> task_id
 *   GET  /task/{task_id}  -> { status, progress, output: { model, pbr_model, ... } }
 *
 * The API key lives in the TRIPO_API_KEY secret and is read inside handlers
 * only. When the secret is absent the engine is simply not offered — callers
 * fall back to TRELLIS.
 */

const API_BASE = "https://api.tripo3d.ai/v2/openapi";

export type TripoTaskStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";

export type TripoTask = {
  taskId: string;
  status: TripoTaskStatus;
  /** 0–100 while running. */
  progress: number;
  modelUrl: string | null;
};

export class TripoConfigError extends Error {}

function apiKey(): string {
  const key = process.env["TRIPO_API_KEY"];
  if (!key) throw new TripoConfigError("Premium 3D engine is not configured");
  return key;
}

export function tripoAvailable(): boolean {
  return Boolean(process.env["TRIPO_API_KEY"]);
}

async function tripoFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}`, ...init?.headers },
  });
  if (response.status === 429) throw new Error("The premium 3D engine is rate-limited — retrying shortly.");
  const body = (await response.json().catch(() => null)) as { code?: number; data?: unknown } | null;
  if (!response.ok || !body || (typeof body.code === "number" && body.code !== 0)) {
    throw new Error(`The premium 3D engine rejected the request (${response.status})`);
  }
  return (body.data ?? {}) as Record<string, unknown>;
}

/** Creates an image-to-model task from a publicly reachable image URL. */
export async function createTask(imageUrl: string): Promise<string> {
  const data = await tripoFetch("/task", {
    method: "POST",
    body: JSON.stringify({
      type: "image_to_model",
      file: { type: "jpeg", url: imageUrl },
    }),
  });
  const taskId = typeof data["task_id"] === "string" ? data["task_id"] : null;
  if (!taskId) throw new Error("The premium 3D engine did not start a task");
  return taskId;
}

/** Reads a task once. Use {@link waitForTask} for a bounded wait. */
export async function readTask(taskId: string): Promise<TripoTask> {
  const data = await tripoFetch(`/task/${encodeURIComponent(taskId)}`);
  return mapTask(taskId, data);
}

function mapTask(taskId: string, data: Record<string, unknown>): TripoTask {
  const status = String(data["status"] ?? "unknown") as TripoTaskStatus;
  const progress = typeof data["progress"] === "number" ? data["progress"] : 0;
  const output = (data["output"] ?? {}) as Record<string, unknown>;
  const modelUrl =
    (typeof output["pbr_model"] === "string" && output["pbr_model"]) ||
    (typeof output["model"] === "string" && output["model"]) ||
    null;
  return { taskId, status, progress, modelUrl };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls a task for up to `budgetMs`, reporting progress between 0 and 1.
 * Returns the latest snapshot — callers check `status` for completion.
 */
export async function waitForTask(
  taskId: string,
  budgetMs: number,
  onProgress?: (fraction: number) => Promise<void> | void,
): Promise<TripoTask> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const task = await readTask(taskId);
    if (onProgress) await onProgress(Math.min(Math.max(task.progress / 100, 0), 1));
    if (task.status !== "queued" && task.status !== "running") return task;
    if (Date.now() > deadline) return task;
    await sleep(5000);
  }
}
