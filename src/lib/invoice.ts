import { formatPrice, sanitizeCurrency, type LineItem } from "./pricing";

export type InvoiceOrder = {
  order_number: string;
  created_at: string;
  delivery_type: string;
  contact_email: string | null;
  line_items: unknown;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency?: string | null;
  payment_status: string;
  shipping_address: unknown;
};

type Labels = {
  title: string;
  issuedTo: string;
  order: string;
  date: string;
  item: string;
  amount: string;
  subtotal: string;
  shipping: string;
  total: string;
  paid: string;
  footer: string;
};

function readLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is LineItem =>
      Boolean(entry) && typeof entry === "object" && "label" in (entry as object) && "cents" in (entry as object),
    )
    .map((entry) => ({ label: String(entry.label), cents: Number(entry.cents) || 0 }));
}

function readAddress(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const address = value as Record<string, unknown>;
  return ["name", "line1", "line2", "city", "postalCode", "country"]
    .map((key) => (typeof address[key] === "string" ? (address[key] as string).trim() : ""))
    .filter(Boolean);
}

/** Renders and downloads a PDF invoice for a single order, entirely in the browser. */
export async function downloadInvoicePdf(order: InvoiceOrder, labels: Labels) {
  const { jsPDF } = await import("jspdf");
  const currency = sanitizeCurrency(order.currency);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const left = 56;
  const right = 539;
  let y = 72;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Relievo Studio", left, y);
  doc.setFontSize(14);
  doc.text(labels.title, right, y, { align: "right" });

  y += 26;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text("hello@relievo.studio", left, y);
  doc.text(`${labels.order}: ${order.order_number}`, right, y, { align: "right" });
  y += 14;
  doc.text(`${labels.date}: ${new Date(order.created_at).toLocaleDateString()}`, right, y, { align: "right" });

  y += 34;
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.text(labels.issuedTo, left, y);
  doc.setFont("helvetica", "normal");
  y += 15;
  const addressLines = readAddress(order.shipping_address);
  const recipient = addressLines.length > 0 ? addressLines : [order.contact_email ?? ""];
  for (const line of recipient) {
    if (!line) continue;
    doc.text(line, left, y);
    y += 14;
  }
  if (addressLines.length > 0 && order.contact_email) {
    doc.text(order.contact_email, left, y);
    y += 14;
  }

  y += 16;
  doc.setDrawColor(210);
  doc.line(left, y, right, y);
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.text(labels.item, left, y);
  doc.text(labels.amount, right, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  y += 8;
  doc.line(left, y, right, y);
  y += 20;

  for (const item of readLineItems(order.line_items)) {
    doc.text(item.label, left, y, { maxWidth: 340 });
    doc.text(formatPrice(item.cents, currency), right, y, { align: "right" });
    y += 18;
  }

  y += 10;
  doc.line(left, y, right, y);
  y += 20;
  doc.text(labels.subtotal, 380, y);
  doc.text(formatPrice(order.subtotal_cents, currency), right, y, { align: "right" });
  y += 16;
  doc.text(labels.shipping, 380, y);
  doc.text(formatPrice(order.shipping_cents, currency), right, y, { align: "right" });
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(labels.total, 380, y);
  doc.text(formatPrice(order.total_cents, currency), right, y, { align: "right" });

  y += 24;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`${labels.paid}: ${order.payment_status}`, left, y);

  doc.setFontSize(9);
  doc.text(labels.footer, left, 780, { maxWidth: right - left });

  doc.save(`invoice-${order.order_number}.pdf`);
}
