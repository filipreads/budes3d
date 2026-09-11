/**
 * Transactional email (server-only).
 *
 * Emails are always written to `order_emails` first, then sent through Resend
 * when RESEND_API_KEY / RESEND_FROM are configured. Without a verified sender
 * domain the row simply stays `queued`, so nothing in the order flow breaks.
 */
import { formatPrice, sanitizeDisplayCurrency, type LineItem } from "./pricing";

export type EmailLocale = "en" | "cs";
export type EmailTemplate = "receipt" | "status";

type OrderEmailInput = {
  orderId: string;
  toEmail: string;
  locale: EmailLocale;
  template: EmailTemplate;
  orderNumber: string;
  deliveryType: string;
  totalCents: number;
  currency?: string;
  lineItems?: LineItem[];
  paymentStatus?: string;
  fulfilmentStatus?: string;
};

const COPY = {
  en: {
    receiptSubject: (n: string) => `Your Relievo Studio order ${n}`,
    statusSubject: (n: string) => `Update on your order ${n}`,
    hello: "Thank you for your order",
    receiptIntro: "Your 3D portrait order is confirmed. Here is your receipt.",
    statusIntro: "Here is the latest status of your order.",
    order: "Order",
    total: "Total",
    delivery: "Delivery",
    payment: "Payment",
    production: "Production",
    digital: "Digital files",
    print: "Printed sculpture",
    footer: "Relievo Studio · portrait photographs sculpted in 3D",
  },
  cs: {
    receiptSubject: (n: string) => `Vaše objednávka Relievo Studio ${n}`,
    statusSubject: (n: string) => `Aktualizace objednávky ${n}`,
    hello: "Děkujeme za vaši objednávku",
    receiptIntro: "Vaše objednávka 3D portrétu je potvrzena. Zde je účtenka.",
    statusIntro: "Zde je aktuální stav vaší objednávky.",
    order: "Objednávka",
    total: "Celkem",
    delivery: "Doručení",
    payment: "Platba",
    production: "Výroba",
    digital: "Digitální soubory",
    print: "Tištěná socha",
    footer: "Relievo Studio · portrétní fotografie vytesané do 3D",
  },
} as const;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderOrderEmail(input: OrderEmailInput): { subject: string; html: string } {
  const copy = COPY[input.locale];
  const currency = sanitizeDisplayCurrency(input.currency);
  const subject =
    input.template === "receipt" ? copy.receiptSubject(input.orderNumber) : copy.statusSubject(input.orderNumber);

  const rows = (input.lineItems ?? [])
    .map(
      (item) =>
        `<tr><td style="padding:6px 0;color:#6b6257">${escapeHtml(item.label)}</td><td align="right" style="padding:6px 0">${
          item.cents ? formatPrice(item.cents, currency) : "—"
        }</td></tr>`,
    )
    .join("");

  const statusBlock =
    input.template === "status"
      ? `<p style="margin:16px 0 0"><strong>${copy.payment}:</strong> ${escapeHtml(input.paymentStatus ?? "")}<br/>
         <strong>${copy.production}:</strong> ${escapeHtml((input.fulfilmentStatus ?? "").replaceAll("_", " "))}</p>`
      : "";

  const html = `<!doctype html><html><body style="margin:0;background:#f6f4f1;font-family:Helvetica,Arial,sans-serif;color:#1d1a17">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;margin:0 0 4px">${copy.hello}</h1>
    <p style="margin:0 0 20px;color:#6b6257">${input.template === "receipt" ? copy.receiptIntro : copy.statusIntro}</p>
    <div style="background:#fff;border:1px solid #e4ded6;border-radius:12px;padding:20px">
      <p style="margin:0 0 12px"><strong>${copy.order}:</strong> ${escapeHtml(input.orderNumber)}<br/>
      <strong>${copy.delivery}:</strong> ${input.deliveryType === "print" ? copy.print : copy.digital}</p>
      <table width="100%" style="font-size:14px;border-collapse:collapse">${rows}</table>
      <p style="margin:16px 0 0;font-size:16px"><strong>${copy.total}: ${formatPrice(input.totalCents, currency)}</strong></p>
      ${statusBlock}
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#8a8078">${copy.footer}</p>
  </div></body></html>`;

  return { subject, html };
}

export async function sendOrderEmail(input: OrderEmailInput) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { subject, html } = renderOrderEmail(input);

  const { data: row } = await supabaseAdmin
    .from("order_emails")
    .insert({
      order_id: input.orderId,
      to_email: input.toEmail,
      template: input.template,
      subject,
      body_html: html,
      locale: input.locale,
      status: "queued",
    })
    .select("id")
    .single();

  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM"];
  if (!apiKey || !from || !row) return { sent: false, queued: true };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [input.toEmail], subject, html }),
    });
    if (!response.ok) throw new Error(`Resend responded ${response.status}`);
    await supabaseAdmin
      .from("order_emails")
      .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
      .eq("id", row.id);
    return { sent: true, queued: false };
  } catch (cause) {
    await supabaseAdmin
      .from("order_emails")
      .update({ status: "failed", error: cause instanceof Error ? cause.message : "send failed" })
      .eq("id", row.id);
    return { sent: false, queued: false };
  }
}
