/**
 * Charging for premium (Tripo3D) generations.
 *
 * The rate lives in `app_settings.premium_generation_rate` so it can be tuned
 * without a deploy; the code default in `pricing.ts` is the fallback.
 */
import { PREMIUM_GENERATION_PRICE, amount, type Currency, type LineItem } from "./pricing";

export async function premiumRateCents(currency: Currency): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "premium_generation_rate")
      .maybeSingle();
    const value = (data?.value ?? {}) as Record<string, unknown>;
    const cents = Number(value[currency]);
    if (Number.isFinite(cents) && cents >= 0) return Math.round(cents);
  } catch {
    // Settings unreachable — fall back to the built-in price.
  }
  return amount(PREMIUM_GENERATION_PRICE, currency);
}

/**
 * Premium is priced per model, not per attempt: retries of the preview are
 * free, so a project that used the premium engine is charged exactly once.
 */
export async function premiumExtras(count: number, currency: Currency): Promise<LineItem[]> {
  const used = Math.max(0, Math.round(count || 0)) > 0;
  if (!used) return [];
  const rate = await premiumRateCents(currency);
  if (rate <= 0) return [];
  return [{ label: "Premium 3D generation", cents: rate }];
}
