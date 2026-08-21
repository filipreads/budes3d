import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function hashDeviceId(deviceId: string) {
  const bytes = new TextEncoder().encode(`relievo-mfa:${deviceId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const validateDevice = (data: unknown) => {
  const input = data as { deviceId?: unknown; label?: unknown };
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : "";
  if (deviceId.length < 16 || deviceId.length > 200) throw new Error("invalid device id");
  const label = typeof input?.label === "string" ? input.label.slice(0, 120) : null;
  return { deviceId, label };
};

/** True when this browser was marked as trusted and the trust has not expired. */
export const isDeviceTrusted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateDevice)
  .handler(async ({ data, context }) => {
    const deviceHash = await hashDeviceId(data.deviceId);
    const { data: row } = await context.supabase
      .from("trusted_mfa_devices")
      .select("id, expires_at")
      .eq("user_id", context.userId)
      .eq("device_hash", deviceHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!row) return { trusted: false };
    await context.supabase
      .from("trusted_mfa_devices")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", row.id);
    return { trusted: true };
  });

/** Remember this browser for 30 days so future sign-ins skip the code step. */
export const trustDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateDevice)
  .handler(async ({ data, context }) => {
    const deviceHash = await hashDeviceId(data.deviceId);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await context.supabase.from("trusted_mfa_devices").upsert(
      {
        user_id: context.userId,
        device_hash: deviceHash,
        label: data.label,
        last_used_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "user_id,device_hash" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const countTrustedDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count } = await context.supabase
      .from("trusted_mfa_devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gt("expires_at", new Date().toISOString());
    return { count: count ?? 0 };
  });

export const forgetTrustedDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("trusted_mfa_devices")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
