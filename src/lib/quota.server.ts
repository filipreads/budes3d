/**
 * ZeroGPU plan + quota accounting (server-only).
 *
 * Hugging Face does not expose a per-token quota endpoint, so the remaining
 * budget is derived honestly from our own generation history: every finished
 * reconstruction records the GPU seconds it consumed, and the plan stored in
 * `app_settings.zerogpu` defines the rolling 24h ceiling.
 */

export type ZeroGpuPlan = "free" | "pro";

export type ZeroGpuSettings = {
  plan: ZeroGpuPlan;
  freeQuotaSeconds: number;
  proQuotaSeconds: number;
};

const DEFAULTS: ZeroGpuSettings = { plan: "free", freeQuotaSeconds: 300, proQuotaSeconds: 1500 };

export async function readSettings(): Promise<ZeroGpuSettings> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", "zerogpu").maybeSingle();
    const value = (data?.value ?? {}) as Record<string, unknown>;
    return {
      plan: value["plan"] === "pro" ? "pro" : "free",
      freeQuotaSeconds: Number(value["free_quota_seconds"] ?? DEFAULTS.freeQuotaSeconds),
      proQuotaSeconds: Number(value["pro_quota_seconds"] ?? DEFAULTS.proQuotaSeconds),
    };
  } catch {
    return DEFAULTS;
  }
}

export function quotaSecondsFor(settings: ZeroGpuSettings) {
  return settings.plan === "pro" ? settings.proQuotaSeconds : settings.freeQuotaSeconds;
}

export async function currentPlan(): Promise<ZeroGpuPlan> {
  return (await readSettings()).plan;
}

/** Live Hugging Face account tier for the configured token, when reachable. */
export async function hfAccount(): Promise<{ name: string | null; isPro: boolean | null }> {
  const token = process.env["HF_TOKEN"];
  if (!token) return { name: null, isPro: null };
  try {
    const response = await fetch("https://huggingface.co/api/whoami-v2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { name: null, isPro: null };
    const payload = (await response.json()) as { name?: string; isPro?: boolean; type?: string };
    return { name: payload.name ?? null, isPro: payload.isPro ?? false };
  } catch {
    return { name: null, isPro: null };
  }
}
