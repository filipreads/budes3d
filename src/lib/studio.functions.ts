import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { quote, sanitizeConfig, type StudioConfig } from "./pricing";

type GenerateInput = { projectId: string };

/**
 * Trellis adapter boundary.
 * Today this runs the built-in sample generator. Swapping in a hosted
 * Trellis 2 endpoint (fal.ai / Replicate / self-hosted) means changing only
 * `runTrellis` in trellis.server.ts — no schema or UI changes.
 */
export const generateModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenerateInput) => {
    if (!input?.projectId) throw new Error("projectId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: project, error } = await supabase
      .from("projects")
      .select("id, source_photos, edit_settings, config")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .single();
    if (error || !project) throw new Error("Project not found");

    await supabase.from("projects").update({ status: "generating", generation_error: null }).eq("id", project.id);

    const { runTrellis } = await import("./trellis.server");
    try {
      const result = await runTrellis({
        photos: Array.isArray(project.source_photos) ? (project.source_photos as string[]) : [],
        seedKey: `${project.id}`,
      });
      const { error: updateError } = await supabase
        .from("projects")
        .update({
          status: "ready",
          model_url: result.modelRef,
          model_provider: result.provider,
          generation_error: null,
        })
        .eq("id", project.id)
        .eq("user_id", userId);
      if (updateError) throw new Error(updateError.message);
      return { modelRef: result.modelRef, provider: result.provider };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Generation failed";
      await supabase.from("projects").update({ status: "failed", generation_error: message }).eq("id", project.id);
      throw new Error(message);
    }
  });

type OrderInput = {
  projectId: string;
  config: StudioConfig;
  contactEmail: string;
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
        config_snapshot: config as unknown as Record<string, unknown>,
        line_items: priced.lineItems as unknown as Record<string, unknown>[],
        subtotal_cents: priced.subtotalCents,
        shipping_cents: priced.shippingCents,
        total_cents: priced.totalCents,
        contact_email: data.contactEmail,
        shipping_address: config.delivery === "print" ? data.shippingAddress : null,
      })
      .select("*")
      .single();
    if (orderError || !order) throw new Error(orderError?.message ?? "Could not create order");

    await supabase
      .from("projects")
      .update({ status: "ordered", approved_at: new Date().toISOString(), config: config as unknown as Record<string, unknown> })
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

    return { orderId: order.id, orderNumber: order.order_number, totalCents: order.total_cents };
  });

export const confirmPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId) throw new Error("orderId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("orders")
      .update({ payment_status: "paid", fulfilment_status: "in_production" })
      .eq("id", data.orderId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
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
