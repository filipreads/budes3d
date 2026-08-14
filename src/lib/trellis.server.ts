/**
 * Microsoft TRELLIS.2 adapter (server-only).
 *
 * The Space runs Gradio 6.1 with the `sse_v3` queue protocol. The simple REST
 * shortcut (`POST /gradio_api/call/<fn>`) is not served by this deployment — it
 * answers every job with `404: Not Found` — so we speak the real protocol:
 *
 *   POST /gradio_api/upload?upload_id=<session>  -> ["/tmp/gradio/.../file.jpg"]
 *   POST /gradio_api/queue/join                  -> { event_id }
 *   GET  /gradio_api/queue/data?session_hash=…   -> SSE progress + result
 *
 * Every step of one generation shares a single `session_hash`, because
 * `extract_glb` reads the gaussian/mesh state that `image_to_3d` left in the
 * Space's per-session state (component id 45, passed as `null` on the wire).
 *
 * Swap point for a different host (own duplicated Space on a dedicated GPU,
 * fal.ai, Replicate): change TRELLIS_SPACE_URL or this file only.
 */

export type TrellisStage =
  | "queued"
  | "preprocessing"
  | "sculpting"
  | "extracting"
  | "storing"
  | "ready"
  | "failed";

export type TrellisProgress = { stage: TrellisStage; progress: number; message?: string | undefined };

export type GradioFile = {
  path: string;
  meta: { _type: "gradio.FileData" };
  orig_name?: string;
  mime_type?: string;
  size?: number;
  url?: string;
};

/** fn_index values from the Space config (`GET /config` → dependencies). */
const FN = { startSession: 2, preprocess: 4, imageTo3d: 7, extractGlb: 9 } as const;

const DEFAULT_SPACE = "https://microsoft-trellis-2.hf.space";
const STEP_TIMEOUT_MS = 8 * 60 * 1000;

/** Thrown when the provider is out of GPU quota — retrying immediately is pointless. */
export class TrellisQuotaError extends Error {}
/** Thrown for transient provider failures where a retry is worth attempting. */
export class TrellisTransientError extends Error {}

export function spaceUrl() {
  return (process.env["TRELLIS_SPACE_URL"] || DEFAULT_SPACE).replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const token = process.env["HF_TOKEN"];
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function makeSessionHash(seedKey: string) {
  return `relievo${seedKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}${Date.now().toString(36)}`;
}

function classify(message: string): Error {
  if (/quota/i.test(message)) return new TrellisQuotaError(message);
  if (/(429|capacity|timeout|temporarily|connection|502|503|504)/i.test(message)) {
    return new TrellisTransientError(message);
  }
  return new Error(message);
}

type QueueResult = unknown[];

/**
 * Joins the Gradio queue for one function and follows the session SSE stream
 * until the *matching* event completes. Filtering on `event_id` matters: the
 * stream replays every event of the session, including `start_session`.
 */
async function queueCall(
  fnIndex: number,
  payload: unknown[],
  sessionHash: string,
  onProgress?: (fraction: number, message?: string) => Promise<void> | void,
): Promise<QueueResult> {
  const base = spaceUrl();
  const join = await fetch(`${base}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      data: payload,
      event_data: null,
      fn_index: fnIndex,
      trigger_id: null,
      session_hash: sessionHash,
    }),
  });
  if (join.status === 429) throw new TrellisTransientError("The 3D engine is at capacity — retrying shortly.");
  if (!join.ok) throw classify(`3D engine rejected the request (${join.status})`);

  const started = (await join.json()) as { event_id?: string };
  const eventId = started.event_id;
  if (!eventId) throw new TrellisTransientError("The 3D engine did not start a job");

  const stream = await fetch(`${base}/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`, {
    headers: { Accept: "text/event-stream", ...authHeaders() },
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  if (!stream.ok || !stream.body) throw new TrellisTransientError(`Lost connection to the 3D engine (${stream.status})`);

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index).trimEnd();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;

        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
        } catch {
          continue;
        }

        const id = message["event_id"];
        if (typeof id === "string" && id !== eventId) continue;

        const kind = message["msg"];
        if (kind === "unexpected_error" || kind === "close_stream") {
          throw classify(String(message["message"] ?? "The 3D engine dropped the job"));
        }
        if (kind === "estimation" && onProgress) {
          const rank = Number(message["rank"] ?? 0);
          await onProgress(0, `Queued (position ${rank + 1})`);
        }
        if (kind === "progress" && onProgress) {
          const entry = (message["progress_data"] as { progress?: number; desc?: string }[] | undefined)?.[0];
          if (entry && typeof entry.progress === "number") {
            await onProgress(Math.min(Math.max(entry.progress, 0), 1), entry.desc);
          }
        }
        if (kind === "process_completed") {
          const output = (message["output"] ?? {}) as { data?: unknown[]; error?: unknown };
          if (message["success"] === false || output.error) {
            throw classify(String(output.error ?? "The 3D engine reported an error"));
          }
          return Array.isArray(output.data) ? output.data : [];
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  throw new TrellisTransientError("The 3D engine finished without returning a result");
}

export function fileUrlFrom(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.startsWith("http") ? value : null;
  if (typeof value === "object") {
    const record = value as { url?: string; path?: string; value?: unknown; video?: unknown };
    if (record.video) return fileUrlFrom(record.video);
    if (typeof record.url === "string") return record.url;
    if (typeof record.path === "string") return `${spaceUrl()}/gradio_api/file=${record.path}`;
    if (record.value) return fileUrlFrom(record.value);
  }
  return null;
}

/** Opens the Space-side session that later steps read their state from. */
export async function startSession(sessionHash: string) {
  await queueCall(FN.startSession, [], sessionHash);
}

/**
 * Streams the portrait into the Space. Gradio 6 file inputs must reference a
 * server-side `{ path }`; a remote URL is not fetched by this app.
 */
export async function uploadPortrait(imageUrl: string, sessionHash: string): Promise<GradioFile> {
  const source = await fetch(imageUrl);
  if (!source.ok) throw new Error("Could not read the uploaded photo");
  const bytes = new Uint8Array(await source.arrayBuffer());
  const origName = "portrait.jpg";

  const form = new FormData();
  form.append("files", new Blob([bytes], { type: "image/jpeg" }), origName);

  const response = await fetch(`${spaceUrl()}/gradio_api/upload?upload_id=${encodeURIComponent(sessionHash)}`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!response.ok) throw classify(`The 3D engine refused the photo upload (${response.status})`);

  const paths = (await response.json()) as unknown;
  const path = Array.isArray(paths) ? String(paths[0] ?? "") : "";
  if (!path) throw new TrellisTransientError("The 3D engine did not accept the photo");

  return {
    path,
    meta: { _type: "gradio.FileData" },
    orig_name: origName,
    mime_type: "image/jpeg",
    size: bytes.byteLength,
  };
}

/** Step 1 — background removal / framing done by the Space itself. */
export async function preprocessImage(file: GradioFile, sessionHash: string): Promise<GradioFile> {
  const data = await queueCall(FN.preprocess, [file], sessionHash);
  const prepared = data[0] as GradioFile | undefined;
  if (!prepared) throw new TrellisTransientError("The 3D engine could not read that photo");
  return prepared;
}

/** Step 2 — the GPU reconstruction. Leaves the asset in the Space session state. */
export async function imageTo3d(
  image: GradioFile,
  seedKey: string,
  sessionHash: string,
  onProgress?: (fraction: number, message?: string) => Promise<void> | void,
) {
  const seed = Math.abs(hash32(seedKey)) % 2147483647;
  // Order mirrors /gradio_api/info: image, seed, resolution, ss_*, shape_slat_*, tex_slat_*
  await queueCall(
    FN.imageTo3d,
    [image, seed, "1024", 7.5, 0.7, 12, 5.0, 7.5, 0.5, 12, 3.0, 1.0, 0.0, 12, 3.0],
    sessionHash,
    onProgress,
  );
}

/** Step 3 — bake the session asset into a downloadable GLB. */
export async function extractGlb(
  sessionHash: string,
  onProgress?: (fraction: number, message?: string) => Promise<void> | void,
): Promise<string> {
  // First input is the Space's State component; the queue protocol resolves it
  // from the session, so `null` is the correct wire value.
  const data = await queueCall(FN.extractGlb, [null, 300000, 2048], sessionHash, onProgress);
  const url = fileUrlFrom(data[0]) ?? fileUrlFrom(data[1]);
  if (!url) throw new TrellisTransientError("The 3D engine did not return a GLB file");
  return url;
}

function hash32(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  return hash;
}
