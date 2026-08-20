import { createFileRoute } from "@tanstack/react-router";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

/**
 * Stripe webhook — the ONLY place an order may become `paid`.
 * Security comes from the signature check in `verifyWebhook`.
 */
async function markOrderPaid(session: any) {
  const orderId = session?.metadata?.orderId as string | undefined;
  if (!orderId) {
    console.error("Checkout session without orderId metadata", session?.id);
    return;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, delivery_type, total_cents, contact_email, payment_status, fulfilment_status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;
  if (order.payment_status === "paid") return; // idempotent

  await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "paid",
      payment_provider: "stripe",
      payment_reference: session.id ?? null,
      paid_at: new Date().toISOString(),
      fulfilment_status: order.fulfilment_status === "new" ? "in_production" : order.fulfilment_status,
    })
    .eq("id", order.id);

  const toEmail = (order.contact_email ?? session.customer_details?.email) as string | undefined;
  if (!toEmail) return;

  const { sendOrderEmail } = await import("@/lib/email.server");
  await sendOrderEmail({
    orderId: order.id,
    toEmail,
    locale: "en",
    template: "status",
    orderNumber: order.order_number,
    deliveryType: order.delivery_type,
    totalCents: order.total_cents,
    paymentStatus: "paid",
    fulfilmentStatus: "in_production",
  });
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.payment_status !== "unpaid") await markOrderPaid(session);
      break;
    }
    case "checkout.session.async_payment_succeeded":
      await markOrderPaid(event.data.object);
      break;
    case "checkout.session.async_payment_failed":
      console.error("Delayed payment failed", event.data.object?.id);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (error) {
          console.error("Webhook error:", error);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
