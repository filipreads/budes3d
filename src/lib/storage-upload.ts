import { supabase } from "@/integrations/supabase/client";

/**
 * Uploads a file to Supabase Storage over XHR so the UI can show real byte
 * progress, and retries with backoff when a flaky mobile connection drops the
 * request mid-flight. The target path stays the same across attempts (upsert),
 * so a retry resumes the same slot instead of leaving orphaned objects.
 */
export async function uploadWithProgress(options: {
  bucket: string;
  path: string;
  body: Blob;
  contentType?: string;
  attempts?: number;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { bucket, path, body, contentType = body.type || "application/octet-stream" } = options;
  const attempts = options.attempts ?? 3;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  const baseUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  const apiKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;

  // Without a usable endpoint we still upload — just without progress events.
  if (!baseUrl || !apiKey || !token) {
    const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType, upsert: true });
    if (error) throw new Error(error.message);
    options.onProgress?.(100);
    return;
  }

  const url = `${baseUrl}/storage/v1/object/${bucket}/${path}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new Error("aborted");
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("authorization", `Bearer ${token}`);
        xhr.setRequestHeader("apikey", apiKey);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.setRequestHeader("content-type", contentType);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) options.onProgress?.(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error("network"));
        xhr.onabort = () => reject(new Error("aborted"));
        options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(body);
      });
      options.onProgress?.(100);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("network");
      if (lastError.message === "aborted") throw lastError;
      if (attempt === attempts) break;
      // Wait for the connection to come back before burning the next attempt.
      await waitForOnline(attempt * 1200);
    }
  }

  throw lastError ?? new Error("Upload failed");
}

function waitForOnline(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("online", done);
      resolve();
    };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      window.addEventListener("online", done, { once: true });
      return;
    }
    setTimeout(resolve, delayMs);
  });
}
