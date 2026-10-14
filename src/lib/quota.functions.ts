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

export type MeshyUsageRow = {
  id: string;
  projectTitle: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  creditsBefore: number | null;
  creditsAfter: number | null;
  creditsConsumed: number | null;
};

export type MeshyUsageOverview = {
  balance: number | null;
  totalConsumed: number;
  rows: MeshyUsageRow[];
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const getMeshyUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MeshyUsageOverview> => {
    await assertAdmin(context);
    const { readBalance, meshyAvailable } = await import("./meshy.server");
    const balance = meshyAvailable() ? await readBalance() : null;
    const { data: jobs } = await context.supabase
      .from("generation_jobs")
      .select("id, project_id, status, created_at, finished_at, provider_metadata")
      .eq("provider", "meshy")
      .order("created_at", { ascending: false })
      .limit(100);
    const ids = [...new Set((jobs ?? []).map((j) => j.project_id))];
    const { data: projects } = ids.length
      ? await context.supabase.from("projects").select("id, title").in("id", ids)
      : { data: [] as { id: string; title: string | null }[] };
    const titles = new Map((projects ?? []).map((p) => [p.id, p.title ?? ""]));
    const rows = (jobs ?? []).map((j) => {
      const m = (j.provider_metadata ?? {}) as Record<string, unknown>;
      return {
        id: j.id,
        projectTitle: titles.get(j.project_id) || j.project_id.slice(0, 8),
        status: j.status,
        createdAt: j.created_at,
        finishedAt: j.finished_at,
        creditsBefore: num(m["credits_balance_before"]),
        creditsAfter: num(m["credits_balance_after"]),
        creditsConsumed: num(m["credits_consumed"]),
      };
    });
    return { balance, totalConsumed: rows.reduce((s, r) => s + (r.creditsConsumed ?? 0), 0), rows };
  });
