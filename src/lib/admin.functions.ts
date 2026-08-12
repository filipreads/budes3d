import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminOrder = {
  id: string;
  order_number: string;
  delivery_type: string;
  total_cents: number;
  payment_status: string;
  fulfilment_status: string;
  contact_email: string | null;
  created_at: string;
  project_id: string | null;
  model_url: string | null;
  customer_name: string | null;
  line_items: { label: string; cents: number }[];
};

export type AdminEmail = {
  id: string;
  to_email: string;
  template: string;
  subject: string;
  status: string;
  created_at: string;
};

export const isAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { admin: data === true };
  });

export const listAdminOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ orders: AdminOrder[]; emails: AdminEmail[] }> => {
    const { data: admin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (admin !== true) throw new Error("Forbidden");

    const { data: orders, error } = await context.supabase
      .from("orders")
      .select(
        "id, order_number, delivery_type, total_cents, payment_status, fulfilment_status, contact_email, created_at, project_id, line_items, user_id",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const projectIds = (orders ?? []).map((order) => order.project_id).filter((id): id is string => Boolean(id));
    const userIds = [...new Set((orders ?? []).map((order) => order.user_id))];

    const [{ data: projects }, { data: profiles }, { data: emails }] = await Promise.all([
      projectIds.length
        ? context.supabase.from("projects").select("id, model_url").in("id", projectIds)
        : Promise.resolve({ data: [] as { id: string; model_url: string | null }[] }),
      userIds.length
        ? context.supabase.from("profiles").select("id, display_name").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
      context.supabase
        .from("order_emails")
        .select("id, to_email, template, subject, status, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const modelById = new Map((projects ?? []).map((p) => [p.id, p.model_url]));
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

    return {
      orders: (orders ?? []).map((order) => ({
        id: order.id,
        order_number: order.order_number,
        delivery_type: order.delivery_type,
        total_cents: order.total_cents,
        payment_status: order.payment_status,
        fulfilment_status: order.fulfilment_status,
        contact_email: order.contact_email,
        created_at: order.created_at,
        project_id: order.project_id,
        model_url: order.project_id ? (modelById.get(order.project_id) ?? null) : null,
        customer_name: nameById.get(order.user_id) ?? null,
        line_items: Array.isArray(order.line_items) ? (order.line_items as { label: string; cents: number }[]) : [],
      })),
      emails: (emails ?? []) as AdminEmail[],
    };
  });

type UpdateInput = {
  orderId: string;
  paymentStatus?: string;
  fulfilmentStatus?: string;
  locale?: "en" | "cs";
};

const PAYMENT_STATES = ["pending", "paid", "refunded"];
const FULFILMENT_STATES = ["new", "in_production", "shipped", "delivered", "cancelled"];

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateInput) => {
    if (!input?.orderId) throw new Error("orderId required");
    if (input.paymentStatus && !PAYMENT_STATES.includes(input.paymentStatus)) throw new Error("Invalid payment status");
    if (input.fulfilmentStatus && !FULFILMENT_STATES.includes(input.fulfilmentStatus))
      throw new Error("Invalid production status");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: admin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (admin !== true) throw new Error("Forbidden");

    const patch: { payment_status?: string; fulfilment_status?: string } = {};
    if (data.paymentStatus) patch.payment_status = data.paymentStatus;
    if (data.fulfilmentStatus) patch.fulfilment_status = data.fulfilmentStatus;

    const { data: order, error } = await context.supabase
      .from("orders")
      .update(patch)
      .eq("id", data.orderId)
      .select("id, order_number, delivery_type, total_cents, payment_status, fulfilment_status, contact_email")
      .single();
    if (error || !order) throw new Error(error?.message ?? "Could not update the order");

    if (order.contact_email) {
      const { sendOrderEmail } = await import("./email.server");
      await sendOrderEmail({
        orderId: order.id,
        toEmail: order.contact_email,
        locale: data.locale === "cs" ? "cs" : "en",
        template: "status",
        orderNumber: order.order_number,
        deliveryType: order.delivery_type,
        totalCents: order.total_cents,
        paymentStatus: order.payment_status,
        fulfilmentStatus: order.fulfilment_status,
      });
    }

    return { ok: true, paymentStatus: order.payment_status, fulfilmentStatus: order.fulfilment_status };
  });
