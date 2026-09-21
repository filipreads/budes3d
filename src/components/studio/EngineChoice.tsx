/**
 * First step of the studio flow: which 3D engine renders the portrait.
 *
 * Both tiers are presented equally; the premium surcharge comes from the
 * server so no price is hardcoded in the UI.
 */
import { Check, Sparkles, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { EngineInfo } from "@/lib/generation.functions";

type Props = {
  engines: EngineInfo[];
  value: string;
  onChange: (id: EngineInfo["id"]) => void;
  disabled?: boolean;
};

export function EngineChoice({ engines, value, onChange, disabled }: Props) {
  const { t, money } = useI18n();
  if (engines.length < 2) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">{t("editor.engine")}</p>
        <p className="text-xs text-muted-foreground">{t("editor.engine.hint")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {engines.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(item.id)}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors disabled:opacity-60",
                selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/50",
              )}
            >
              <span className="flex items-center gap-2">
                {item.premium ? <Sparkles className="size-4 shrink-0 text-primary" aria-hidden /> : <Zap className="size-4 shrink-0" aria-hidden />}
                <span className="min-w-0 truncate font-medium">{item.label}</span>
                {selected ? <Check className="ml-auto size-4 shrink-0 text-primary" aria-hidden /> : null}
              </span>
              <span className="mt-2 block text-xs text-muted-foreground">
                {item.premium ? t("editor.engine.premiumBody") : t("editor.engine.basicBody")}
              </span>
              <span className="mt-2 block text-sm font-semibold">
                {item.premium && item.surchargeCents > 0
                  ? t("editor.engine.surcharge", { price: money(item.surchargeCents) })
                  : t("editor.engine.included")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
