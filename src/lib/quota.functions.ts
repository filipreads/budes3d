import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GenerationRow = {
  id: string;
  title: string;
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
  seconds: number | null;
  plan: string | null;
  startedAt: string | null;
  createdAt: string;
};

export type QuotaOverview = {
  plan: "free" | "pro";
  quotaSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  runs24h: number;
  hfAccount: string | null;
  hfIsPro: boolean | null;
  quotaBlocked: number;
  history: GenerationRow[];
};

async function assertAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (data !== true) throw new Error("Forbidden");
}

export const getQuotaOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QuotaOverview> => {
    await assertAdmin(context);
    const { readSettings, quotaSecondsFor, hfAccount } = await import("./quota.server");
    const settings = await readSettings();
    const quotaSeconds = quotaSecondsFor(settings);

    const { data: projects } = await context.supabase
      .from("projects")
      .select(
        "id, title, status, generation_stage, generation_progress, generation_error, generation_seconds, generation_plan, generation_started_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(60);

    const rows = projects ?? [];
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recent = rows.filter((row) =>
      row.generation_started_at ? Date.parse(row.generation_started_at) >= since : false,
    );
    const usedSeconds = recent.reduce((sum, row) => sum + (row.generation_seconds ?? 0), 0);
    const account = await hfAccount();

    return {
      plan: settings.plan,
      quotaSeconds,
      usedSeconds,
      remainingSeconds: Math.max(0, quotaSeconds - usedSeconds),
      runs24h: recent.length,
      hfAccount: account.name,
      hfIsPro: account.isPro,
      quotaBlocked: rows.filter((row) => row.status === "quota_blocked").length,
      history: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        stage: row.generation_stage,
        progress: row.generation_progress ?? 0,
        error: row.generation_error,
        seconds: row.generation_seconds,
        plan: row.generation_plan,
        startedAt: row.generation_started_at,
        createdAt: row.created_at,
      })),
    };
  });

export const setZeroGpuPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ plan: z.enum(["free", "pro"]) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { readSettings } = await import("./quota.server");
    const settings = await readSettings();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("app_settings").upsert(
      {
        key: "zerogpu",
        value: {
          plan: data.plan,
          free_quota_seconds: settings.freeQuotaSeconds,
          pro_quota_seconds: settings.proQuotaSeconds,
        },
        updated_by: context.userId,
      },
      { onConflict: "key" },
    );

    // Switching to PRO lifts the ceiling, so projects that only stopped because
    // of the free quota are put back in the queue instead of reading `failed`.
    let requeued = 0;
    if (data.plan === "pro") {
      const { data: blocked } = await supabaseAdmin
        .from("projects")
        .select("id, status, generation_error")
        .in("status", ["quota_blocked", "failed"]);
      const ids = (blocked ?? [])
        .filter((row) => row.status === "quota_blocked" || /quota/i.test(row.generation_error ?? ""))
        .map((row) => row.id);
      if (ids.length) {
        await supabaseAdmin
          .from("projects")
          .update({ status: "queued", generation_stage: "queued", generation_progress: 0, generation_error: null })
          .in("id", ids);
        requeued = ids.length;
      }
    }

    return { plan: data.plan, requeued };
  });
