/**
 * Admin-only TRELLIS.2 runtime smoke test.
 *
 * Runs the real pipeline against the configured Space with the current
 * HF_TOKEN / ZeroGPU quota. Split into steps so no single request has to hold
 * open for the whole GPU job — the page calls the steps in sequence and shows
 * the accumulated log.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SmokeStep = "session" | "sculpt" | "extract";

export type SmokeState = { sessionHash?: string | undefined; prepared?: string | undefined };

export type SmokeResult = {
  ok: boolean;
  step: SmokeStep;
  next: SmokeStep | null;
  logs: string[];
  state: SmokeState;
  glbUrl: string | null;
  error: string | null;
  errorKind: "quota" | "transient" | "fatal" | null;
  ms: number;
};

const CANDIDATE_IMAGES = [
  "https://raw.githubusercontent.com/microsoft/TRELLIS/main/assets/example_image/T.png",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=768&q=80",
];

const smokeInput = z.object({
  step: z.enum(["session", "sculpt", "extract"]),
  imageUrl: z.string().url().optional(),
  state: z.object({ sessionHash: z.string().optional(), prepared: z.string().optional() }).optional(),
});

export const runTrellisSmokeStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => smokeInput.parse(input))
  .handler(async ({ data, context }): Promise<SmokeResult> => {
    const { data: admin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (admin !== true) throw new Error("Forbidden");

    const started = Date.now();
    const logs: string[] = [];
    const log = (line: string) => logs.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
    const trellis = await import("./trellis.server");
    const state: SmokeState = { ...(data.state ?? {}) };

    const fail = (cause: unknown): SmokeResult => {
      const message = cause instanceof Error ? cause.message : String(cause);
      const kind = cause instanceof trellis.TrellisQuotaError
        ? "quota"
        : cause instanceof trellis.TrellisTransientError
          ? "transient"
          : "fatal";
      log(`FAILED (${kind}): ${message}`);
      return {
        ok: false,
        step: data.step,
        next: null,
        logs,
        state,
        glbUrl: null,
        error: message,
        errorKind: kind,
        ms: Date.now() - started,
      };
    };

    log(`Space: ${trellis.spaceUrl()}`);
    log(`HF_TOKEN: ${process.env["HF_TOKEN"] ? "present" : "MISSING (anonymous quota)"}`);

    try {
      if (data.step === "session") {
        let imageUrl = data.imageUrl ?? null;
        if (!imageUrl) {
          for (const candidate of CANDIDATE_IMAGES) {
            const probe = await fetch(candidate, { method: "GET" });
            log(`Probe sample image ${candidate} → ${probe.status}`);
            if (probe.ok) {
              imageUrl = candidate;
              break;
            }
          }
        }
        if (!imageUrl) throw new Error("No usable test image — paste an image URL");
        log(`Test image: ${imageUrl}`);

        const sessionHash = trellis.makeSessionHash("smoketest");
        state.sessionHash = sessionHash;
        log(`session_hash = ${sessionHash}`);

        await trellis.startSession(sessionHash);
        log("start_session OK");

        const uploaded = await trellis.uploadPortrait(imageUrl, sessionHash);
        log(`upload OK → ${uploaded.path}`);

        const prepared = await trellis.preprocessImage(uploaded, sessionHash);
        state.prepared = JSON.stringify(prepared);
        log("preprocess_image OK");

        return {
          ok: true,
          step: "session",
          next: "sculpt",
          logs,
          state,
          glbUrl: null,
          error: null,
          errorKind: null,
          ms: Date.now() - started,
        };
      }

      if (data.step === "sculpt") {
        if (!state.sessionHash || !state.prepared) throw new Error("Run step 1 first");
        log("image_to_3d started (GPU) …");
        await trellis.imageTo3d(
          JSON.parse(state.prepared) as import("./trellis.server").GradioFile,
          "smoketest",
          state.sessionHash,
          (fraction, message) => {
            log(`progress ${Math.round(fraction * 100)}%${message ? ` — ${message}` : ""}`);
          },
        );
        log("image_to_3d OK");
        return {
          ok: true,
          step: "sculpt",
          next: "extract",
          logs,
          state,
          glbUrl: null,
          error: null,
          errorKind: null,
          ms: Date.now() - started,
        };
      }

      if (!state.sessionHash) throw new Error("Run step 1 first");
      log("extract_glb started …");
      const glbUrl = await trellis.extractGlb(state.sessionHash, (fraction) => {
        log(`extract progress ${Math.round(fraction * 100)}%`);
      });
      const head = await fetch(glbUrl);
      const bytes = head.ok ? (await head.arrayBuffer()).byteLength : 0;
      log(`GLB ready (${head.status}, ${bytes} bytes)`);
      if (!head.ok || bytes < 1024) throw new Error("GLB download failed or file is empty");

      return {
        ok: true,
        step: "extract",
        next: null,
        logs,
        state,
        glbUrl,
        error: null,
        errorKind: null,
        ms: Date.now() - started,
      };
    } catch (cause) {
      return fail(cause);
    }
  });
