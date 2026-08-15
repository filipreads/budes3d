import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OrderDownload = {
  id: string;
  label: string;
  format: string;
};

/** Files attached to one paid order. Nothing is listed until payment clears. */
export const listOrderDownloads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId) throw new Error("orderId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<OrderDownload[]> => {
    const { supabase, userId } = context;

    const { data: order } = await supabase
      .from("orders")
      .select("id, payment_status, config_snapshot")
      .eq("id", data.orderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!order || order.payment_status !== "paid") return [];

    const { data: rows } = await supabase
      .from("order_downloads")
      .select("id, label, file_format, storage_path")
      .eq("order_id", order.id)
      .eq("user_id", userId);

    return (rows ?? [])
      .filter((row) => row.storage_path && !String(row.storage_path).startsWith("sample://"))
      .map((row) => ({ id: row.id, label: row.label, format: row.file_format }));
  });

/**
 * Short-lived signed URL for one download row. The order must belong to the
 * caller AND be paid — the storage bucket itself stays private.
 */
export const getOrderDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { downloadId: string }) => {
    if (!input?.downloadId) throw new Error("downloadId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: row } = await supabase
      .from("order_downloads")
      .select("id, order_id, file_format, storage_path, label")
      .eq("id", data.downloadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row?.storage_path || String(row.storage_path).startsWith("sample://")) {
      throw new Error("That file is not available");
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, payment_status, order_number, config_snapshot")
      .eq("id", row.order_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!order || order.payment_status !== "paid") throw new Error("This order is not paid yet");

    const { data: signed, error } = await supabase.storage
      .from("portrait-models")
      .createSignedUrl(String(row.storage_path), 60 * 10);
    if (error || !signed?.signedUrl) throw new Error("Could not prepare that download");

    // STL is a print file: it must come out at the physical height the customer
    // ordered, so the browser scales the mesh with this value (millimetres).
    const snapshot = (order.config_snapshot ?? {}) as { sizeId?: string };
    const heights: Record<string, number> = { s: 100, m: 150, l: 220, xl: 300 };
    const heightMm = heights[String(snapshot.sizeId ?? "m")] ?? 150;

    return {
      url: signed.signedUrl,
      format: row.file_format,
      filename: `${order.order_number}.${row.file_format}`,
      heightMm,
    };
  });
