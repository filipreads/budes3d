import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { ChevronDown, Download, FileText, Link2, LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatPrice, sanitizeDisplayCurrency, type LineItem } from "@/lib/pricing";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { setOrderShare } from "@/lib/share.functions";
import { ShareButtons } from "@/components/site/ShareButtons";
import { getOrderDownloadUrl, listOrderDownloads, type OrderDownload } from "@/lib/downloads.functions";
import { downloadModelFile } from "@/lib/mesh-export";
import type { AccountOrder } from "@/lib/account.functions";
import { StatusChip } from "@/components/account/StatusChip";
import { useQuery } from "@tanstack/react-query";

const OrderCheckout = lazy(() =>
  import("@/components/payments/OrderCheckout").then((module) => ({ default: module.OrderCheckout })),
);

function readLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => Boolean(entry) && typeof entry === "object" && "label" in entry && "cents" in entry)
    .map((entry) => ({ label: String((entry as LineItem).label), cents: Number((entry as LineItem).cents) || 0 }));
}

function readAddress(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const address = value as Record<string, unknown>;
  return ["name", "line1", "line2", "city", "postalCode", "country"]
    .map((key) => (typeof address[key] === "string" ? (address[key] as string).trim() : ""))
    .filter(Boolean);
}

export function OrderCard({
  order,
  onShareChange,
}: {
  order: AccountOrder;
  onShareChange?: (orderId: string, enabled: boolean, token: string | null) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [paying, setPaying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);

  const paid = order.payment_status === "paid";
  const downloadsQuery = useQuery({
    queryKey: ["order-downloads", order.id],
    queryFn: () => listOrderDownloads({ data: { orderId: order.id } }),
    enabled: expanded && paid,
    staleTime: 5 * 60 * 1000,
  });

  async function runDownload(entry: OrderDownload, formatOverride?: string) {
    const format = formatOverride ?? entry.format;
    setPreparing(`${entry.id}:${format}`);
    try {
      const file = await getOrderDownloadUrl({ data: { downloadId: entry.id } });
      const filename = file.filename.replace(/\.[a-z0-9]+$/i, `.${format}`);
      await downloadModelFile(file.url, format, filename, file.heightMm);
    } catch {
      toast.error(t("account.downloadFailed"));
    } finally {
      setPreparing(null);
    }
  }

  /** Derived formats converted in the browser from the stored GLB. */
  const glbEntry = (downloadsQuery.data ?? []).find((entry) => entry.format === "glb");
  const extraFormats = ["obj", "3mf"].filter(
    (format) => !(downloadsQuery.data ?? []).some((entry) => entry.format === format),
  );

  async function makeInvoice() {
    const { downloadInvoicePdf } = await import("@/lib/invoice");
    await downloadInvoicePdf(order, {
      title: t("invoice.title"),
      issuedTo: t("invoice.issuedTo"),
      order: t("invoice.order"),
      date: t("invoice.date"),
      item: t("invoice.item"),
      amount: t("invoice.amount"),
      subtotal: t("invoice.subtotal"),
      shipping: t("invoice.shipping"),
      total: t("invoice.total"),
      paid: t("invoice.paid"),
      footer: t("invoice.footer"),
    });
  }

  async function toggleShare() {
    setSharing(true);
    try {
      const result = await setOrderShare({ data: { orderId: order.id, enabled: !order.share_enabled } });
      onShareChange?.(order.id, result.enabled, result.token ?? order.share_token);
      if (result.enabled && result.token) {
        await navigator.clipboard
          .writeText(`${window.location.origin}/share?token=${result.token}`)
          .catch(() => undefined);
        toast.success(t("account.shareCopied"));
      } else {
        toast.success(t("account.shareStopped"));
      }
    } catch {
      toast.error(t("account.shareFail"));
    } finally {
      setSharing(false);
    }
  }

  const steps: { key: TranslationKey; done: boolean }[] = [
    { key: "account.timeline.created", done: true },
    { key: "account.timeline.paid", done: paid },
    {
      key: "account.timeline.production",
      done: ["in_production", "shipped", "delivered"].includes(order.fulfilment_status),
    },
    { key: "account.timeline.shipped", done: ["shipped", "delivered"].includes(order.fulfilment_status) },
    { key: "account.timeline.delivered", done: order.fulfilment_status === "delivered" },
  ];

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg">{order.order_number}</p>
            <p className="text-sm text-muted-foreground">
              {order.delivery_type === "print" ? t("account.printed") : t("account.digital")} ·{" "}
              {new Date(order.created_at).toLocaleDateString()}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusChip status={order.payment_status} />
              <StatusChip status={order.fulfilment_status} />
            </div>
          </div>
          <p className="font-display text-lg">{formatPrice(order.total_cents, sanitizeDisplayCurrency(order.currency))}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!paid ? (
            <Button size="sm" onClick={() => setPaying((value) => !value)}>
              {paying ? t("account.payCancel") : t("account.pay")}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            <ChevronDown className={`mr-1.5 size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            {t("account.details")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void makeInvoice()}>
            <FileText className="mr-1.5 size-3.5" />
            {t("account.invoice")}
          </Button>
          <Button size="sm" variant="ghost" disabled={sharing} onClick={() => void toggleShare()}>
            <Link2 className="mr-1.5 size-3.5" />
            {order.share_enabled ? t("account.shareOff") : t("account.share")}
          </Button>
          {order.share_enabled && order.share_token ? (
            <Button asChild size="sm" variant="ghost">
              <Link to="/share" search={{ token: order.share_token }}>
                <LinkIcon className="mr-1.5 size-3.5" />
                {t("account.viewShare")}
              </Link>
            </Button>
          ) : null}
        </div>

        {order.share_enabled && order.share_token && typeof window !== "undefined" ? (
          <ShareButtons
            className="mt-3"
            url={`${window.location.origin}/share?token=${order.share_token}`}
          />
        ) : null}


        {paying ? (
          <div className="mt-4 border-t border-border pt-4">
            <Suspense fallback={<div className="h-40 animate-pulse rounded-md bg-muted" />}>
              <OrderCheckout
                orderId={order.id}
                returnUrl={`${window.location.origin}/checkout-return?order=${order.id}`}
              />
            </Suspense>
          </div>
        ) : null}

        {expanded ? (
          <div className="mt-4 space-y-4 border-t border-border pt-4">
            <ol className="flex flex-wrap gap-x-6 gap-y-2">
              {steps.map((step) => (
                <li key={step.key} className="flex items-center gap-2 text-sm">
                  <span
                    className={`size-2 rounded-full ${step.done ? "bg-primary" : "bg-muted-foreground/30"}`}
                    aria-hidden
                  />
                  <span className={step.done ? "text-foreground" : "text-muted-foreground"}>{t(step.key)}</span>
                </li>
              ))}
            </ol>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("invoice.item")}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {readLineItems(order.line_items).map((item, index) => (
                    <li key={`${item.label}-${index}`} className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span>{formatPrice(item.cents, sanitizeDisplayCurrency(order.currency))}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-4 border-t border-border pt-1 font-medium">
                    <span>{t("invoice.total")}</span>
                    <span>{formatPrice(order.total_cents, sanitizeDisplayCurrency(order.currency))}</span>
                  </li>
                </ul>
              </div>
              {readAddress(order.shipping_address).length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("account.shippingTo")}
                  </p>
                  <address className="mt-2 space-y-0.5 text-sm not-italic text-muted-foreground">
                    {readAddress(order.shipping_address).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </address>
                </div>
              ) : null}
            </div>

            {paid ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("account.downloads")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(downloadsQuery.data ?? []).map((entry) => (
                    <Button
                      key={entry.id}
                      size="sm"
                      variant="secondary"
                      disabled={preparing === `${entry.id}:${entry.format}`}
                      onClick={() => void runDownload(entry)}
                    >
                      <Download className="mr-1.5 size-3.5" />
                      {preparing === `${entry.id}:${entry.format}`
                        ? t("account.preparing")
                        : `${t("account.download")} ${entry.format.toUpperCase()}`}
                    </Button>
                  ))}
                  {glbEntry
                    ? extraFormats.map((format) => (
                        <Button
                          key={format}
                          size="sm"
                          variant="secondary"
                          disabled={preparing === `${glbEntry.id}:${format}`}
                          onClick={() => void runDownload(glbEntry, format)}
                        >
                          <Download className="mr-1.5 size-3.5" />
                          {preparing === `${glbEntry.id}:${format}`
                            ? t("account.preparing")
                            : `${t("account.download")} ${format.toUpperCase()}`}
                        </Button>
                      ))
                    : null}
                  {downloadsQuery.isLoading ? (
                    <span className="text-sm text-muted-foreground">{t("account.preparing")}</span>
                  ) : null}
                  {!downloadsQuery.isLoading && (downloadsQuery.data ?? []).length === 0 ? (
                    <span className="text-sm text-muted-foreground">{t("account.downloadsEmpty")}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
