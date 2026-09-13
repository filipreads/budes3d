import type { TranslationKey } from "@/lib/i18n";

export type AchievementStats = {
  projects: number;
  models: number;
  orders: number;
  paidOrders: number;
  downloads: number;
  shared: number;
};

export type Achievement = {
  id: string;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  icon: "sparkles" | "box" | "package" | "creditCard" | "trophy" | "download" | "share";
  done: boolean;
};

/**
 * Milestones are derived from data the account already loads — no extra table,
 * no writes, so the badges can never drift from the real order/project state.
 */
export function buildAchievements(stats: AchievementStats): Achievement[] {
  return [
    {
      id: "firstProject",
      nameKey: "achievements.firstProject.name",
      descKey: "achievements.firstProject.desc",
      icon: "sparkles",
      done: stats.projects >= 1,
    },
    {
      id: "firstModel",
      nameKey: "achievements.firstModel.name",
      descKey: "achievements.firstModel.desc",
      icon: "box",
      done: stats.models >= 1,
    },
    {
      id: "firstOrder",
      nameKey: "achievements.firstOrder.name",
      descKey: "achievements.firstOrder.desc",
      icon: "package",
      done: stats.orders >= 1,
    },
    {
      id: "firstPaid",
      nameKey: "achievements.firstPaid.name",
      descKey: "achievements.firstPaid.desc",
      icon: "creditCard",
      done: stats.paidOrders >= 1,
    },
    {
      id: "threeOrders",
      nameKey: "achievements.threeOrders.name",
      descKey: "achievements.threeOrders.desc",
      icon: "trophy",
      done: stats.paidOrders >= 3,
    },
    {
      id: "download",
      nameKey: "achievements.download.name",
      descKey: "achievements.download.desc",
      icon: "download",
      done: stats.downloads >= 1,
    },
    {
      id: "sharer",
      nameKey: "achievements.sharer.name",
      descKey: "achievements.sharer.desc",
      icon: "share",
      done: stats.shared >= 1,
    },
  ];
}

export function achievementLevel(achievements: Achievement[]): number {
  return Math.max(1, Math.floor(achievements.filter((a) => a.done).length / 2) + 1);
}
