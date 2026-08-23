import { useEffect, useState } from "react";
import { Check, CircleDashed, Loader2, TriangleAlert } from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export type StageId = "upload" | "retouch" | "preview" | "configure";
export type StageState = "pending" | "active" | "done" | "error";

const STAGES: { id: StageId; labelKey: TranslationKey }[] = [
  { id: "upload", labelKey: "editor.step.upload" },
  { id: "retouch", labelKey: "editor.step.retouch" },
  { id: "preview", labelKey: "editor.step.preview" },
  { id: "configure", labelKey: "editor.step.configure" },
];

/** A full TRELLIS run typically finishes in roughly this many seconds. */
const TYPICAL_RUN_SECONDS = 180;

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Ordered pipeline of the TRELLIS 2 conversion job. */
const JOB_STAGES = ["queued", "preprocessing", "sculpting", "extracting", "storing"] as const;
export type JobStage = (typeof JOB_STAGES)[number] | "ready" | "failed";

export function StudioProgress({
  states,
  message,
  progress,
  error,
  startedAt = null,
  jobStage = null,
  onRetry,
  onCancel,
  onPreview,
}: {
  states: Record<StageId, StageState>;
  message?: string | null;
  progress?: number | null;
  error?: string | null;
  /** Timestamp of the running generation, used for elapsed time and an ETA. */
  startedAt?: number | null;
  /** Current stage of the TRELLIS conversion job, when one exists. */
  jobStage?: JobStage | null;
  onRetry?: () => void;
  onCancel?: () => void;
  onPreview?: () => void;
}) {

  const { t } = useI18n();
  const done = STAGES.filter((stage) => states[stage.id] === "done").length;
  const pct = progress ?? Math.round((done / STAGES.length) * 100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const elapsed = startedAt ? (now - startedAt) / 1000 : null;
  // Once real progress is reported, extrapolate from it; before that fall back
  // to the typical run length so the wait never feels open-ended.
  const remaining =
    elapsed === null
      ? null
      : progress && progress > 5
        ? Math.max(0, (elapsed / progress) * (100 - progress))
        : Math.max(0, TYPICAL_RUN_SECONDS - elapsed);


  return (
    <section aria-label={t("editor.title")} className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {t("editor.progress", { done, total: STAGES.length })}
        </p>
        <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage, index) => {
          const state = states[stage.id];
          return (
            <li
              key={stage.id}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                state === "active"
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : state === "done"
                    ? "border-border bg-background text-foreground"
                    : state === "error"
                      ? "border-destructive/60 bg-destructive/10 text-foreground"
                      : "border-border/60 text-muted-foreground"
              }`}
            >
              <StageIcon state={state} />
              <span className="min-w-0">
                <span className="block truncate">
                  {index + 1}. {t(stage.labelKey)}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {t(`editor.status.${state}` as TranslationKey)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" /> {error}
        </p>
      ) : message ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin" /> {message}
          </p>
          {elapsed !== null ? (
            <p className="text-xs tabular-nums">
              {t("editor.elapsed", { mm: formatDuration(elapsed) })}
              {remaining !== null ? ` · ${t("editor.eta", { mm: formatDuration(remaining) })}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {jobStage ? (
        <div
          aria-live="polite"
          className={`mt-4 rounded-lg border p-3 ${
            jobStage === "failed"
              ? "border-destructive/60 bg-destructive/10"
              : jobStage === "ready"
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-background/60"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t("editor.job.title")}</p>
            <span className="text-xs text-muted-foreground">
              {jobStage === "failed"
                ? t("editor.job.failedTitle")
                : jobStage === "ready"
                  ? t("editor.job.readyTitle")
                  : t(`editor.job.stage.${jobStage}` as TranslationKey)}
            </span>
          </div>

          <ol className="scroll-x mt-2 flex flex-nowrap gap-1.5 pb-1">
            {JOB_STAGES.map((stage) => {
              const index = JOB_STAGES.indexOf(stage);
              const currentIndex = JOB_STAGES.indexOf(jobStage as (typeof JOB_STAGES)[number]);
              const state: StageState =
                jobStage === "ready"
                  ? "done"
                  : jobStage === "failed"
                    ? currentIndex === -1 && index === 0
                      ? "error"
                      : "pending"
                    : index < currentIndex
                      ? "done"
                      : index === currentIndex
                        ? "active"
                        : "pending";
              return (
                <li
                  key={stage}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] ${
                    state === "active"
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : state === "done"
                        ? "border-border text-foreground"
                        : "border-border/60 text-muted-foreground"
                  }`}
                >
                  <StageIcon state={state} />
                  {t(`editor.job.stage.${stage}` as TranslationKey)}
                </li>
              );
            })}
          </ol>

          <p className="mt-2 text-xs text-muted-foreground">
            {jobStage === "failed"
              ? t("editor.job.failedBody")
              : jobStage === "ready"
                ? t("editor.job.readyBody")
                : t("editor.job.running")}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {jobStage === "ready" && onPreview ? (
              <Button size="sm" onClick={onPreview}>
                {t("editor.job.openPreview")}
              </Button>
            ) : null}
            {jobStage !== "ready" && jobStage !== "failed" && onCancel ? (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                {t("editor.cancel")}
              </Button>
            ) : null}
            {jobStage !== "ready" && onRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry} disabled={jobStage !== "failed"}>
                <RotateCw className="mr-1.5 size-3.5" aria-hidden />
                {t("editor.retry")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>

  );
}

function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <Check className="size-4 shrink-0 text-primary" />;
  if (state === "active") return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
  if (state === "error") return <TriangleAlert className="size-4 shrink-0 text-destructive" />;
  return <CircleDashed className="size-4 shrink-0" />;
}
