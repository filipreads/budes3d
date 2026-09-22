/**
 * Runtime prices for the physical extras (plinth, engraving, hollowing).
 *
 * Stored in `app_settings` so an admin can retune them without a deploy; the
 * built-in prices in `pricing.ts` are the fallback.
 */
import type { Currency, PricingOverrides } from "./pricing";

async function readSetting(key: string): Promise<Record<string, unknown>> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    return (data?.value ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function positive(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : undefined;
}

export async function pricingOverrides(currency: Currency): Promise<PricingOverrides> {
  const [bases, engraving, hollow] = await Promise.all([
    readSetting("base_prices"),
    readSetting("engraving_price"),
    readSetting("hollow_discount"),
  ]);

  const baseCents: Record<string, number> = {};
  const perCurrency = (bases[currency] ?? {}) as Record<string, unknown>;
  for (const [id, value] of Object.entries(perCurrency)) {
    const cents = positive(value);
    if (cents !== undefined) baseCents[id] = cents;
  }

  const discount = Number(hollow["share"]);
  return {
    ...(Object.keys(baseCents).length ? { baseCents } : {}),
    ...(positive(engraving[currency]) !== undefined ? { engravingCents: positive(engraving[currency])! } : {}),
    ...(Number.isFinite(discount) && discount >= 0 && discount <= 0.5 ? { hollowDiscount: discount } : {}),
  };
}
