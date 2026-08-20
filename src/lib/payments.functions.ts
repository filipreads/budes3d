import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StripeEnv } from "./stripe.server";

type CheckoutResult = { clientSecret: string } | { error: string };

const input = z.object({
  orderId: z.string().uuid(),
  environment: z.enum(["sandbox", "live"]),
  returnUrl: z.string().url(),
});

/**
 * One-time Checkout session for a single portrait order.
 *
 * Every order is priced individually (material, size, add-ons, shipping), so
 * the session is built from inline `price_data` line items rather than a fixed
 * catalogue. The order is only ever marked `paid` by the verified webhook.
 */
export const createOrderCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    const { supabase, userId } = context;

    const { data: order } = await supabase
      .from("orders")
      .select("id, order_number, currency, line_items, shipping_cents, total_cents, contact_email, payment_status, delivery_type")
      .eq("id", data.orderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!order) return { error: "Order not found" };
    if (order.payment_status === "paid") return { error: "This order is already paid" };

    const { createStripeClient, getStripeErrorMessage } = await import("./stripe.server");
    const stripe = createStripeClient(data.environment as StripeEnv);
    const currency = (order.currency || "usd").toLowerCase();

    const items = (Array.isArray(order.line_items) ? order.line_items : []) as { label: string; cents: number }[];
    const lineItems = items
      .filter((item) => Number(item.cents) > 0)
      .map((item) => ({
        price_data: {
          currency,
          product_data: { name: item.label },
          unit_amount: Math.round(Number(item.cents)),
          tax_behavior: "exclusive" as const,
        },
        quantity: 1,
      }));

    if (order.shipping_cents > 0) {
      lineItems.push({
        price_data: {
          currency,
          product_data: { name: "Shipping" },
          unit_amount: order.shipping_cents,
          tax_behavior: "exclusive" as const,
        },
        quantity: 1,
      });
    }

    if (lineItems.length === 0) {
      lineItems.push({
        price_data: {
          currency,
          product_data: { name: `Order ${order.order_number}` },
          unit_amount: order.total_cents,
          tax_behavior: "exclusive" as const,
        },
        quantity: 1,
      });
    }

    const base = {
      line_items: lineItems,
      mode: "payment" as const,
      ui_mode: "embedded_page" as const,
      return_url: data.returnUrl,
      ...(order.contact_email ? { customer_email: order.contact_email } : {}),
      payment_intent_data: { description: `Relievo Studio order ${order.order_number}` },
      metadata: { orderId: order.id, orderNumber: order.order_number, userId },
    };

    try {
      let session;
      try {
        // Tax is calculated and collected by Stripe; filing stays with us.
        session = await stripe.checkout.sessions.create({ ...base, automatic_tax: { enabled: true } });
      } catch (taxError) {
        const message = getStripeErrorMessage(taxError);
        if (!/tax/i.test(message)) throw taxError;
        session = await stripe.checkout.sessions.create(base);
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("orders")
        .update({ payment_provider: "stripe", payment_reference: session.id })
        .eq("id", order.id);

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/** Poll target for the return page — reads the order state the webhook wrote. */
export const getOrderPaymentState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ orderId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: order } = await context.supabase
      .from("orders")
      .select("order_number, payment_status, fulfilment_status, total_cents, currency")
      .eq("id", data.orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!order) throw new Error("Order not found");
    return order;
  });
