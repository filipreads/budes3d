import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { quote, sanitizeConfig, type StudioConfig } from "./pricing";
import type { Json } from "@/integrations/supabase/types";

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

    const photos = Array.isArray(project.source_photos) ? (project.source_photos as string[]) : [];
    const sourcePath = photos[0];
    if (!sourcePath) throw new Error("Upload a photo before generating");

    await supabase
      .from("projects")
      .update({
        status: "generating",
        generation_error: null,
        generation_stage: "queued",
        generation_progress: 5,
        generation_started_at: new Date().toISOString(),
        preview_video_url: null,
      })
      .eq("id", project.id);

    // The Space needs a publicly fetchable image; a short-lived signed URL
    // keeps the private bucket private.
    const { data: signed, error: signError } = await supabase.storage
      .from("portrait-uploads")
      .createSignedUrl(sourcePath, 60 * 30);
    if (signError || !signed?.signedUrl) throw new Error("Could not prepare the photo for generation");

    const { runTrellis } = await import("./trellis.server");
    try {
      const result = await runTrellis({
        imageUrl: signed.signedUrl,
        seedKey: `${project.id}`,
        onProgress: async (update) => {
          await supabase
            .from("projects")
            .update({ generation_stage: update.stage, generation_progress: update.progress })
            .eq("id", project.id)
            .eq("user_id", userId);
        },
      });

      await supabase
        .from("projects")
        .update({
          generation_stage: "storing",
          generation_progress: 92,
          preview_video_url: result.previewVideoUrl,
          session_hash: result.sessionHash,
        })
        .eq("id", project.id)
        .eq("user_id", userId);

      // Persist the mesh in our own private bucket — the provider copy is temporary.
      const glbResponse = await fetch(result.glbUrl);
      if (!glbResponse.ok) throw new Error("Could not download the generated model");
      const glbBytes = new Uint8Array(await glbResponse.arrayBuffer());
      const storagePath = `${userId}/${project.id}.glb`;
      const upload = await supabase.storage.from("portrait-models").upload(storagePath, glbBytes, {
        contentType: "model/gltf-binary",
        upsert: true,
      });
      if (upload.error) throw new Error(upload.error.message);

      const { error: updateError } = await supabase
        .from("projects")
        .update({
          status: "ready",
          model_url: storagePath,
          model_provider: result.provider,
          generation_error: null,
          generation_stage: "ready",
          generation_progress: 100,
        })
        .eq("id", project.id)
        .eq("user_id", userId);
      if (updateError) throw new Error(updateError.message);

      return { modelRef: storagePath, provider: result.provider, previewVideoUrl: result.previewVideoUrl };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Generation failed";
      await supabase
        .from("projects")
        .update({
          status: "failed",
          generation_error: message,
          generation_stage: "failed",
          generation_progress: 0,
        })
        .eq("id", project.id);
      throw new Error(message);
    }
  });

/** Lightweight poll target that drives the Studio progress UI while a job runs. */
export const getGenerationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => {
    if (!input?.projectId) throw new Error("projectId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("status, generation_stage, generation_progress, generation_error, model_url, preview_video_url")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");
    return {
      status: project.status,
      stage: project.generation_stage ?? "queued",
      progress: project.generation_progress ?? 0,
      error: project.generation_error,
      modelRef: project.model_url,
      previewVideoUrl: project.preview_video_url,
    };
  });

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
      lineItems: priced.lineItems,
    });

    return { orderId: order.id, orderNumber: order.order_number, totalCents: order.total_cents };
  });

export const confirmPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; locale?: "en" | "cs" }) => {
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

    const { data: order } = await supabase
      .from("orders")
      .select("id, order_number, delivery_type, total_cents, payment_status, fulfilment_status, contact_email")
      .eq("id", data.orderId)
      .single();

    if (order?.contact_email) {
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
