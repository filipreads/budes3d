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
const startInput = projectInput.extend({ engine: z.enum(["trellis", "meshy", "tripo"]).optional() });

export type EngineId = "trellis" | "meshy" | "tripo";

export type EngineInfo = {
  id: EngineId;
  label: string;
  premium: boolean;
  provider: string;
  plan: "basic" | "premium";
  /** Product surcharge in minor units of the requested currency (0 for basic). */
  surchargeCents: number;
};

const PROVIDER_OF: Record<EngineId, string> = {
  trellis: "microsoft-trellis-2",
  meshy: "meshy",
  tripo: "tripo3d",
};

/** Engines the studio may offer — premium engines appear only when configured. */
export const getAvailableEngines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ currency: z.enum(["czk", "eur"]).optional() }).parse(input ?? {}))
  .handler(async ({ data }): Promise<{ engines: EngineInfo[] }> => {
    const currency = data.currency ?? "czk";
    const { premiumRateCents } = await import("./premium.server");
    const { meshyAvailable } = await import("./meshy.server");
    const { tripoAvailable } = await import("./tripo.server");

    const engines: EngineInfo[] = [
      { id: "trellis", label: "TRELLIS.2", premium: false, provider: PROVIDER_OF.trellis, plan: "basic", surchargeCents: 0 },
    ];
    const surcharge = await premiumRateCents(currency);
    if (meshyAvailable()) {
      engines.push({ id: "meshy", label: "Meshy", premium: true, provider: PROVIDER_OF.meshy, plan: "premium", surchargeCents: surcharge });
    }
    if (tripoAvailable()) {
      engines.push({ id: "tripo", label: "Tripo3D", premium: true, provider: PROVIDER_OF.tripo, plan: "premium", surchargeCents: surcharge });
    }
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

    const engine: EngineId = data.engine ?? "trellis";
    if (engine === "tripo") {
      const { tripoAvailable, TripoConfigError } = await import("./tripo.server");
      if (!tripoAvailable()) throw new TripoConfigError("Premium 3D engine is not configured");
    }
    if (engine === "meshy") {
      const { meshyAvailable, MeshyConfigError } = await import("./meshy.server");
      if (!meshyAvailable()) throw new MeshyConfigError("Premium 3D engine is not configured");
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
        model_provider: PROVIDER_OF[engine],
      } as Database["public"]["Tables"]["projects"]["Update"])
      .eq("id", project.id)
      .eq("user_id", userId);

    // Open the persisted job record for this run.
    const { openJob } = await import("./jobs.server");
    await openJob(supabase, {
      projectId: project.id,
      userId,
      engine,
      provider: PROVIDER_OF[engine],
      plan: engine === "trellis" ? "basic" : "premium",
    });

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

export type ActiveGeneration = {
  projectId: string;
  engine: EngineId;
  stage: JobStage;
  progress: number;
  error: string | null;
  modelRef: string | null;
  startedAt: string | null;
  done: boolean;
};

/**
 * Finds the customer's most recent generation run so the studio can pick it
 * back up after a reload — even on a new device or with cleared browser
 * storage. Paid premium runs keep going server-side; this is how the customer
 * gets back to them (or straight to the finished model).
 */
export const findActiveGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ job: ActiveGeneration | null }> => {
    const { supabase, userId } = context;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: project } = await supabase
      .from("projects")
      .select(
        "id, generation_stage, generation_progress, generation_error, generation_engine, generation_started_at, model_url, updated_at",
      )
      .eq("user_id", userId)
      .not("generation_stage", "is", null)
      .neq("generation_stage", "failed")
      .gte("updated_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!project) return { job: null };

    const stage = (project.generation_stage ?? "queued") as JobStage;
    // A finished run only matters here when its model is actually available.
    if (stage === "ready" && !project.model_url) return { job: null };

    return {
      job: {
        projectId: project.id,
        engine: ((project as { generation_engine?: string }).generation_engine ?? "trellis") as EngineId,
        stage,
        progress: project.generation_progress ?? 0,
        error: project.generation_error,
        modelRef: project.model_url,
        startedAt: (project as { generation_started_at?: string | null }).generation_started_at ?? null,
        done: stage === "ready",
      },
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
      | "meshy"
      | "tripo";
    const trellis = await import("./trellis.server");
    const { currentJob, patchJob } = await import("./jobs.server");
    const jobRow = await currentJob(supabase, project.id, userId);
    const jobId = jobRow?.id ?? null;
    type ProjectPatch = Database["public"]["Tables"]["projects"]["Update"];
    const patch = async (fields: ProjectPatch) => {
      await supabase.from("projects").update(fields).eq("id", project.id).eq("user_id", userId);
      await patchJob(supabase, jobId, {
        ...(fields.generation_stage ? { stage: fields.generation_stage } : {}),
        ...(typeof fields.generation_progress === "number" ? { progress: fields.generation_progress } : {}),
        ...(fields.status ? { status: fields.status } : {}),
        ...(fields.generation_error !== undefined ? { error: fields.generation_error } : {}),
        ...(fields.provider_job_id !== undefined ? { provider_job_id: fields.provider_job_id } : {}),
        ...(fields.model_url ? { master_model_path: fields.model_url, finished_at: new Date().toISOString() } : {}),
      });
    };

    try {
      // ---- Meshy (premium) pipeline: create task -> poll -> download GLB ----
      if (engine === "meshy") {
        const meshy = await import("./meshy.server");
        const adapter = meshy.meshyAdapter;
        if (!adapter.available()) throw new meshy.MeshyConfigError("Premium 3D engine is not configured");

        if (stage === "queued" || stage === "preprocessing" || stage === "failed") {
          await patch({ generation_stage: "preprocessing", generation_progress: 12, generation_error: null, status: "generating" });
          const photos = Array.isArray(project.source_photos) ? (project.source_photos as string[]) : [];
          const sourcePath = photos[0];
          if (!sourcePath) throw new Error("Upload a photo before generating");
          const { data: signed, error: signError } = await supabase.storage
            .from("portrait-uploads")
            .createSignedUrl(sourcePath, 60 * 30);
          if (signError || !signed?.signedUrl) throw new Error("Could not prepare the photo for generation");

          const created = await adapter.createJob({ imageUrl: signed.signedUrl, seedKey: project.id });
          const { currentPlan } = await import("./quota.server");
          await patch({
            provider_job_id: created.providerJobId,
            generation_stage: "sculpting",
            generation_progress: 25,
            generation_plan: await currentPlan(),
          });
          await patchJob(supabase, jobId, { provider_metadata: created.metadata as never });
          return status("sculpting", 25, null);
        }

        if (!project.provider_job_id) throw new Error("Generation state was lost — start the job again");
        const remote = await adapter.getStatus(project.provider_job_id);
        if (remote.state === "failed" || remote.state === "canceled") {
          throw new Error(remote.error ?? "The premium 3D engine failed to generate the model");
        }
        if (remote.state !== "succeeded") {
          const progress = Math.max(25, Math.min(85, 25 + Math.round(remote.progress * 0.6)));
          await patch({ generation_progress: progress, generation_stage: "sculpting" });
          return { ...status("sculpting", progress, null), retryable: false };
        }

        await patch({ generation_stage: "extracting", generation_progress: 88 });
        const outputs = await adapter.fetchOutputs(project.provider_job_id);
        await patchJob(supabase, jobId, { provider_metadata: outputs.metadata as never });
        await patch({ generation_stage: "storing", generation_progress: 92 });
        const stored = await storeModelFromUrl(
          supabase,
          userId,
          project.id,
          project.generation_started_at,
          outputs.glbUrl,
          "meshy",
          patch,
          (fields) => patchJob(supabase, jobId, fields as never),
        );
        const { data: counter } = await supabase
          .from("projects")
          .select("premium_generations")
          .eq("id", project.id)
          .eq("user_id", userId)
          .maybeSingle();
        await patch({ premium_generations: (counter?.premium_generations ?? 0) + 1 });
        return stored;
      }

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
        const stored = await storeModelFromUrl(supabase, userId, project.id, project.generation_started_at, task.modelUrl, "tripo3d", patch);
        // Completed premium runs are billed on the order that follows.
        const { data: counter } = await supabase
          .from("projects")
          .select("premium_generations")
          .eq("id", project.id)
          .eq("user_id", userId)
          .maybeSingle();
        await patch({ premium_generations: (counter?.premium_generations ?? 0) + 1 });
        return stored;
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

      // Separate print-ready copy + server-side printability verdict.
      const printPath = `${userId}/${project.id}-print.glb`;
      const printUpload = await supabase.storage.from("portrait-models").upload(printPath, glbBytes, {
        contentType: "model/gltf-binary",
        upsert: true,
      });
      const { safeInspect } = await import("./printability.server");
      const report = safeInspect(glbBytes);
      await storePreviewCopy(supabase, userId, project.id, glbBytes);

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
        ...(printUpload.error ? {} : { print_ready_url: printPath }),
        ...(report ? { printability: report as never } : {}),
      } as Database["public"]["Tables"]["projects"]["Update"]);
      await patchJob(supabase, jobId, {
        master_model_path: storagePath,
        ...(printUpload.error ? {} : { print_ready_path: printPath }),
        ...(report ? { printability: report as never } : {}),
        stage: "ready",
        status: "ready",
        progress: 100,
        finished_at: new Date().toISOString(),
      });

      return { ...status("ready", 100, null), modelRef: storagePath, status: "ready", done: true, retryable: false };

      }
      throw new Error("Unknown 3D engine");
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

type ProjectPatchForStore = Database["public"]["Tables"]["projects"]["Update"];
type StoreSupabase = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Shared final step for every engine: download the produced GLB, persist it in
 * our private bucket and mark the project ready. The provider's copy is
 * temporary; ours backs paid downloads and the studio preview.
 */
async function storeModelFromUrl(
  supabase: StoreSupabase,
  userId: string,
  projectId: string,
  generationStartedAt: string | null,
  modelUrl: string,
  provider: string,
  patch: (fields: ProjectPatchForStore) => Promise<void>,
  jobPatch?: (fields: Record<string, unknown>) => Promise<void>,
): Promise<JobStatus> {
  const glbResponse = await fetch(modelUrl);
  if (!glbResponse.ok) throw new Error("Could not download the generated model");
  const glbBytes = new Uint8Array(await glbResponse.arrayBuffer());
  if (glbBytes.byteLength < 1024) throw new Error("The 3D engine returned an empty model");

  const storagePath = `${userId}/${projectId}.glb`;
  const upload = await supabase.storage.from("portrait-models").upload(storagePath, glbBytes, {
    contentType: "model/gltf-binary",
    upsert: true,
  });
  if (upload.error) throw new Error(upload.error.message);

  // Print-ready pipeline: a separate copy is kept for print/fulfilment, so a
  // later mesh repair never overwrites the delivered master.
  const printPath = `${userId}/${projectId}-print.glb`;
  const printUpload = await supabase.storage.from("portrait-models").upload(printPath, glbBytes, {
    contentType: "model/gltf-binary",
    upsert: true,
  });
  const { safeInspect } = await import("./printability.server");
  const report = safeInspect(glbBytes);
  await storePreviewCopy(supabase, userId, projectId, glbBytes);

  const startedAt = generationStartedAt ? Date.parse(generationStartedAt) : NaN;
  const seconds = Number.isFinite(startedAt)
    ? Math.max(1, Math.min(1800, Math.round((Date.now() - startedAt) / 1000)))
    : null;
  const { currentPlan } = await import("./quota.server");

  await patch({
    status: "ready",
    model_url: storagePath,
    model_provider: provider,
    generation_stage: "ready",
    generation_progress: 100,
    generation_error: null,
    generation_seconds: seconds,
    generation_plan: await currentPlan(),
    ...(printUpload.error ? {} : { print_ready_url: printPath }),
    ...(report ? { printability: report as unknown as Database["public"]["Tables"]["projects"]["Update"]["printability"] } : {}),
  } as ProjectPatchForStore);
  if (jobPatch) {
    await jobPatch({
      master_model_path: storagePath,
      ...(printUpload.error ? {} : { print_ready_path: printPath }),
      ...(report ? { printability: report } : {}),
      stage: "ready",
      status: "ready",
      progress: 100,
      finished_at: new Date().toISOString(),
    });
  }


  return { ...status("ready", 100, null), modelRef: storagePath, status: "ready", done: true, retryable: false };
}
