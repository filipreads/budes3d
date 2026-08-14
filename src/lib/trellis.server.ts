/**
 * Microsoft TRELLIS.2 adapter (server-only).
 *
 * Talks to a Gradio 6 Space over its REST/SSE protocol:
 *   POST /gradio_api/call/<fn>  -> { event_id }
 *   GET  /gradio_api/call/<fn>/<event_id> -> SSE stream with progress + result
 *
 * All three steps share one `session_hash`, because `/extract_glb` reads the
 * asset left in the Space's per-session state by `/image_to_3d`.
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

export type TrellisInput = {
  /** Publicly reachable (signed) URL of the prepared portrait photo. */
  imageUrl: string;
  seedKey: string;
  onProgress?: ((update: TrellisProgress) => Promise<void> | void) | undefined;
};

export type TrellisResult = {
  /** Remote URL of the generated GLB on the provider. */
  glbUrl: string;
  /** Optional turntable preview video produced by image_to_3d. */
  previewVideoUrl: string | null;
  provider: string;
  sessionHash: string;
};

const DEFAULT_SPACE = "https://microsoft-trellis-2.hf.space";
const STEP_TIMEOUT_MS = 6 * 60 * 1000;

function spaceUrl() {
  return (process.env["TRELLIS_SPACE_URL"] || DEFAULT_SPACE).replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const token = process.env["HF_TOKEN"];
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function makeSessionHash(seedKey: string) {
  return `relievo-${seedKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}-${Date.now().toString(36)}`;
}

type CallResult = { data: unknown[] };

/** POSTs a Gradio endpoint and reads its SSE stream to completion. */
async function callGradio(
  fnName: string,
  payload: unknown[],
  sessionHash: string,
  onProgress?: (fraction: number, message?: string) => Promise<void> | void,
): Promise<CallResult> {
  const base = spaceUrl();
  const start = await fetch(`${base}/gradio_api/call/${fnName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ data: payload, session_hash: sessionHash }),
  });

  if (start.status === 429) throw new Error("The 3D engine is at capacity right now — please try again shortly.");
  if (!start.ok) throw new Error(`3D engine rejected the request (${start.status})`);

  const started = (await start.json()) as { event_id?: string };
  if (!started.event_id) throw new Error("The 3D engine did not start a job");

  const stream = await fetch(`${base}/gradio_api/call/${fnName}/${started.event_id}`, {
    headers: { Accept: "text/event-stream", ...authHeaders() },
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  if (!stream.ok || !stream.body) throw new Error(`Lost connection to the 3D engine (${stream.status})`);

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";

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

        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) continue;

        const raw = line.slice(5).trim();
        if (!raw) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }

        if (event === "error") {
          const message = typeof parsed === "string" ? parsed : "The 3D engine reported an error";
          throw new Error(message);
        }
        if (event === "complete" || (Array.isArray(parsed) && event !== "generating")) {
          return { data: Array.isArray(parsed) ? parsed : [parsed] };
        }
        if (onProgress && parsed && typeof parsed === "object") {
          const record = parsed as { progress_data?: { progress?: number; desc?: string }[]; rank?: number };
          const first = record.progress_data?.[0];
          if (typeof first?.progress === "number") {
            await onProgress(Math.min(Math.max(first.progress, 0), 1), first.desc);
          } else if (typeof record.rank === "number") {
            await onProgress(0, `Queued (position ${record.rank + 1})`);
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  throw new Error("The 3D engine finished without returning a result");
}

function fileUrlFrom(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.startsWith("http") ? value : null;
  if (typeof value === "object") {
    const record = value as { url?: string; path?: string; video?: unknown };
    if (record.video) return fileUrlFrom(record.video);
    if (typeof record.url === "string") return record.url;
    if (typeof record.path === "string") return `${spaceUrl()}/gradio_api/file=${record.path}`;
  }
  return null;
}

type GradioFile = { path: string; meta: { _type: "gradio.FileData" }; orig_name: string };

/**
 * Uploads the portrait to the Space through `/gradio_api/upload`.
 * Gradio 6 expects a server-side `{ path }` reference for file inputs — passing
 * a remote `url` makes the endpoint 404 / fail to read the image.
 */
async function uploadImage(imageUrl: string, sessionHash: string): Promise<GradioFile> {
  const source = await fetch(imageUrl);
  if (!source.ok) throw new Error("Could not read the uploaded photo");
  const blob = await source.blob();
  const origName = "portrait.jpg";

  const form = new FormData();
  form.append("files", blob, origName);

  const response = await fetch(`${spaceUrl()}/gradio_api/upload?upload_id=${sessionHash}`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!response.ok) throw new Error(`The 3D engine refused the photo upload (${response.status})`);

  const paths = (await response.json()) as unknown;
  const path = Array.isArray(paths) ? String(paths[0] ?? "") : "";
  if (!path) throw new Error("The 3D engine did not accept the photo");

  return { path, meta: { _type: "gradio.FileData" }, orig_name: origName };
}

export async function runTrellis(input: TrellisInput): Promise<TrellisResult> {
  if (!input.imageUrl) throw new Error("Upload a photo before generating");

  const sessionHash = makeSessionHash(input.seedKey);
  const report = async (stage: TrellisStage, progress: number, message?: string) => {
    await input.onProgress?.({ stage, progress, message });
  };

  const base = spaceUrl();
  await fetch(`${base}/gradio_api/call/start_session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ data: [], session_hash: sessionHash }),
  }).catch(() => undefined);

  await report("preprocessing", 10);
  const uploaded = await uploadImage(input.imageUrl, sessionHash);
  const preprocessed = await callGradio("preprocess_image", [uploaded], sessionHash);
  const preparedImage = preprocessed.data[0];
  if (!preparedImage) throw new Error("The 3D engine could not read that photo");

  await report("sculpting", 25);
  const seed = Math.abs(hash32(input.seedKey)) % 2147483647;
  // Parameter order mirrors /gradio_api/info for `image_to_3d`:
  // image, seed, resolution, ss_(guidance_strength, guidance_rescale, sampling_steps, rescale_t),
  // shape_slat_(…), tex_slat_(…)
  const sculpt = await callGradio(
    "image_to_3d",
    [preparedImage, seed, "1024", 7.5, 0.7, 12, 5.0, 7.5, 0.5, 12, 3.0, 1.0, 0.0, 12, 3.0],
    sessionHash,
    async (fraction, message) => {
      await report("sculpting", 25 + Math.round(fraction * 45), message);
    },
  );
  void sculpt;

  await report("extracting", 75);
  const extracted = await callGradio("extract_glb", [300000, 2048], sessionHash, async (fraction) => {
    await report("extracting", 75 + Math.round(fraction * 15));
  });

  const glbUrl = fileUrlFrom(extracted.data[0]) ?? fileUrlFrom(extracted.data[1]);
  if (!glbUrl) throw new Error("The 3D engine did not return a GLB file");

  return { glbUrl, previewVideoUrl: null, provider: "microsoft-trellis-2", sessionHash };
}

function hash32(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  return hash;
}
