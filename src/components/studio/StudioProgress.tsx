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

export function StudioProgress({
  states,
  message,
  progress,
  error,
}: {
  states: Record<StageId, StageState>;
  message?: string | null;
  progress?: number | null;
  error?: string | null;
}) {
  const { t } = useI18n();
  const done = STAGES.filter((stage) => states[stage.id] === "done").length;
  const pct = progress ?? Math.round((done / STAGES.length) * 100);

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
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin" /> {message}
        </p>
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
