import { Box, CreditCard, Download, Package, Share2, Sparkles, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { achievementLevel, buildAchievements, type AchievementStats } from "@/lib/achievements";

const ICONS = {
  sparkles: Sparkles,
  box: Box,
  package: Package,
  creditCard: CreditCard,
  trophy: Trophy,
  download: Download,
  share: Share2,
} as const;

export function AchievementsCard({ stats }: { stats: AchievementStats }) {
  const { t } = useI18n();
  const achievements = buildAchievements(stats);
  const done = achievements.filter((a) => a.done).length;
  const level = achievementLevel(achievements);
  const percent = Math.round((done / achievements.length) * 100);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">{t("achievements.title")}</h2>
          <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary">
            {t("achievements.level", { level })}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("achievements.subtitle", { done, total: achievements.length })}
        </p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>

        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {achievements.map((achievement) => {
            const Icon = ICONS[achievement.icon];
            return (
              <li
                key={achievement.id}
                title={t(achievement.descKey)}
                className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs transition-colors ${
                  achievement.done
                    ? "border-primary/30 bg-primary/5 text-foreground"
                    : "border-border/60 text-muted-foreground opacity-70"
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-lg ${
                    achievement.done ? "bg-primary/12 text-primary" : "bg-muted"
                  }`}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t(achievement.nameKey)}</span>
                  <span className="block truncate">
                    {achievement.done ? t(achievement.descKey) : t("achievements.locked")}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
