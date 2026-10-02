/**
 * First step of the studio flow: which 3D engine renders the portrait.
 *
 * Both tiers are presented equally; the premium surcharge comes from the
 * server so no price is hardcoded in the UI.
 */
import { Check, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <section aria-label={t("editor.engine")} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase text-primary">{t("editor.engine.eyebrow")}</p>
          <h2 className="mt-1 font-display text-xl sm:text-2xl">{t("editor.engine")}</h2>
        </div>
        <p className="max-w-md text-sm text-muted-foreground">{t("editor.engine.hint")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {engines.map((item) => {
          const selected = item.id === value;
          return (
            <Button
              key={item.id}
              type="button"
              variant="outline"
              disabled={disabled || !item.configured}
              aria-pressed={selected}
              onClick={() => onChange(item.id)}
              className={cn(
                "h-auto min-h-36 w-full flex-col items-stretch justify-between whitespace-normal rounded-md border p-4 text-left shadow-none transition-colors disabled:opacity-65",
                selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card hover:border-primary/50 hover:bg-accent",
              )}
            >
              <span className="flex w-full items-center gap-2">
                {item.premium ? <Sparkles className="size-4 shrink-0 text-primary" aria-hidden /> : <Zap className="size-4 shrink-0 text-primary" aria-hidden />}
                <span className="min-w-0 flex-1 text-base font-semibold">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.premium ? t("editor.engine.tierPremium") : t("editor.engine.tierBasic")}</span>
                {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
              </span>
              <span className="mt-3 block w-full text-sm font-normal leading-relaxed text-muted-foreground">
                {item.premium ? t("editor.engine.premiumBody") : t("editor.engine.basicBody")}
              </span>
              <span className="mt-3 block w-full border-t border-border pt-2 text-sm font-semibold">
                {!item.configured ? t("editor.engine.unavailable") : item.premium && item.surchargeCents > 0
                  ? t("editor.engine.surcharge", { price: money(item.surchargeCents) })
                  : t("editor.engine.included")}
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
