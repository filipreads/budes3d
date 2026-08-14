import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Owner-only: turn a view-only share link on or off for one order. */
export const setOrderShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; enabled: boolean }) => {
    if (!input?.orderId) throw new Error("orderId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: order, error } = await supabase
      .from("orders")
      .select("id, share_token")
      .eq("id", data.orderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !order) throw new Error("Order not found");

    if (!data.enabled) {
      const { error: offError } = await supabase
        .from("orders")
        .update({ share_enabled: false })
        .eq("id", order.id)
        .eq("user_id", userId);
      if (offError) throw new Error(offError.message);
      return { enabled: false, token: null as string | null };
    }

    const token = order.share_token ?? crypto.randomUUID().replace(/-/g, "");
    const { error: onError } = await supabase
      .from("orders")
      .update({ share_token: token, share_enabled: true })
      .eq("id", order.id)
      .eq("user_id", userId);
    if (onError) throw new Error(onError.message);
    return { enabled: true, token };
  });

export type SharedPreview = {
  orderNumber: string;
  projectTitle: string | null;
  deliveryType: string;
  createdAt: string;
  modelUrl: string | null;
};

/**
 * Public, token-gated read. The token is verified by the security-definer
 * RPC before any privileged work happens, and only view-only data is returned.
 */
export const getSharedPreview = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    if (!input?.token || input.token.length < 16) throw new Error("Invalid link");
    return input;
  })
  .handler(async ({ data }): Promise<SharedPreview | null> => {
    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const anon = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });

    const { data: rows } = await anon.rpc("get_shared_preview", { _token: data.token });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return null;

    let modelUrl: string | null = null;
    if (row.model_url && !String(row.model_url).startsWith("sample://")) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: signed } = await supabaseAdmin.storage
        .from("portrait-models")
        .createSignedUrl(String(row.model_url), 60 * 60);
      modelUrl = signed?.signedUrl ?? null;
    }

    return {
      orderNumber: row.order_number,
      projectTitle: row.project_title ?? null,
      deliveryType: row.delivery_type,
      createdAt: row.created_at,
      modelUrl,
    };
  });
