import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import ModelStage from "@/components/studio/LazyModelStage";
import { StudioProgress, type JobStage, type StageId, type StageState } from "@/components/studio/StudioProgress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CHECKOUT_KEY,
  PROJECT_KEY,
  SESSION_KEY,
  checkBinding,
  decideResume,
  newSessionId,
  type ResumeCandidate,
} from "@/lib/studio-session";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_EDITS,
  cssFilter,
  renderEdited,
  blobToDataUrl,
  rotate90,
  analyzeImageQuality,
  type EditSettings,
  type QualityReport,
} from "@/lib/image-edits";
import {
  BASES,
  BASE_GEOMETRY,
  DEFAULT_CONFIG,
  FINISHES,
  MATERIALS,
  SIZES,
  DEFAULT_PLACEMENT,
  BASE_SHAPES,
  MIN_WALL_MM,
  quote,
  sanitizeConfig,
  type Placement,
  type StudioConfig,
} from "@/lib/pricing";
import { getModelUrl, removeBackground } from "@/lib/studio.functions";
import { EngineChoice } from "@/components/studio/EngineChoice";
import {
  advanceGeneration,
  findActiveGeneration,
  getAvailableEngines,
  getGenerationStatus,
  startGeneration,
  type EngineInfo,
} from "@/lib/generation.functions";
import { type MeshReport } from "@/lib/mesh-analysis";
import { reportModel } from "@/lib/mesh-worker";
import { repairModelUrl, type RepairResult } from "@/lib/mesh-repair";
import { SlicePreview } from "@/components/studio/SlicePreview";
import { saveRepairedModel } from "@/lib/studio.functions";
import { DEFAULT_SLICE, type SliceSettings, type SliceStats } from "@/lib/slicing";

/** "1 h 20 min" from a minute count, used by the slicing comparison. */
function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
import { clearDraft, loadDraft, saveDraft } from "@/lib/studio-draft";
import { useEditorHistory } from "@/lib/use-editor-history";
import { placementMetrics, formatMm, toMm, snapToGrid, SNAP_STEP_MM } from "@/lib/placement-metrics";
import { uploadWithProgress } from "@/lib/storage-upload";
import { cn } from "@/lib/utils";



const STAGE_LABEL: Record<string, string> = {
  queued: "Waiting for a free GPU slot…",
  preprocessing: "Preparing the portrait…",
  sculpting: "Sculpting the 3D geometry…",
  extracting: "Extracting the mesh and textures…",
  storing: "Saving your model…",
};

/** Project id of a reconstruction that is still running server-side. */
const JOB_KEY = "relievo:job";
/** Manually saved configuration snapshot the customer can roll back to. */
const SAVED_KEY = "relievo:saved-version";

import { Loader2, Upload, RotateCcw, RotateCw, TriangleAlert, Check, Undo2, Redo2, Save, History, Minus, Plus } from "lucide-react";

export const Route = createFileRoute("/editor")({
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    search["project"] ? { project: String(search["project"]) } : {},
  head: () => ({
    meta: [
      { title: "Portrait studio editor — Relievo Studio" },
      {
        name: "description",
        content: "Upload a portrait, retouch it, generate a 3D sculpture and configure size, material and finish.",
      },
      { property: "og:title", content: "Portrait studio editor — Relievo Studio" },
      { property: "og:description", content: "Turn a photo into an approved 3D portrait in minutes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditorPage,
});

type Step = StageId;

function EditorPage() {
  const navigate = useNavigate();
  const { project: projectParam } = Route.useSearch();
  const { user } = useAuth();
  const { t, money, currency } = useI18n();
  const [step, setStep] = useState<Step>("upload");
  const [photo, setPhoto] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditSettings>(DEFAULT_EDITS);
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_CONFIG);
  const [modelRef, setModelRef] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [originalPhoto, setOriginalPhoto] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [readPercent, setReadPercent] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [jobStage, setJobStage] = useState<JobStage | null>(null);
  /** Last stage we toasted about, so each transition is announced exactly once. */
  const toastedStageRef = useRef<JobStage | null>(null);

  /** 3D engine for the next generation run (basic TRELLIS or a premium engine). */
  const [engine, setEngine] = useState<EngineInfo["id"]>("trellis");
  const [engines, setEngines] = useState<EngineInfo[]>([
    { id: "trellis", label: "TRELLIS.2", premium: false, provider: "microsoft-trellis-2", plan: "basic", surchargeCents: 0 },
  ]);

  /** Pre-approval print check of the generated mesh. */
  const [meshReport, setMeshReport] = useState<MeshReport | "checking" | "failed" | null>(null);
  /** Signed URL of the stored model, shared by the print check, repair and slicing. */
  const [modelFileUrl, setModelFileUrl] = useState<string | null>(null);
  /** Result of an optional repair run, kept so before/after stays visible. */
  const [repair, setRepair] = useState<RepairResult | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [sliceSettings, setSliceSettings] = useState<SliceSettings>(DEFAULT_SLICE);
  /** Stored path of the untouched generated mesh, so the choice can be undone. */
  const [originalRef, setOriginalRef] = useState<string | null>(null);
  /** Stored path of the repaired copy, once one exists. */
  const [repairedRef, setRepairedRef] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  /** Latest slicing estimates, and the snapshot taken before the repair ran. */
  const [sliceStats, setSliceStats] = useState<SliceStats | null>(null);
  const [sliceBefore, setSliceBefore] = useState<{ stats: SliceStats; watertight: boolean } | null>(null);
  const sliceStatsRef = useRef<SliceStats | null>(null);
  sliceStatsRef.current = sliceStats;

  // Which engines can be offered — premium ones appear only when configured.
  useEffect(() => {
    if (!user) return;
    void getAvailableEngines({ data: { currency } })
      .then((result) => setEngines(result.engines))
      .catch(() => {});
  }, [user, currency]);


  // When the preview opens, verify the mesh is printable before approval.
  useEffect(() => {
    if (step !== "preview" || !modelRef || modelRef.startsWith("sample://")) return;
    let cancelled = false;
    setMeshReport("checking");
    if (!modelRef.endsWith("-repaired.glb")) setOriginalRef((prev) => prev ?? modelRef);
    void getModelUrl({ data: { storagePath: modelRef } })
      .then(async ({ url }) => {
        if (cancelled || !url) return;
        setModelFileUrl(url);
        // Runs in the mesh worker, so the editor stays interactive meanwhile.
        const report = await reportModel(url);
        if (!cancelled) setMeshReport(report);
      })
      .catch(() => {
        if (!cancelled) setMeshReport("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [step, modelRef]);

  /** Runs the optional repair, stores the fixed GLB and switches the project to it. */
  const runRepair = useCallback(
    async (level: "light" | "full") => {
      const projectId = sessionStorage.getItem("relievo:project");
      if (!modelFileUrl || !projectId || !user) return;
      setRepairing(true);
      try {
        // Snapshot the current estimates so the before/after comparison is real.
        const beforeStats = sliceStatsRef.current;
        const result = await repairModelUrl(modelFileUrl, level);
        const path = `${user.id}/${projectId}-repaired.glb`;
        await uploadWithProgress({ bucket: "portrait-models", path, body: result.blob, contentType: "model/gltf-binary" });
        await saveRepairedModel({ data: { projectId, storagePath: path } });
        if (beforeStats) setSliceBefore({ stats: beforeStats, watertight: result.before.watertight });
        setRepair(result);
        setMeshReport(result.after);
        const { url } = await getModelUrl({ data: { storagePath: path } });
        setModelFileUrl(url);
        setRepairedRef(path);
        setModelRef(path);
        toast.success(t("editor.repair.doneTitle"), { description: t("editor.repair.doneBody") });
      } catch {
        toast.error(t("editor.repair.failed"));
      } finally {
        setRepairing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelFileUrl, user],
  );

  /**
   * Switches the project between the original and the repaired mesh. Exports and
   * paid downloads always read the project's stored file, so this choice is what
   * the customer receives.
   */
  const useMesh = useCallback(
    async (choice: "original" | "repaired") => {
      const projectId = sessionStorage.getItem("relievo:project");
      const path = choice === "original" ? originalRef : repairedRef;
      if (!projectId || !path || path === modelRef) return;
      setSwitching(true);
      try {
        await saveRepairedModel({ data: { projectId, storagePath: path } });
        const { url } = await getModelUrl({ data: { storagePath: path } });
        setModelFileUrl(url);
        setModelRef(path);
        if (repair) setMeshReport(choice === "original" ? repair.before : repair.after);
        toast.success(t(choice === "original" ? "editor.repair.usingOriginal" : "editor.repair.usingRepaired"));
      } catch {
        toast.error(t("editor.repair.switchFailed"));
      } finally {
        setSwitching(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [originalRef, repairedRef, modelRef, repair],
  );




  /** Sets the job stage and shows a one-time toast for every new stage. */
  function trackStage(stage: JobStage) {
    setJobStage(stage);
    if (toastedStageRef.current === stage) return;
    toastedStageRef.current = stage;
    if (stage === "ready") toast.success(t("editor.job.readyTitle"), { description: t("editor.job.readyBody") });
    else if (stage === "failed") toast.error(t("editor.job.failedTitle"), { description: t("editor.job.failedBody") });
    else toast.info(t(`editor.job.stage.${stage}`), { description: t("editor.job.running") });
  }



  const [resumable, setResumable] = useState<Awaited<ReturnType<typeof loadDraft>>>(null);
  const [offline, setOffline] = useState(false);
  const [savedVersion, setSavedVersion] = useState<{ config: StudioConfig; edits: EditSettings; at: number } | null>(null);
  const cancelRef = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = Boolean(busy);

  // Undo/redo over everything the customer authors by hand.
  const snapshot = useMemo(() => ({ config, edits }), [config, edits]);
  const applySnapshot = useCallback((value: { config: StudioConfig; edits: EditSettings }) => {
    setConfig(sanitizeConfig(value.config));
    setEdits(value.edits);
  }, []);
  const history = useEditorHistory(snapshot, applySnapshot);

  // Ctrl/⌘+Z and Ctrl/⌘+Shift+Z step through placement and retouch history.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history]);

  // Interrupted mobile sessions: keep a local copy of the working photo and
  // settings so the customer never has to pick the photo again.
  useEffect(() => {
    if (projectParam) return;
    void loadDraft().then((draft) => {
      if (draft && (draft.photo || draft.config)) setResumable(draft);
    });
  }, [projectParam]);

  // Manually saved configuration version ("restore last saved").
  useEffect(() => {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return;
    try {
      setSavedVersion(JSON.parse(raw));
    } catch {
      localStorage.removeItem(SAVED_KEY);
    }
  }, []);

  function saveVersion() {
    const payload = { config, edits, at: Date.now() };
    localStorage.setItem(SAVED_KEY, JSON.stringify(payload));
    setSavedVersion(payload);
    toast.success(t("editor.version.saved"));
  }

  function restoreVersion() {
    if (!savedVersion) return;
    setConfig(sanitizeConfig(savedVersion.config));
    if (savedVersion.edits) setEdits(savedVersion.edits);
    toast.success(t("editor.version.restored"));
  }


  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);


  const placement = config.placement ?? DEFAULT_PLACEMENT;
  const setPlacement = (next: Partial<Placement>) =>
    setConfig((current) => ({ ...current, placement: { ...(current.placement ?? DEFAULT_PLACEMENT), ...next } }));
  const heightMm = SIZES.find((size) => size.id === config.sizeId)?.heightMm ?? null;

  const priced = useMemo(() => quote(config, currency), [config, currency]);
  /** Price difference a configurator option would make, shown next to each choice. */
  const deltaFor = (patch: Partial<StudioConfig>) => quote({ ...config, ...patch }, currency).totalCents - priced.totalCents;


  // Every studio entry opens a fresh session: no project is carried over from
  // an earlier visit, so checkout can never bind to an older project.
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, newSessionId());
    sessionStorage.removeItem(CHECKOUT_KEY);
    if (!projectParam) sessionStorage.removeItem(PROJECT_KEY);
  }, [projectParam]);

  // Reopening a saved project from "My studio projects".
  useEffect(() => {
    if (!projectParam || !user) return;
    let cancelled = false;
    void supabase
      .from("projects")
      .select("id, config, model_url, status")
      .eq("id", projectParam)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        sessionStorage.setItem("relievo:project", data.id);
        if (data.config && typeof data.config === "object") {
          setConfig(sanitizeConfig(data.config as unknown as StudioConfig));
        }
        if (data.model_url) {
          setModelRef(data.model_url);
          setStep("preview");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectParam, user]);

  const stageStates = useMemo<Record<StageId, StageState>>(() => {
    const order: StageId[] = ["upload", "retouch", "preview", "configure"];
    const activeIndex = order.indexOf(step);
    const map = {} as Record<StageId, StageState>;
    order.forEach((stage, index) => {
      if (failure && stage === (modelRef ? step : "preview")) { map[stage] = "error"; return; }
      if (index < activeIndex) { map[stage] = "done"; return; }
      if (index === activeIndex) {
        map[stage] = busy ? "active" : stage === "configure" && modelRef ? "done" : "active";
        return;
      }
      map[stage] = "pending";
    });
    if (photo) map.upload = "done";
    if (modelRef && step !== "preview") map.preview = "done";
    return map;
  }, [step, busy, photo, modelRef, failure]);

  // Autosave the working configuration so a closed tab loses nothing.
  useEffect(() => {
    if (!user) return;
    const projectId = sessionStorage.getItem("relievo:project");
    if (!projectId) return;
    const timer = setTimeout(() => {
      void supabase
        .from("projects")
        .update({ config: config as unknown as Json, edit_settings: edits as unknown as Json })
        .eq("id", projectId)
        .then(() => setSavedAt(Date.now()));
    }, 900);
    return () => clearTimeout(timer);
  }, [config, edits, user]);

  // Local mirror of the session: survives a closed tab, lost connection or an
  // app switch on the phone.
  useEffect(() => {
    // Also mirrored when there is no photo yet, so a configuration built
    // before uploading (size, material, plinth) survives a return visit.
    const timer = setTimeout(() => {
      void saveDraft({
        photo,
        originalPhoto,
        edits,
        config,
        step,
        projectId: sessionStorage.getItem("relievo:project"),
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [photo, originalPhoto, edits, config, step]);

  function restoreDraft() {
    if (!resumable) return;
    setPhoto(resumable.photo);
    setOriginalPhoto(resumable.originalPhoto ?? resumable.photo);
    if (resumable.edits) setEdits(resumable.edits as EditSettings);
    if (resumable.config) setConfig(sanitizeConfig(resumable.config as StudioConfig));
    if (resumable.projectId) sessionStorage.setItem("relievo:project", resumable.projectId);
    if (resumable.photo) {
      setStep(resumable.step === "configure" || resumable.step === "preview" ? "retouch" : (resumable.step as Step));
    }
    setResumable(null);

    if (resumable.photo) void analyzeImageQuality(resumable.photo).then(setQuality).catch(() => setQuality(null));
  }

  function discardDraft() {
    setResumable(null);
    void clearDraft();
  }



  async function rotatePhoto(direction: 1 | -1) {
    if (!photo) return;
    try {
      const next = await rotate90(photo, direction);
      setPhoto(next);
      void analyzeImageQuality(next).then(setQuality).catch(() => setQuality(null));
    } catch {
      toast.error(t("editor.toast.imageOnly"));
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error(t("editor.toast.imageOnly")); return; }
    const reader = new FileReader();
    setReadPercent(0);
    reader.onprogress = (event) => {
      if (event.lengthComputable) setReadPercent(Math.round((event.loaded / event.total) * 100));
    };
    reader.onerror = () => {
      setReadPercent(null);
      toast.error(t("editor.toast.imageOnly"));
    };
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setReadPercent(null);
      setPhoto(dataUrl);
      setOriginalPhoto(dataUrl);
      setShowBefore(false);
      void analyzeImageQuality(dataUrl).then(setQuality).catch(() => setQuality(null));
      setEdits(DEFAULT_EDITS);
      setModelRef(null);
      setFailure(null);
      setStep("retouch");
    };
    reader.readAsDataURL(file);
  }


  async function clearBackground() {
    if (!photo) return;
    setFailure(null);
    setBusy(t("editor.busy.background"));
    setProgress(35);
    try {
      const baked = await renderEdited(photo, edits);
      const dataUrl = await blobToDataUrl(baked);
      const result = await removeBackground({ data: { imageDataUrl: dataUrl } });
      setPhoto(result.imageDataUrl);
      setEdits({ ...DEFAULT_EDITS, removedBackground: true });
      toast.success(t("editor.toast.bgDone"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("editor.toast.bgFail");
      setFailure(message);
      toast.error(message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function generate() {
    if (!photo) return;
    if (!user) {
      void navigate({ to: "/auth", search: { redirect: "/editor" } });
      return;
    }
    setFailure(null);
    cancelRef.current = false;
    setStartedAt(Date.now());
    toastedStageRef.current = null;
    trackStage("queued");
    setBusy(t("editor.busy.upload"));
    setProgress(20);

    try {
      const baked = await renderEdited(photo, edits);
      // Reuse the same storage slot across retries so a dropped mobile
      // connection resumes the upload instead of starting a new object.
      const pendingKey = "relievo:upload-path";
      const path = sessionStorage.getItem(pendingKey) ?? `${user.id}/${crypto.randomUUID()}.jpg`;
      sessionStorage.setItem(pendingKey, path);
      await uploadWithProgress({
        bucket: "portrait-uploads",
        path,
        body: baked,
        contentType: "image/jpeg",
        onProgress: (percent) => {
          setProgress(20 + Math.round(percent * 0.2));
          setBusy(`${t("editor.busy.upload")} ${percent}%`);
        },
      });
      sessionStorage.removeItem(pendingKey);


      setProgress(45);
      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          title: "Portrait sculpture",
          source_photos: [path],
          edit_settings: edits as unknown as Json,
          config: config as unknown as Json,
          status: "generating",
        })
        .select("id")
        .single();
      if (error || !project) throw new Error(error?.message ?? "Could not save the project");

      setBusy(t("editor.busy.generate"));
      setProgress(50);

      // TRELLIS runs for minutes. The job is persisted server-side and driven
      // one step at a time, so no single request has to stay open that long.
      sessionStorage.setItem("relievo:project", project.id);
      await startGeneration({ data: { projectId: project.id, engine } });
      await driveJob(project.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("editor.toast.genFail");
      setFailure(message);
      trackStage("failed");
      toast.error(message);
    } finally {
      setBusy(null);
      setProgress(null);
      setStartedAt(null);

    }
  }

  /**
   * Drives a persisted generation job to completion. The project id is kept in
   * localStorage, so reloading the page picks the same job back up instead of
   * losing the reconstruction.
   */
  async function driveJob(projectId: string) {
    localStorage.setItem(JOB_KEY, projectId);
    // Providers differ: some calls block for ~50s, others answer instantly.
    // Bound the wait by wall-clock time and pace the quick ones, so a fast
    // non-blocking status check cannot exhaust the loop within seconds.
    const deadline = Date.now() + 40 * 60 * 1000;
    let job = await getGenerationStatus({ data: { projectId } });
    while (!job.done && Date.now() < deadline) {
      if (cancelRef.current) throw new Error(t("editor.cancelled"));
      const tick = Date.now();
      job = await advanceGeneration({ data: { projectId } });
      trackStage(job.stage as JobStage);
      setProgress(job.progress > 0 ? job.progress : null);
      if (job.stage !== "ready") setBusy(STAGE_LABEL[job.stage] ?? t("editor.busy.generate"));
      // Extraction is done — move the customer to the preview step right away
      // so the model appears the moment it finishes saving.
      if (job.stage === "storing" || job.stage === "ready") setStep("preview");
      if (job.error && !job.retryable) break;
      if (job.done) break;
      const spent = Date.now() - tick;
      if (spent < 4000) {
        await new Promise((resolve) => setTimeout(resolve, 4000 - spent));
      }
    }

    if (job.stage !== "ready" || !job.modelRef) {
      if (job.stage === "failed") localStorage.removeItem(JOB_KEY);
      throw new Error(job.error ?? t("editor.toast.genFail"));
    }

    localStorage.removeItem(JOB_KEY);
    trackStage("ready");
    setBusy(t("editor.busy.finalize"));
    setProgress(100);
    setModelRef(job.modelRef);
    sessionStorage.setItem("relievo:project", projectId);
    setStep("preview");
  }

  // A reconstruction found on entry (localStorage shortcut or the server's
  // latest running job) is only offered — the customer confirms before the
  // studio switches to it. Finished models are never restored here.
  const [resumeOffer, setResumeOffer] = useState<
    { projectId: string; stage: string; progress: number } | null
  >(null);

  useEffect(() => {
    if (!user || projectParam) return;
    if (busyRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const pending = localStorage.getItem(JOB_KEY);
        let candidate: (ResumeCandidate & { progress: number; error: string | null; engine?: string }) | null = null;
        if (pending) {
          const job = await getGenerationStatus({ data: { projectId: pending } }).catch(() => null);
          if (job) candidate = { projectId: pending, stage: job.stage, done: job.done, modelRef: job.modelRef, progress: job.progress, error: job.error };
        }
        if (!candidate || decideResume(candidate) !== "prompt") {
          const { job: active } = await findActiveGeneration();
          if (active) {
            candidate = { projectId: active.projectId, stage: active.stage, done: active.done, modelRef: active.modelRef, progress: active.progress, error: active.error, engine: active.engine };
          }
        }
        if (cancelled) return;
        const decision = decideResume(candidate);
        if (decision !== "prompt" || !candidate) {
          localStorage.removeItem(JOB_KEY);
          return;
        }
        if (candidate.engine === "trellis" || candidate.engine === "meshy" || candidate.engine === "tripo") {
          setEngine(candidate.engine);
        }
        setResumeOffer({ projectId: candidate.projectId, stage: candidate.stage, progress: candidate.progress });
      } catch {
        /* nothing to offer */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function declineResume() {
    // The job keeps running server-side and stays under "My projects".
    localStorage.removeItem(JOB_KEY);
    setResumeOffer(null);
  }

  async function acceptResume() {
    const offer = resumeOffer;
    setResumeOffer(null);
    if (!offer) return;
    sessionStorage.setItem(PROJECT_KEY, offer.projectId);
    setModelRef(null);
    setFailure(null);
    cancelRef.current = false;
    setStartedAt(Date.now());
    trackStage(offer.stage as JobStage);
    setProgress(offer.progress > 0 ? offer.progress : null);
    setBusy(STAGE_LABEL[offer.stage] ?? t("editor.busy.generate"));
    toast.info(t("editor.job.resumed"));
    try {
      await driveJob(offer.projectId);
    } catch (error) {
      trackStage("failed");
      setFailure(error instanceof Error ? error.message : t("editor.toast.genFail"));
    } finally {
      setBusy(null);
      setProgress(null);
      setStartedAt(null);
    }
  }

  async function goToCheckout() {
    const projectId = sessionStorage.getItem(PROJECT_KEY);
    const sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!projectId || !modelRef) { toast.error(t("editor.toast.generateFirst")); return; }
    // Confirm the model on screen is the one saved on this session's project.
    const { data: project } = await supabase
      .from("projects")
      .select("id, model_url")
      .eq("id", projectId)
      .maybeSingle();
    const problem = checkBinding({
      binding: sessionId ? { sessionId, projectId, modelRef } : null,
      sessionId,
      projectId: project?.id ?? null,
      projectModelUrl: project?.model_url ?? null,
    });
    if (problem) {
      toast.error(t("editor.checkout.mismatch"));
      return;
    }
    sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({ sessionId, projectId, modelRef }));
    sessionStorage.setItem("relievo:config", JSON.stringify(config));
    void navigate({ to: "/checkout" });
  }

  // Shared by the approval step and the configurator so the sculpture can be
  // fine-tuned right up to checkout.
  const baseGeometry = BASE_GEOMETRY[config.baseId] ?? BASE_GEOMETRY["walnut"]!;
  const hasBase = config.baseId !== "none" && baseGeometry.height > 0;
  const metrics = placementMetrics(placement, config.baseId, heightMm);
  const offCentre = metrics.hasBase && metrics.clearanceMm < 0;
  const floating = metrics.hasBase && Math.abs(metrics.floatMm) > 1;
  /** Millimetre read-out shown next to a scene-unit slider. */
  const mmHint = (units: number) => (metrics.measured ? formatMm(toMm(units, heightMm), true) : undefined);
  /** Converts how far a typed slider value is out of range into millimetres. */
  const mmExcess = (sliderUnits: number) => formatMm(toMm(sliderUnits / 100, heightMm));

  // Rows holding an unconfirmed out-of-range value; any of them flags the 3D scene.
  const pendingRowsRef = useRef(new Set<string>());
  const [pendingInvalid, setPendingInvalid] = useState(false);
  const reportPending = useCallback((key: string, pending: boolean) => {
    const rows = pendingRowsRef.current;
    const before = rows.size;
    if (pending) rows.add(key);
    else rows.delete(key);
    if (rows.size !== before) setPendingInvalid(rows.size > 0);
  }, []);

  const placementPanel = (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t("editor.placement")}</p>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            aria-label={t("editor.undo")}
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <Undo2 className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            aria-label={t("editor.redo")}
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <Redo2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("editor.placement.dragHint")}</p>
      <p className="text-xs text-muted-foreground">{t("editor.placement.stepHint")}</p>

      {/* Live measurement of the sculpture against the plinth edge. */}
      {metrics.hasBase && metrics.measured ? (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs tabular-nums ${
            metrics.level === "error"
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : metrics.level === "warn"
                ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          <span>
            {metrics.clearanceMm < 0
              ? `${t("editor.placement.measureOverhang")} ${formatMm(Math.abs(metrics.clearanceMm))}`
              : `${t("editor.placement.measureEdge")} ${formatMm(metrics.clearanceMm)}`}
          </span>
          <span>
            {t("editor.placement.measureFloat")} {formatMm(metrics.floatMm, true)}
          </span>
        </div>
      ) : null}

      <SliderRow label={t("editor.placement.yaw")} unit="°" value={placement.yaw} min={-180} max={180} onPending={(p) => reportPending("yaw", p)} onChange={(v) => setPlacement({ yaw: v })} />
      <SliderRow label={t("editor.placement.tilt")} unit="°" value={placement.tilt} min={-30} max={30} onPending={(p) => reportPending("tilt", p)} onChange={(v) => setPlacement({ tilt: v })} />

      {/* Explicit X / Y / Z movement sliders with pointer-only step buttons. */}
      <div className="space-y-4 rounded-lg border border-dashed border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("editor.placement.axisGroup")}
        </p>
        <SliderRow
          label={t("editor.placement.axisX")}
          hint={mmHint(placement.offsetX ?? 0)}
          value={(placement.offsetX ?? 0) * 100}
          min={-60}
          max={60}
          formatExcess={metrics.measured ? mmExcess : undefined}
          onPending={(p) => reportPending("axisX", p)}
          onChange={(v) => setPlacement({ offsetX: v / 100 })}
        />
        <SliderRow
          label={t("editor.placement.axisY")}
          hint={mmHint(placement.lift)}
          value={placement.lift * 100}
          min={-50}
          max={50}
          formatExcess={metrics.measured ? mmExcess : undefined}
          onPending={(p) => reportPending("axisY", p)}
          onChange={(v) => setPlacement({ lift: v / 100 })}
        />
        <SliderRow
          label={t("editor.placement.axisZ")}
          hint={mmHint(placement.offsetZ ?? 0)}
          value={(placement.offsetZ ?? 0) * 100}
          min={-60}
          max={60}
          formatExcess={metrics.measured ? mmExcess : undefined}
          onPending={(p) => reportPending("axisZ", p)}
          onChange={(v) => setPlacement({ offsetZ: v / 100 })}
        />
      </div>

      <SliderRow label={t("editor.placement.scale")} unit="%" value={placement.scale * 100} min={60} max={160} onPending={(p) => reportPending("scale", p)} onChange={(v) => setPlacement({ scale: v / 100 })} />

      {hasBase ? (
        <div className="space-y-4 rounded-lg border border-dashed border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("editor.placement.baseGroup")}
          </p>
          <SliderRow
            label={t("editor.placement.baseOffsetX")}
            hint={mmHint(placement.baseOffsetX ?? 0)}
            value={(placement.baseOffsetX ?? 0) * 100}
            min={-80}
            max={80}
            formatExcess={metrics.measured ? mmExcess : undefined}
            onPending={(p) => reportPending("baseX", p)}
            onChange={(v) => setPlacement({ baseOffsetX: v / 100 })}
          />
          <SliderRow
            label={t("editor.placement.baseOffsetZ")}
            hint={mmHint(placement.baseOffsetZ ?? 0)}
            value={(placement.baseOffsetZ ?? 0) * 100}
            min={-80}
            max={80}
            formatExcess={metrics.measured ? mmExcess : undefined}
            onPending={(p) => reportPending("baseZ", p)}
            onChange={(v) => setPlacement({ baseOffsetZ: v / 100 })}
          />
          <SliderRow
            label={t("editor.placement.baseYaw")}
            unit="°"
            value={placement.baseYaw ?? 0}
            min={-180}
            max={180}
            onPending={(p) => reportPending("baseYaw", p)}
            onChange={(v) => setPlacement({ baseYaw: v })}
          />
        </div>
      ) : null}

      {offCentre || floating ? (
        <p
          className={`flex items-start gap-2 rounded-md p-2 text-xs ${
            metrics.level === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {offCentre ? t("editor.placement.warnOffBase") : t("editor.placement.warnFloating")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setPlacement({ yaw: 0, tilt: 0, lift: 0 })}>
          {t("editor.placement.center")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPlacement({ tilt: 0 })}>
          {t("editor.placement.upright")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPlacement({ yaw: 0 })}>
          {t("editor.placement.faceFront")}
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setPlacement({
              offsetX: placement.baseOffsetX ?? 0,
              offsetZ: placement.baseOffsetZ ?? 0,
              lift: 0,
            })
          }
        >
          {t("editor.placement.snap")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setPlacement({
              offsetX: snapToGrid(placement.offsetX ?? 0, SNAP_STEP_MM, heightMm),
              offsetZ: snapToGrid(placement.offsetZ ?? 0, SNAP_STEP_MM, heightMm),
              lift: snapToGrid(placement.lift, SNAP_STEP_MM, heightMm),
              baseOffsetX: snapToGrid(placement.baseOffsetX ?? 0, SNAP_STEP_MM, heightMm),
              baseOffsetZ: snapToGrid(placement.baseOffsetZ ?? 0, SNAP_STEP_MM, heightMm),
            })
          }
        >
          {t("editor.placement.snapGrid")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPlacement({ baseOffsetX: 0, baseOffsetZ: 0, baseYaw: 0 })}
          disabled={!hasBase}
        >
          {t("editor.placement.baseReset")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPlacement(DEFAULT_PLACEMENT)}>
          {t("editor.placement.reset")}
        </Button>
      </div>
    </div>
  );



  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <AlertDialog open={!!resumeOffer} onOpenChange={(open) => { if (!open) declineResume(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("editor.resume.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("editor.resume.body", { progress: String(resumeOffer?.progress ?? 0) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={declineResume}>{t("editor.resume.new")}</AlertDialogCancel>
            <AlertDialogAction onClick={acceptResume}>{t("editor.resume.continue")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 sm:px-5 sm:py-10 lg:pb-10">
        <h1 className="font-display text-2xl sm:text-3xl">{t("editor.title")}</h1>

        {resumable ? (
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-primary/50 bg-primary/10 p-3 sm:flex sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("editor.resume.title")}</p>
              <p className="truncate text-xs text-muted-foreground">{t("editor.resume.body")}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={restoreDraft}>
                {t("editor.resume.action")}
              </Button>
              <Button size="sm" variant="ghost" onClick={discardDraft}>
                {t("editor.resume.discard")}
              </Button>
            </div>
          </div>
        ) : null}

        {offline ? (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {t("editor.offline")}
          </p>
        ) : null}

        <div className="mt-5">
          <StudioProgress
            states={stageStates}
            message={busy}
            progress={progress}
            error={failure}
            startedAt={startedAt}
            jobStage={jobStage}
            onRetry={() => void generate()}
            onCancel={() => {
              cancelRef.current = true;
            }}
            onPreview={() => setStep("preview")}
          />

          {step !== "upload" ? (
            <div className="scroll-x mt-3 flex flex-nowrap items-center gap-2 pb-1 sm:flex-wrap [&>button]:shrink-0">
              <Button size="sm" variant="outline" disabled={!history.canUndo} onClick={history.undo}>
                <Undo2 className="mr-1.5 size-3.5" />
                {t("editor.undo")}
              </Button>
              <Button size="sm" variant="outline" disabled={!history.canRedo} onClick={history.redo}>
                <Redo2 className="mr-1.5 size-3.5" />
                {t("editor.redo")}
              </Button>
              <Button size="sm" variant="outline" onClick={saveVersion}>
                <Save className="mr-1.5 size-3.5" />
                {t("editor.version.save")}
              </Button>
              <Button size="sm" variant="ghost" disabled={!savedVersion} onClick={restoreVersion}>
                <History className="mr-1.5 size-3.5" />
                {t("editor.version.restore")}
              </Button>
              {savedVersion ? (
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {t("editor.version.savedAt")} {new Date(savedVersion.at).toLocaleTimeString()}
                </span>
              ) : null}
            </div>
          ) : null}

        </div>


        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card className="min-h-[320px] sm:min-h-[460px]">
            <CardContent className="h-full p-3 sm:p-4">
              {step === "preview" || step === "configure" ? (
                modelRef ? (
                  <div className="h-[340px] sm:h-[460px]">
                    <ModelStage
                      modelRef={modelRef}
                      materialId={config.materialId}
                      finishId={config.finishId}
                      showBase={config.baseId !== "none"}
                      baseId={config.baseId}
                      placement={placement}
                      heightMm={heightMm}
                      onPlacementChange={setPlacement}
                      onUndo={history.undo}
                      onRedo={history.redo}
                      canUndo={history.canUndo}
                      canRedo={history.canRedo}
                      pendingInvalid={pendingInvalid}
                      canDownload
                    />
                  </div>
                ) : null
              ) : photo ? (
                <div className="relative flex h-[340px] items-center justify-center overflow-hidden rounded-lg bg-stone-deep sm:h-[460px]">

                  {originalPhoto && originalPhoto !== photo ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute left-3 top-3 z-10"
                      onMouseDown={() => setShowBefore(true)}
                      onMouseUp={() => setShowBefore(false)}
                      onMouseLeave={() => setShowBefore(false)}
                      onTouchStart={() => setShowBefore(true)}
                      onTouchEnd={() => setShowBefore(false)}
                    >
                      {showBefore ? t("editor.before") : t("editor.after")}
                    </Button>
                  ) : null}
                  <img
                    src={showBefore && originalPhoto ? originalPhoto : photo}
                    alt="Uploaded portrait preview"
                    className="max-h-full max-w-full object-contain"
                    style={{
                      filter: showBefore ? "none" : cssFilter(edits),
                      transform: `translate(${edits.offsetX}%, ${edits.offsetY}%) rotate(${edits.rotation}deg) scale(${edits.zoom})`,
                    }}
                  />
                </div>
              ) : (
                <label
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    onFile(event.dataTransfer.files?.[0]);
                  }}
                  className={`flex h-[300px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center text-muted-foreground transition-all duration-200 sm:h-[460px] ${
                    dragOver
                      ? "scale-[1.01] border-primary bg-primary/10"
                      : "border-border bg-stone-deep/40 hover:border-primary/50 hover:bg-primary/5"
                  }`}
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Upload className="size-5" />
                  </span>
                  <span className="text-sm font-medium text-foreground">{t("editor.uploadPrompt")}</span>
                  <span className="hidden text-xs sm:block">{t("editor.dropHint")}</span>
                  <span className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground sm:hidden">
                    {t("editor.choosePhoto")}
                  </span>
                  {readPercent !== null ? (
                    <span className="text-xs tabular-nums">{t("editor.reading")} {readPercent}%</span>
                  ) : null}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => onFile(event.target.files?.[0])}
                  />
                </label>


              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5 p-5">
              {step === "retouch" ? (
                <>
                  <h2 className="font-display text-xl">{t("editor.retouchHeading")}</h2>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void rotatePhoto(-1)}>
                      <RotateCcw className="mr-1.5 size-3.5" />
                      {t("editor.rotateLeft")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void rotatePhoto(1)}>
                      <RotateCw className="mr-1.5 size-3.5" />
                      {t("editor.rotateRight")}
                    </Button>
                  </div>
                  {quality ? (
                    quality.warnings.length > 0 ? (
                      <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
                        <p className="flex items-center gap-2 font-medium">
                          <TriangleAlert className="size-4 text-destructive" aria-hidden />
                          {t("editor.quality.title")}
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                          {quality.warnings.map((warning) => (
                            <li key={warning}>{t(`editor.quality.${warning}`)}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Check className="size-3.5" aria-hidden />
                        {t("editor.quality.ok")}
                      </p>
                    )
                  ) : null}
                  <SliderRow label={t("editor.zoom")} value={edits.zoom * 100} min={80} max={220} onChange={(v) => setEdits({ ...edits, zoom: v / 100 })} />
                  <SliderRow label={t("editor.straighten")} value={edits.rotation} min={-20} max={20} onChange={(v) => setEdits({ ...edits, rotation: v })} />
                  <SliderRow label={t("editor.brightness")} value={edits.brightness} min={60} max={150} onChange={(v) => setEdits({ ...edits, brightness: v })} />
                  <SliderRow label={t("editor.contrast")} value={edits.contrast} min={60} max={160} onChange={(v) => setEdits({ ...edits, contrast: v })} />
                  <SliderRow label={t("editor.warmth")} value={edits.warmth} min={-40} max={60} onChange={(v) => setEdits({ ...edits, warmth: v })} />
                  <SliderRow label={t("editor.smoothing")} value={edits.smoothing} min={0} max={100} onChange={(v) => setEdits({ ...edits, smoothing: v })} />
                  <Button variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void clearBackground()}>
                    {t("editor.clearBackground")}
                  </Button>
                  <EngineChoice engines={engines} value={engine} onChange={setEngine} disabled={Boolean(busy)} />
                  <Button className="w-full" disabled={Boolean(busy)} onClick={() => void generate()}>
                    {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    {busy ?? t("editor.generate")}
                  </Button>
                  {busy ? (
                    <Button variant="ghost" className="w-full" onClick={() => (cancelRef.current = true)}>
                      {t("editor.cancel")}
                    </Button>
                  ) : null}
                  {failure && !busy ? (
                    <Button variant="outline" className="w-full" onClick={() => void generate()}>
                      {t("editor.retry")}
                    </Button>
                  ) : null}
                </>
              ) : null}

              {step === "upload" ? (
                <>
                  <h2 className="font-display text-xl">{t("editor.uploadHeading")}</h2>
                  <p className="text-sm text-muted-foreground">{t("editor.uploadHint")}</p>
                  <EngineChoice engines={engines} value={engine} onChange={setEngine} />
                </>
              ) : null}


              {step === "preview" ? (
                <>
                  <h2 className="font-display text-xl">{t("editor.previewHeading")}</h2>
                  <p className="text-sm text-muted-foreground">{t("editor.previewBody")}</p>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-semibold">{t("editor.downloads")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("editor.downloadsBody")}</p>
                  </div>
                  {meshReport === "checking" ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      {t("editor.mesh.checking")}
                    </p>
                  ) : meshReport === "failed" ? null : meshReport ? (
                    <div
                      className={cn(
                        "rounded-lg border p-4",
                        meshReport.watertight ? "border-border" : "border-amber-500/60 bg-amber-500/5",
                      )}
                    >
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {meshReport.watertight ? (
                          <Check className="size-4 text-emerald-600" aria-hidden />
                        ) : (
                          <TriangleAlert className="size-4 text-amber-600" aria-hidden />
                        )}
                        {t("editor.mesh.title")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("editor.mesh.triangles", { count: meshReport.triangles.toLocaleString() })}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-xs",
                          meshReport.watertight ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {meshReport.watertight
                          ? t("editor.mesh.watertight")
                          : t("editor.mesh.holes", { count: meshReport.openEdges.toLocaleString() })}
                      </p>
                    </div>
                  ) : null}
                  {modelFileUrl ? (
                    <div className="space-y-3 rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold">{t("editor.repair.title")}</p>
                      <p className="text-xs text-muted-foreground">{t("editor.repair.body")}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={repairing} onClick={() => void runRepair("light")}>
                          {repairing ? t("editor.repair.working") : t("editor.repair.light")}
                        </Button>
                        <Button size="sm" variant="outline" disabled={repairing} onClick={() => void runRepair("full")}>
                          {t("editor.repair.full")}
                        </Button>
                      </div>
                      {repair ? (
                        <div className="space-y-1 rounded-md bg-muted/60 p-3 text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.repair.triangles")}</span>
                            <span>
                              {repair.before.triangles.toLocaleString()} → {repair.after.triangles.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.repair.openEdges")}</span>
                            <span>
                              {repair.before.openEdges.toLocaleString()} → {repair.after.openEdges.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.repair.watertightRow")}</span>
                            <span>
                              {t(repair.before.watertight ? "editor.repair.yes" : "editor.repair.no")} →{" "}
                              <strong>{t(repair.after.watertight ? "editor.repair.yes" : "editor.repair.no")}</strong>
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.repair.filled")}</span>
                            <span>{repair.filledHoles.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.repair.removed")}</span>
                            <span>{repair.removedTriangles.toLocaleString()}</span>
                          </div>
                        </div>
                      ) : null}

                      {repairedRef && originalRef ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium">{t("editor.repair.useTitle")}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              size="sm"
                              variant={modelRef === originalRef ? "default" : "outline"}
                              disabled={switching}
                              onClick={() => void useMesh("original")}
                            >
                              {t("editor.repair.useOriginal")}
                            </Button>
                            <Button
                              size="sm"
                              variant={modelRef === repairedRef ? "default" : "outline"}
                              disabled={switching}
                              onClick={() => void useMesh("repaired")}
                            >
                              {t("editor.repair.useRepaired")}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t(modelRef === originalRef ? "editor.repair.exportOriginal" : "editor.repair.exportRepaired")}
                          </p>
                        </div>
                      ) : null}

                      {sliceBefore && sliceStats && repair ? (
                        <div className="space-y-1 rounded-md border border-border p-3 text-xs">
                          <p className="font-medium">{t("editor.slice.compareTitle")}</p>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.slice.layers")}</span>
                            <span>
                              {sliceBefore.stats.layerCount.toLocaleString()} → {sliceStats.layerCount.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.repair.watertightRow")}</span>
                            <span>
                              {t(sliceBefore.watertight ? "editor.repair.yes" : "editor.repair.no")} →{" "}
                              <strong>{t(repair.after.watertight ? "editor.repair.yes" : "editor.repair.no")}</strong>
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.slice.time")}</span>
                            <span>
                              {formatMinutes(sliceBefore.stats.printMinutes)} → {formatMinutes(sliceStats.printMinutes)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{t("editor.slice.material")}</span>
                            <span>
                              {sliceBefore.stats.materialGrams.toFixed(1)} g → {sliceStats.materialGrams.toFixed(1)} g
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {modelFileUrl ? (
                    <SlicePreview
                      modelUrl={modelFileUrl}
                      heightMm={heightMm ?? 180}
                      settings={sliceSettings}
                      onSettingsChange={setSliceSettings}
                      onStats={setSliceStats}
                    />
                  ) : null}


                  <Button variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void generate()}>
                    {t("editor.regenerate")}
                  </Button>

                  {placementPanel}

                  <Button className="w-full" onClick={() => setStep("configure")}>
                    {t("editor.approve")}
                  </Button>
                </>
              ) : null}

              {step === "configure" ? (
                <>
                  <h2 className="font-display text-xl">{t("editor.configureHeading")}</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {(["print", "digital"] as const).map((delivery) => (
                      <Button
                        key={delivery}
                        variant={config.delivery === delivery ? "default" : "outline"}
                        onClick={() => setConfig({ ...config, delivery })}
                      >
                        {delivery === "print" ? t("editor.printed") : t("editor.digital")}
                      </Button>
                    ))}
                  </div>

                  {config.delivery === "print" ? (
                    <>
                      <ChoiceRow
                        label={t("editor.size")}
                        options={SIZES.map((s) => ({
                          id: s.id,
                          label: `${s.label} · ${s.heightMm}mm`,
                          delta: deltaFor({ sizeId: s.id }),
                        }))}
                        value={config.sizeId}
                        onChange={(id) => setConfig({ ...config, sizeId: id as StudioConfig["sizeId"] })}
                      />
                      <ChoiceRow
                        label={t("editor.material")}
                        options={MATERIALS.map((m) => ({
                          id: m.id,
                          label: m.label,
                          delta: deltaFor({ materialId: m.id }),
                        }))}
                        value={config.materialId}
                        onChange={(id) => setConfig({ ...config, materialId: id as StudioConfig["materialId"] })}
                      />
                      <ChoiceRow
                        label={t("editor.finish")}
                        options={FINISHES.map((f) => ({
                          id: f.id,
                          label: f.label,
                          delta: deltaFor({ finishId: f.id }),
                        }))}
                        value={config.finishId}
                        onChange={(id) => setConfig({ ...config, finishId: id as StudioConfig["finishId"] })}
                      />
                      <ChoiceRow
                        label={t("editor.plinth")}
                        options={BASES.map((b) => ({
                          id: b.id,
                          label: b.label,
                          delta: deltaFor({ baseId: b.id }),
                        }))}
                        value={config.baseId}
                        onChange={(id) => setConfig({ ...config, baseId: id as StudioConfig["baseId"] })}
                      />

                      {config.baseId !== "none" ? (
                        <>
                          <ChoiceRow
                            label={t("editor.baseShape")}
                            options={BASE_SHAPES.map((shape) => ({
                              id: shape,
                              label: t(`editor.baseShape.${shape}`),
                              delta: 0,
                            }))}
                            value={config.base.shape}
                            onChange={(shape) =>
                              setConfig({ ...config, base: { ...config.base, shape: shape as StudioConfig["base"]["shape"] } })
                            }
                          />
                          <SliderRow
                            label={t("editor.baseWidth")}
                            unit=" mm"
                            value={config.base.widthMm}
                            min={40}
                            max={220}
                            onChange={(widthMm) => setConfig({ ...config, base: { ...config.base, widthMm } })}
                          />
                          <SliderRow
                            label={t("editor.baseHeight")}
                            unit=" mm"
                            value={config.base.heightMm}
                            min={6}
                            max={60}
                            onChange={(heightMm) => setConfig({ ...config, base: { ...config.base, heightMm } })}
                          />
                        </>
                      ) : null}

                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Label htmlFor="hollow">{t("editor.hollow")}</Label>
                          <p className="text-[11px] text-muted-foreground">{t("editor.hollowHint")}</p>
                        </div>
                        <Switch
                          id="hollow"
                          checked={config.hollow.enabled}
                          onCheckedChange={(enabled) => setConfig({ ...config, hollow: { ...config.hollow, enabled } })}
                        />
                      </div>
                      {config.hollow.enabled ? (
                        <>
                          <SliderRow
                            label={t("editor.hollowWall")}
                            unit=" mm"
                            value={config.hollow.wallMm}
                            min={Math.ceil(MIN_WALL_MM)}
                            max={8}
                            onChange={(wallMm) => setConfig({ ...config, hollow: { ...config.hollow, wallMm } })}
                          />
                          <div className="flex items-center justify-between gap-3">
                            <Label htmlFor="drain">{t("editor.drainHoles")}</Label>
                            <Switch
                              id="drain"
                              checked={config.hollow.drainHoles}
                              onCheckedChange={(drainHoles) =>
                                setConfig({ ...config, hollow: { ...config.hollow, drainHoles } })
                              }
                            />
                          </div>
                        </>
                      ) : null}
                      <p className="text-[11px] text-muted-foreground">{t("editor.compare")}</p>
                    </>
                  ) : null}


                  <div className="space-y-1.5">
                    <Label htmlFor="engraving">{t("editor.engraving")}</Label>
                    <Input
                      id="engraving"
                      maxLength={40}
                      value={config.engraving}
                      onChange={(event) => setConfig({ ...config, engraving: event.target.value })}
                      placeholder={t("editor.engravingPlaceholder")}
                    />
                  </div>

                  {config.engraving.trim() ? (
                    <div className="space-y-3 rounded-lg border border-border/60 p-3">
                      <SliderRow
                        label={t("editor.engravingSize")}
                        unit=" mm"
                        value={config.engravingSpec.sizeMm}
                        min={3}
                        max={20}
                        onChange={(sizeMm) => setConfig({ ...config, engravingSpec: { ...config.engravingSpec, sizeMm } })}
                      />
                      <SliderRow
                        label={t("editor.engravingDepth")}
                        unit=" mm"
                        value={config.engravingSpec.depthMm}
                        min={1}
                        max={3}
                        onChange={(depthMm) => setConfig({ ...config, engravingSpec: { ...config.engravingSpec, depthMm } })}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="raised">{t("editor.engravingRaised")}</Label>
                        <Switch
                          id="raised"
                          checked={config.engravingSpec.raised}
                          onCheckedChange={(raised) =>
                            setConfig({ ...config, engravingSpec: { ...config.engravingSpec, raised } })
                          }
                        />
                      </div>
                    </div>
                  ) : null}


                  <div className="flex items-center justify-between">
                    <Label htmlFor="rush">{t("editor.rush")}</Label>
                    <Switch id="rush" checked={config.rush} onCheckedChange={(rush) => setConfig({ ...config, rush })} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="qty">{t("editor.quantity")}</Label>
                    <Input
                      id="qty"
                      type="number"
                      min={1}
                      max={25}
                      value={config.quantity}
                      onChange={(event) => setConfig({ ...config, quantity: Number(event.target.value) })}
                    />
                  </div>

                  {placementPanel}

                  <Button className="w-full" onClick={goToCheckout}>
                    {t("editor.checkout")}
                  </Button>

                </>
              ) : null}
            </CardContent>
          </Card>

          {step !== "upload" ? (
            <Card className="lg:col-start-2 lg:sticky lg:top-6">
              <CardContent className="p-5 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-display text-lg">{t("editor.summary")}</p>
                  {savedAt ? <span className="text-xs text-muted-foreground">{t("editor.autosaved")}</span> : null}
                </div>
                <div className="mt-3 space-y-0.5">
                  {priced.lineItems.map((item) => (
                    <div key={item.label} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span>{item.cents ? money(item.cents) : "—"}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 space-y-0.5 border-t border-border pt-2">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("editor.subtotal")}</span>
                    <span>{money(priced.subtotalCents)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("editor.shipping")}</span>
                    <span>
                      {priced.shippingCents ? money(priced.shippingCents) : t("editor.shippingFree")}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
                  <span>{t("editor.total")}</span>
                  <span>{money(priced.totalCents)}</span>
                </div>
                {config.quantity > 1 ? (
                  <p className="mt-1 text-right text-xs text-muted-foreground">
                    {money(Math.round(priced.subtotalCents / config.quantity))} {t("editor.perUnit")}
                  </p>
                ) : null}

              </CardContent>
            </Card>
          ) : null}
        </div>
      </main>

      {step === "configure" ? (
        <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t("editor.total")}</p>
            <p className="truncate font-display text-lg">{money(priced.totalCents)}</p>
          </div>
          <Button className="shrink-0" onClick={goToCheckout}>
            {t("editor.checkout")}
          </Button>
        </div>
      ) : null}

    </div>
  );
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}

function parseRawNumber(text: string): number | null {
  if (text === "" || text === "-") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function SliderRow({
  label,
  value,
  min,
  max,
  unit,
  hint,
  formatExcess,
  onPending,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  /** Optional real-world read-out (e.g. "+12 mm") shown under the label. */
  hint?: string | undefined;
  /** Formats how far a typed value sits beyond the allowed range (e.g. in mm). */
  formatExcess?: ((excess: number) => string) | undefined;
  /** Reports whether the row currently holds an unconfirmed out-of-range value. */
  onPending?: ((pending: boolean) => void) | undefined;
  onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  const committed = Math.round(value);
  const [raw, setRaw] = useState(String(committed));
  const [editing, setEditing] = useState(false);
  const warningId = useMemo(() => `slider-warning-${label.replace(/\W+/g, "-")}-${min}-${max}`, [label, min, max]);

  // Sync the input display with external changes (slider, buttons, undo/redo)
  // only while the user is not actively typing.
  useEffect(() => {
    if (!editing) setRaw(String(committed));
  }, [committed, editing]);

  const parsed = parseRawNumber(raw);
  const isOutOfRange = parsed !== null && (parsed < min || parsed > max);
  const excess = isOutOfRange && parsed !== null ? (parsed > max ? parsed - max : min - parsed) : 0;

  // Surface the pending invalid state to the parent (drives the 3D highlight);
  // the model itself only moves once the value is committed.
  // The callback is kept in a ref so inline arrow props from the parent cannot
  // re-run this effect (which would loop through the parent's state update).
  const onPendingRef = useRef(onPending);
  onPendingRef.current = onPending;
  useEffect(() => {
    onPendingRef.current?.(isOutOfRange);
    return () => onPendingRef.current?.(false);
  }, [isOutOfRange]);


  function commit(text: string) {
    setEditing(false);
    if (text === "" || text === "-") {
      setRaw(String(committed));
      return;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setRaw(String(committed));
      return;
    }
    const next = clampInt(parsed, min, max);
    setRaw(String(next));
    if (next !== value) onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <Label>{label}</Label>
          {hint ? <p className="text-[11px] tabular-nums text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-8 shrink-0 p-0"
            aria-label={`${label} −`}
            disabled={value <= min}
            onClick={() => onChange(clampInt(value - 1, min, max))}
          >
            <Minus className="size-3.5" />
          </Button>
          <Input
            type="text"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={raw}
            aria-invalid={isOutOfRange}
            aria-describedby={isOutOfRange ? warningId : undefined}
            onFocus={() => setEditing(true)}
            onChange={(event) => setRaw(event.target.value)}
            onBlur={() => commit(raw)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(raw);
              } else if (event.key === "Escape") {
                setEditing(false);
                setRaw(String(committed));
              }
            }}
            className={cn(
              "h-8 w-[64px] px-2 text-right text-xs tabular-nums",
              isOutOfRange && "border-destructive focus-visible:border-destructive focus-visible:ring-destructive",
            )}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-8 shrink-0 p-0"
            aria-label={`${label} +`}
            disabled={value >= max}
            onClick={() => onChange(clampInt(value + 1, min, max))}
          >
            <Plus className="size-3.5" />
          </Button>
          {unit ? <span className="w-3 text-xs text-muted-foreground">{unit}</span> : null}
        </div>
      </div>
      {isOutOfRange ? (
        <p id={warningId} className="text-[11px] text-destructive" role="alert">
          {t("editor.input.outOfRangeBy", {
            excess: formatExcess ? formatExcess(excess) : `${excess}${unit ?? ""}`,
            min: String(min),
            max: String(max),
          })}
        </p>
      ) : null}
      <Slider value={[value]} min={min} max={max} step={1} onValueChange={([next]) => onChange(next ?? value)} />
    </div>
  );
}



function ChoiceRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string; delta?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { money } = useI18n();
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {options.map((option) => {
          const delta = option.delta ?? 0;
          return (
            <Button
              key={option.id}
              size="sm"
              className="h-auto min-h-10 w-full flex-col items-center justify-center gap-0.5 whitespace-normal px-3 py-1.5 text-xs leading-tight sm:w-auto sm:text-sm"
              variant={value === option.id ? "default" : "outline"}
              onClick={() => onChange(option.id)}
            >
              <span>{option.label}</span>
              {value !== option.id && delta !== 0 ? (
                <span className="text-[11px] opacity-70">
                  {delta > 0 ? "+" : "−"}
                  {money(Math.abs(delta))}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>
    </div>
  );


}
