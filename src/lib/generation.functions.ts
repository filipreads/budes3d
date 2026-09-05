/**
 * TRELLIS.2 generation as a resumable job.
 *
 * A full reconstruction takes minutes of GPU time, which is far longer than a
 * single serverless request should hold open. The job is therefore split into
 * three persisted steps (preprocess → sculpt → extract+store). The browser
 * polls `getGenerationStatus` and calls `advanceGeneration` until the project
 * reaches `ready` or `failed`, so a dropped connection never loses the job and
 * a failed step can be retried without starting over.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type JobStage = "queued" | "preprocessing" | "sculpting" | "extracting" | "storing" | "ready" | "failed";

export type JobStatus = {
  stage: JobStage;
  progress: number;
  status: string;
  error: string | null;
  retryable: boolean;
  modelRef: string | null;
  done: boolean;
};

const projectInput = z.object({ projectId: z.string().uuid() });
const startInput = projectInput.extend({ engine: z.enum(["trellis", "tripo"]).optional() });

export type EngineInfo = { id: "trellis" | "tripo"; label: string; premium: boolean };

/** Engines the studio may offer — premium engines appear only when configured. */
export const getAvailableEngines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ engines: EngineInfo[] }> => {
    const { tripoAvailable } = await import("./tripo.server");
    const engines: EngineInfo[] = [{ id: "trellis", label: "TRELLIS.2", premium: false }];
    if (tripoAvailable()) engines.push({ id: "tripo", label: "Tripo3D", premium: true });
    return { engines };
  });

/** Puts the project back at the start of the pipeline. */
export const startGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startInput.parse(input))
  .handler(async ({ data, context }): Promise<JobStatus> => {
    const { supabase, userId } = context;

    const { data: project, error } = await supabase
      .from("projects")
      .select("id, source_photos")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !project) throw new Error("Project not found");

    const photos = Array.isArray(project.source_photos) ? (project.source_photos as string[]) : [];
    if (!photos[0]) throw new Error("Upload a photo before generating");

    let engine: "trellis" | "tripo" = data.engine ?? "trellis";
    if (engine === "tripo") {
      const { tripoAvailable, TripoConfigError } = await import("./tripo.server");
      if (!tripoAvailable()) throw new TripoConfigError("Premium 3D engine is not configured");
    }

    await supabase
      .from("projects")
      .update({
        status: "generating",
        generation_stage: "queued",
        generation_progress: 5,
        generation_error: null,
        generation_started_at: new Date().toISOString(),
        provider_job_id: null,
        session_hash: null,
        preview_video_url: null,
        generation_engine: engine,
        model_provider: engine === "tripo" ? "tripo3d" : "microsoft-trellis-2",
      } as Database["public"]["Tables"]["projects"]["Update"])
      .eq("id", project.id)
      .eq("user_id", userId);

    return {
      stage: "queued",
      progress: 5,
      status: "generating",
      error: null,
      retryable: true,
      modelRef: null,
      done: false,
    };
  });

/** Read-only poll target that drives the studio progress UI. */
export const getGenerationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }): Promise<JobStatus> => {
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("status, generation_stage, generation_progress, generation_error, model_url")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    const stage = (project.generation_stage ?? "queued") as JobStage;
    return {
      stage,
      progress: project.generation_progress ?? 0,
      status: project.status,
      error: project.generation_error,
      retryable: stage !== "ready",
      modelRef: project.model_url,
      done: stage === "ready" || stage === "failed",
    };
  });

/**
 * Runs exactly one pipeline step and persists the result. Safe to call again
 * after a failure: the stage the project is parked on is re-executed.
 */
export const advanceGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }): Promise<JobStatus> => {
    const { supabase, userId } = context;

    const { data: project, error } = await supabase
      .from("projects")
      .select(
        "id, source_photos, generation_stage, generation_engine, session_hash, provider_job_id, model_url, status, generation_started_at",
      )
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !project) throw new Error("Project not found");

    const stage = (project.generation_stage ?? "queued") as JobStage;
    if (stage === "ready") {
      return {
        stage,
        progress: 100,
        status: project.status,
        error: null,
        retryable: false,
        modelRef: project.model_url,
        done: true,
      };
    }

    const engine = (((project as { generation_engine?: string }).generation_engine) ?? "trellis") as
      | "trellis"
      | "tripo";
    const trellis = await import("./trellis.server");
    type ProjectPatch = Database["public"]["Tables"]["projects"]["Update"];
    const patch = async (fields: ProjectPatch) => {
      await supabase.from("projects").update(fields).eq("id", project.id).eq("user_id", userId);
    };

    try {
      // ---- Tripo3D (premium) pipeline: create task -> poll -> download GLB --
      if (engine === "tripo") {
        const tripo = await import("./tripo.server");

        if (stage === "queued" || stage === "preprocessing" || stage === "failed") {
          await patch({ generation_stage: "preprocessing", generation_progress: 12, generation_error: null, status: "generating" });
          const photos = Array.isArray(project.source_photos) ? (project.source_photos as string[]) : [];
          const sourcePath = photos[0];
          if (!sourcePath) throw new Error("Upload a photo before generating");
          const { data: signed, error: signError } = await supabase.storage
            .from("portrait-uploads")
            .createSignedUrl(sourcePath, 60 * 10);
          if (signError || !signed?.signedUrl) throw new Error("Could not prepare the photo for generation");

          const taskId = await tripo.createTask(signed.signedUrl);
          const { currentPlan } = await import("./quota.server");
          await patch({
            provider_job_id: taskId,
            generation_stage: "sculpting",
            generation_progress: 30,
            generation_plan: await currentPlan(),
          });
          return status("sculpting", 30, null);
        }

        if (!project.provider_job_id) throw new Error("Generation state was lost — start the job again");
        const task = await tripo.waitForTask(project.provider_job_id, 50_000, async (fraction) => {
          await patch({ generation_progress: 30 + Math.round(fraction * 55) });
        });
        if (task.status === "failed" || task.status === "cancelled" || task.status === "unknown") {
          throw new Error("The premium 3D engine failed to generate the model");
        }
        if (task.status !== "success" || !task.modelUrl) {
          // Still running — keep the stage so the next poll continues waiting.
          return { ...status(stage === "sculpting" ? "sculpting" : "extracting", Math.max(30, Math.round(task.progress)), null), retryable: false };
        }

        await patch({ generation_stage: "storing", generation_progress: 90 });
        return await storeModelFromUrl(supabase, userId, project.id, project.generation_started_at, task.modelUrl, "tripo3d", patch);
      }

      // ---- TRELLIS.2 (standard) pipeline ------------------------------------
      if (engine === "trellis") {
      // ---- Step 1: upload the portrait to the Space and preprocess it -------
      if (stage === "queued" || stage === "preprocessing" || stage === "failed") {
        await patch({ generation_stage: "preprocessing", generation_progress: 12, generation_error: null, status: "generating" });

        const photos = Array.isArray(project.source_photos) ? (project.source_photos as string[]) : [];
        const sourcePath = photos[0];
        if (!sourcePath) throw new Error("Upload a photo before generating");

        const { data: signed, error: signError } = await supabase.storage
          .from("portrait-uploads")
          .createSignedUrl(sourcePath, 60 * 30);
        if (signError || !signed?.signedUrl) throw new Error("Could not prepare the photo for generation");

        const sessionHash = trellis.makeSessionHash(project.id);
        await trellis.startSession(sessionHash);
        const uploaded = await trellis.uploadPortrait(signed.signedUrl, sessionHash);
        const prepared = await trellis.preprocessImage(uploaded, sessionHash);

        await patch({
          session_hash: sessionHash,
          provider_job_id: JSON.stringify(prepared),
          generation_stage: "sculpting",
          generation_progress: 30,
        });
        return status("sculpting", 30, null);
      }

      // ---- Step 2: the GPU reconstruction ----------------------------------
      if (stage === "sculpting") {
        const sessionHash = project.session_hash;
        const preparedRaw = project.provider_job_id;
        if (!sessionHash || !preparedRaw) throw new Error("Generation state was lost — start the job again");
        const prepared = JSON.parse(preparedRaw) as import("./trellis.server").GradioFile;

        await trellis.imageTo3d(prepared, project.id, sessionHash, async (fraction, message) => {
          await patch({
            generation_progress: 30 + Math.round(fraction * 40),
            generation_error: null,
            generation_stage: "sculpting",
            ...(message ? {} : {}),
          });
        });

        await patch({ generation_stage: "extracting", generation_progress: 72 });
        return status("extracting", 72, null);
      }

      // ---- Step 3: extract the GLB and store it in our own bucket ----------
      const sessionHash = project.session_hash;
      if (!sessionHash) throw new Error("Generation state was lost — start the job again");

      const glbUrl = await trellis.extractGlb(sessionHash, async (fraction) => {
        await patch({ generation_progress: 72 + Math.round(fraction * 16) });
      });

      await patch({ generation_stage: "storing", generation_progress: 90 });

      const glbResponse = await fetch(glbUrl);
      if (!glbResponse.ok) throw new Error("Could not download the generated model");
      const glbBytes = new Uint8Array(await glbResponse.arrayBuffer());
      if (glbBytes.byteLength < 1024) throw new Error("The 3D engine returned an empty model");

      const storagePath = `${userId}/${project.id}.glb`;
      const upload = await supabase.storage.from("portrait-models").upload(storagePath, glbBytes, {
        contentType: "model/gltf-binary",
        upsert: true,
      });
      if (upload.error) throw new Error(upload.error.message);

      const startedAt = project.generation_started_at ? Date.parse(project.generation_started_at) : NaN;
      const seconds = Number.isFinite(startedAt)
        ? Math.max(1, Math.min(1800, Math.round((Date.now() - startedAt) / 1000)))
        : null;
      const { currentPlan } = await import("./quota.server");

      await patch({
        status: "ready",
        model_url: storagePath,
        model_provider: "microsoft-trellis-2",
        generation_stage: "ready",
        generation_progress: 100,
        generation_error: null,
        generation_seconds: seconds,
        generation_plan: await currentPlan(),
      });

      return { ...status("ready", 100, null), modelRef: storagePath, status: "ready", done: true, retryable: false };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Generation failed";
      const quota = cause instanceof trellis.TrellisQuotaError;
      const transient = cause instanceof trellis.TrellisTransientError;
      const retryable = transient && !quota;

      // A quota ceiling is not a broken project — it is a job waiting for GPU
      // time, so it is parked as `quota_blocked` instead of `failed`.
      await patch({
        generation_error: message,
        ...(quota
          ? { generation_stage: "queued", status: "quota_blocked", generation_progress: 0 }
          : retryable
            ? {}
            : { generation_stage: "failed", status: "failed", generation_progress: 0 }),
      });

      return {
        stage: quota ? "queued" : retryable ? stage : "failed",
        progress: 0,
        status: quota ? "quota_blocked" : retryable ? "generating" : "failed",
        error: message,
        retryable: retryable || quota,
        modelRef: null,
        done: !retryable,
      };
    }
  });

function status(stage: JobStage, progress: number, error: string | null): JobStatus {
  return {
    stage,
    progress,
    status: "generating",
    error,
    retryable: true,
    modelRef: null,
    done: false,
  };
}
