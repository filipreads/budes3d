import { useI18n, type TranslationKey } from "@/lib/i18n";

type Tone = "neutral" | "positive" | "progress" | "warning";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-primary/12 text-primary",
  progress: "bg-accent/20 text-accent-foreground",
  warning: "bg-destructive/12 text-destructive",
};

const STATUS_TONES: Record<string, Tone> = {
  paid: "positive",
  delivered: "positive",
  pending: "warning",
  refunded: "warning",
  cancelled: "warning",
  failed: "warning",
  in_production: "progress",
  shipped: "progress",
  processing: "progress",
  new: "neutral",
  draft: "neutral",
  ready: "positive",
};

/**
 * One chip style shared by overview, orders and downloads so the same status
 * always reads the same way.
 */
export function StatusChip({ status, tone }: { status: string; tone?: Tone }) {
  const { t } = useI18n();
  const resolved = tone ?? STATUS_TONES[status] ?? "neutral";
  const key = `status.${status}` as TranslationKey;
  const label = t(key);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[resolved]}`}
    >
      {label === key ? status : label}
    </span>
  );
}
