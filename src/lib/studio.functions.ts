import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { quote, sanitizeConfig, type StudioConfig } from "./pricing";
import type { Json } from "@/integrations/supabase/types";

/** Signed URL for a stored model file, used by the 3D viewer. */
export const getModelUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storagePath: string }) => {
    if (!input?.storagePath) throw new Error("storagePath required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: signed, error } = await supabase.storage
      .from("portrait-models")
      .createSignedUrl(data.storagePath, 60 * 60);
    if (error || !signed?.signedUrl) throw new Error("Could not open the model file");
    return { url: signed.signedUrl };
  });

/**
 * Deletes a project and its stored files. Projects that already back an order
 * are kept, so invoicing and paid downloads never lose their source.
 */
export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => {
    if (!input?.projectId) throw new Error("projectId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: project } = await supabase
      .from("projects")
      .select("id, source_photos, model_url")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    const { data: linkedOrders } = await supabase
      .from("orders")
      .select("order_number")
      .eq("project_id", project.id)
      .limit(1);
    if (linkedOrders && linkedOrders.length > 0) {
      return {
        deleted: false as const,
        blockedByOrder: linkedOrders[0]!.order_number,
      };
    }

    const photos = Array.isArray(project.source_photos)
      ? (project.source_photos as unknown[]).filter((entry): entry is string => typeof entry === "string")
      : [];
    if (photos.length > 0) await supabase.storage.from("portrait-uploads").remove(photos);
    if (project.model_url) await supabase.storage.from("portrait-models").remove([project.model_url]);

    const { error } = await supabase.from("projects").delete().eq("id", project.id).eq("user_id", userId);
    if (error) throw new Error(error.message);

    return { deleted: true as const, blockedByOrder: null };
  });


type OrderInput = {
  projectId: string;
  config: StudioConfig;
  contactEmail: string;
  locale?: "en" | "cs";
  shippingAddress: {
    name: string;
    line1: string;
    line2: string;
    city: string;
    postalCode: string;
    country: string;
  } | null;
};

export const createOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: OrderInput) => {
    if (!input?.projectId) throw new Error("projectId required");
    if (!input?.contactEmail?.includes("@")) throw new Error("A valid email is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: project, error } = await supabase
      .from("projects")
      .select("id, model_url, status")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .single();
    if (error || !project) throw new Error("Project not found");
    if (!project.model_url) throw new Error("Generate and approve a 3D preview first");

    // Prices are always recomputed server-side from the sanitized config.
    const config = sanitizeConfig(data.config);
    const priced = quote(config);
    if (config.delivery === "print" && !data.shippingAddress?.line1) {
      throw new Error("A shipping address is required for printed pieces");
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        project_id: project.id,
        delivery_type: config.delivery,
        config_snapshot: config as unknown as Json,
        line_items: priced.lineItems as unknown as Json,
        subtotal_cents: priced.subtotalCents,
        shipping_cents: priced.shippingCents,
        total_cents: priced.totalCents,
        contact_email: data.contactEmail,
        shipping_address: (config.delivery === "print" ? data.shippingAddress : null) as unknown as Json,
      })
      .select("*")
      .single();
    if (orderError || !order) throw new Error(orderError?.message ?? "Could not create order");

    await supabase
      .from("projects")
      .update({ status: "ordered", approved_at: new Date().toISOString(), config: config as unknown as Json })
      .eq("id", project.id)
      .eq("user_id", userId);

    await supabase.from("order_downloads").insert([
      {
        order_id: order.id,
        user_id: userId,
        label: "3D model (GLB)",
        file_format: "glb",
        storage_path: project.model_url,
      },
      {
        order_id: order.id,
        user_id: userId,
        label: "Print-ready mesh (STL)",
        file_format: "stl",
        storage_path: project.model_url,
      },
    ]);

    const { sendOrderEmail } = await import("./email.server");
    await sendOrderEmail({
      orderId: order.id,
      toEmail: data.contactEmail,
      locale: data.locale === "cs" ? "cs" : "en",
      template: "receipt",
      orderNumber: order.order_number,
      deliveryType: order.delivery_type,
      totalCents: order.total_cents,
      currency: order.currency,
      lineItems: priced.lineItems,
    });

    return { orderId: order.id, orderNumber: order.order_number, totalCents: order.total_cents };
  });

/**
 * Payment boundary. No payment provider is configured yet (no Stripe secret),
 * so nothing in the app may mark an order as paid. The order stays `pending`
 * and the customer is told payment is not available — never a fake receipt.
 */
export const startPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; locale?: "en" | "cs" }) => {
    if (!input?.orderId) throw new Error("orderId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: order } = await supabase
      .from("orders")
      .select("id, order_number, payment_status")
      .eq("id", data.orderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!order) throw new Error("Order not found");

    const secret = process.env["STRIPE_SECRET_KEY"];
    if (!secret) {
      // Explicit, honest state: the order exists and is unpaid.
      return {
        status: "unconfigured" as const,
        orderNumber: order.order_number,
        checkoutUrl: null,
        message:
          "Online payment is not switched on yet. Your order is saved as unpaid — our team will contact you with payment details.",
      };
    }

    // Integration point: create a Stripe Checkout Session here and return its
    // URL. `payment_status` must only ever be set to `paid` by the verified
    // Stripe webhook route, never by this function or by the browser.
    throw new Error("Stripe checkout is not wired up yet");
  });

export const removeBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { imageDataUrl: string }) => {
    if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("An image is required");
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image",
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Remove the background completely and place the person on a plain solid neutral studio background. Keep the subject, pose, lighting and facial detail exactly as they are.",
              },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
      }),
    });

    if (response.status === 429) throw new Error("Too many requests right now — try again in a moment.");
    if (response.status === 402) throw new Error("AI credits exhausted. Add credits to keep retouching.");
    if (!response.ok) throw new Error(`Background removal failed (${response.status})`);

    const payload = (await response.json()) as {
      choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    };
    const url = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new Error("The model did not return an image");
    return { imageDataUrl: url };
  });
