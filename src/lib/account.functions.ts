import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AccountOrder = {
  id: string;
  order_number: string;
  delivery_type: string;
  total_cents: number;
  subtotal_cents: number;
  shipping_cents: number;
  payment_status: string;
  fulfilment_status: string;
  created_at: string;
  paid_at: string | null;
  contact_email: string | null;
  line_items: unknown;
  shipping_address: unknown;
  share_token: string | null;
  share_enabled: boolean;
};

export type AccountProject = {
  id: string;
  title: string;
  status: string;
  model_url: string | null;
  created_at: string;
};

const ORDER_COLUMNS =
  "id, order_number, delivery_type, total_cents, subtotal_cents, shipping_cents, payment_status, fulfilment_status, created_at, paid_at, contact_email, line_items, shipping_address, share_token, share_enabled";

export type OrdersQuery = {
  search?: string;
  payment?: string;
  fulfilment?: string;
  delivery?: string;
  sort?: "newest" | "oldest" | "amount";
  page?: number;
  pageSize?: number;
};

/** Paginated, filtered order list for the signed-in customer. */
export const listAccountOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: OrdersQuery) => input ?? {})
  .handler(async ({ data, context }): Promise<{ rows: AccountOrder[]; total: number }> => {
    const { supabase, userId } = context;
    const pageSize = Math.min(Math.max(data.pageSize ?? 10, 1), 50);
    const page = Math.max(data.page ?? 1, 1);

    let query = supabase
      .from("orders")
      .select(ORDER_COLUMNS, { count: "exact" })
      .eq("user_id", userId);

    if (data.search?.trim()) query = query.ilike("order_number", `%${data.search.trim()}%`);
    if (data.payment && data.payment !== "all") query = query.eq("payment_status", data.payment);
    if (data.fulfilment && data.fulfilment !== "all") query = query.eq("fulfilment_status", data.fulfilment);
    if (data.delivery && data.delivery !== "all") query = query.eq("delivery_type", data.delivery);

    if (data.sort === "amount") query = query.order("total_cents", { ascending: false });
    else query = query.order("created_at", { ascending: data.sort === "oldest" });

    const from = (page - 1) * pageSize;
    const { data: rows, count, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    return { rows: (rows ?? []) as AccountOrder[], total: count ?? 0 };
  });

export type AccountSummary = {
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  totals: {
    orders: number;
    awaitingPayment: number;
    inProduction: number;
    downloads: number;
    projects: number;
  };
  latestOrders: AccountOrder[];
  latestProjects: AccountProject[];
};

/** Everything the account overview tab needs, in one round trip. */
export const getAccountSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountSummary> => {
    const { supabase, userId, claims } = context;

    const [ordersResult, projectsResult, profileResult, downloadsResult] = await Promise.all([
      supabase.from("orders").select(ORDER_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }),
      supabase
        .from("projects")
        .select("id, title, status, model_url, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("profiles").select("display_name, avatar_url").eq("id", userId).maybeSingle(),
      supabase.from("order_downloads").select("id, order_id, storage_path").eq("user_id", userId),
    ]);

    const orders = (ordersResult.data ?? []) as AccountOrder[];
    const paidIds = new Set(orders.filter((order) => order.payment_status === "paid").map((order) => order.id));
    const downloads = (downloadsResult.data ?? []).filter(
      (row) => paidIds.has(row.order_id) && row.storage_path && !String(row.storage_path).startsWith("sample://"),
    );

    let avatarUrl: string | null = null;
    const avatarPath = profileResult.data?.avatar_url ?? null;
    if (avatarPath) {
      if (avatarPath.startsWith("http")) {
        avatarUrl = avatarPath;
      } else {
        const { data: signed } = await supabase.storage
          .from("portrait-uploads")
          .createSignedUrl(avatarPath, 60 * 60);
        avatarUrl = signed?.signedUrl ?? null;
      }
    }

    return {
      displayName: profileResult.data?.display_name ?? null,
      avatarUrl,
      email: (claims as { email?: string } | null)?.email ?? null,
      totals: {
        orders: orders.length,
        awaitingPayment: orders.filter((order) => order.payment_status !== "paid").length,
        inProduction: orders.filter((order) => order.fulfilment_status === "in_production").length,
        downloads: downloads.length,
        projects: (projectsResult.data ?? []).length,
      },
      latestOrders: orders.slice(0, 3),
      latestProjects: ((projectsResult.data ?? []) as AccountProject[]).slice(0, 3),
    };
  });

export type DownloadEntry = {
  id: string;
  label: string;
  format: string;
  createdAt: string;
  orderId: string;
  orderNumber: string;
};

/** Every downloadable file across all paid orders — one request instead of one per order. */
export const listAllDownloads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DownloadEntry[]> => {
    const { supabase, userId } = context;

    const { data: paidOrders } = await supabase
      .from("orders")
      .select("id, order_number")
      .eq("user_id", userId)
      .eq("payment_status", "paid");

    const orderMap = new Map((paidOrders ?? []).map((order) => [order.id, order.order_number]));
    if (orderMap.size === 0) return [];

    const { data: rows } = await supabase
      .from("order_downloads")
      .select("id, order_id, label, file_format, storage_path, created_at")
      .eq("user_id", userId)
      .in("order_id", Array.from(orderMap.keys()))
      .order("created_at", { ascending: false });

    return (rows ?? [])
      .filter((row) => row.storage_path && !String(row.storage_path).startsWith("sample://"))
      .map((row) => ({
        id: row.id,
        label: row.label,
        format: row.file_format,
        createdAt: row.created_at,
        orderId: row.order_id,
        orderNumber: orderMap.get(row.order_id) ?? "",
      }));
  });

export type AccountProfile = {
  displayName: string;
  avatarUrl: string | null;
  avatarPath: string | null;
  preferredLocale: string;
  email: string | null;
};

export const getAccountProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountProfile> => {
    const { supabase, userId, claims } = context;
    const { data } = await supabase
      .from("profiles")
      .select("display_name, avatar_url, preferred_locale")
      .eq("id", userId)
      .maybeSingle();

    let avatarUrl: string | null = null;
    const avatarPath = data?.avatar_url ?? null;
    if (avatarPath) {
      if (avatarPath.startsWith("http")) avatarUrl = avatarPath;
      else {
        const { data: signed } = await supabase.storage
          .from("portrait-uploads")
          .createSignedUrl(avatarPath, 60 * 60);
        avatarUrl = signed?.signedUrl ?? null;
      }
    }

    return {
      displayName: data?.display_name ?? "",
      avatarUrl,
      avatarPath,
      preferredLocale: data?.preferred_locale ?? "en",
      email: (claims as { email?: string } | null)?.email ?? null,
    };
  });

export const updateAccountProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { displayName?: string; preferredLocale?: string; avatarPath?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const patch: Record<string, string> = { id: userId };
    if (typeof data.displayName === "string") patch["display_name"] = data.displayName.trim().slice(0, 80);
    if (data.preferredLocale === "en" || data.preferredLocale === "cs") patch["preferred_locale"] = data.preferredLocale;
    if (typeof data.avatarPath === "string" && data.avatarPath) patch["avatar_url"] = data.avatarPath;

    const { error } = await supabase.from("profiles").upsert(patch, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
