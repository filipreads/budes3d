import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/pricing";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { downloadInvoicePdf, type InvoiceOrder } from "@/lib/invoice";
import { setOrderShare } from "@/lib/share.functions";
import { listOrderDownloads, getOrderDownloadUrl, type OrderDownload } from "@/lib/downloads.functions";
import { downloadModelFile } from "@/lib/mesh-export";
import { toast } from "sonner";
import { FileText, Link2, LinkIcon, Download } from "lucide-react";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Your orders — Relievo Studio" },
      { name: "description", content: "Track your 3D portrait orders, production status and file downloads." },
      { property: "og:title", content: "Your orders — Relievo Studio" },
      { property: "og:description", content: "Portrait projects, orders and downloads in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountPage,
});

type OrderRow = {
  id: string;
  order_number: string;
  delivery_type: string;
  total_cents: number;
  payment_status: string;
  fulfilment_status: string;
  created_at: string;
  contact_email: string | null;
  line_items: unknown;
  subtotal_cents: number;
  shipping_cents: number;
  shipping_address: unknown;
  share_token: string | null;
  share_enabled: boolean;
};

function AccountPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [sharing, setSharing] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, OrderDownload[]>>({});
  const [preparing, setPreparing] = useState<string | null>(null);

  async function runDownload(entry: OrderDownload) {
    setPreparing(entry.id);
    try {
      const file = await getOrderDownloadUrl({ data: { downloadId: entry.id } });
      await downloadModelFile(file.url, file.format, file.filename, file.heightMm);
    } catch {
      toast.error(t("account.downloadFailed"));
    } finally {
      setPreparing(null);
    }
  }


  async function makeInvoice(order: OrderRow) {
    await downloadInvoicePdf(order as InvoiceOrder, {
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

  async function toggleShare(order: OrderRow) {
    setSharing(order.id);
    try {
      const result = await setOrderShare({ data: { orderId: order.id, enabled: !order.share_enabled } });
      setOrders((current) =>
        current.map((entry) =>
          entry.id === order.id
            ? { ...entry, share_enabled: result.enabled, share_token: result.token ?? entry.share_token }
            : entry,
        ),
      );
      if (result.enabled && result.token) {
        const url = `${window.location.origin}/share?token=${result.token}`;
        await navigator.clipboard.writeText(url).catch(() => undefined);
        toast.success(t("account.shareCopied"));
      } else {
        toast.success(t("account.shareStopped"));
      }
    } catch {
      toast.error(t("account.shareFail"));
    } finally {
      setSharing(null);
    }
  }

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("orders")
      .select(
        "id, order_number, delivery_type, total_cents, payment_status, fulfilment_status, created_at, contact_email, line_items, subtotal_cents, shipping_cents, shipping_address, share_token, share_enabled",
      )
      .order("created_at", { ascending: false })
      .then(({ data }) => setOrders((data ?? []) as OrderRow[]));
  }, [user]);

  // Files are only listed for paid orders; the server re-checks payment before signing a URL.
  useEffect(() => {
    const paid = orders.filter((order) => order.payment_status === "paid");
    if (paid.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        paid.map(async (order) => {
          try {
            return [order.id, await listOrderDownloads({ data: { orderId: order.id } })] as const;
          } catch {
            return [order.id, [] as OrderDownload[]] as const;
          }
        }),
      );
      if (!cancelled) setDownloads(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [orders]);

  if (!loading && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 py-20 text-center">
          <h1 className="font-display text-2xl">{t("account.signIn")}</h1>
          <Button className="mt-6" onClick={() => void navigate({ to: "/auth", search: { redirect: "/account" } })}>
            {t("nav.signin")}
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12">
        <h1 className="font-display text-3xl">{t("account.title")}</h1>
        {orders.length === 0 ? (
          <Card className="mt-6">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">{t("account.empty")}</p>
              <Button asChild className="mt-5">
                <Link to="/editor">{t("account.create")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-6 space-y-3">
            {orders.map((order) => (
              <Card key={order.id}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-display text-lg">{order.order_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {order.delivery_type === "print" ? t("account.printed") : t("account.digital")} ·{" "}
                        {new Date(order.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-right">
                        <p className="font-semibold">{formatPrice(order.total_cents)}</p>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {t(`status.${order.payment_status}` as TranslationKey)} ·{" "}
                          {t(`status.${order.fulfilment_status}` as TranslationKey)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {order.payment_status !== "paid" ? (
                          <Button size="sm" onClick={() => setPaying(paying === order.id ? null : order.id)}>
                            {paying === order.id ? t("account.payCancel") : t("account.pay")}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="secondary" onClick={() => void makeInvoice(order)}>
                          <FileText className="mr-1.5 size-3.5" />
                          {t("account.invoice")}
                        </Button>
                        <Button
                          size="sm"
                          variant={order.share_enabled ? "outline" : "secondary"}
                          disabled={sharing === order.id}
                          onClick={() => void toggleShare(order)}
                        >
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
                    </div>
                  </div>

                  {paying === order.id ? (
                    <div className="mt-4 border-t border-border pt-4">
                      <OrderCheckout
                        orderId={order.id}
                        returnUrl={`${window.location.origin}/checkout-return?order=${order.id}`}
                      />
                    </div>
                  ) : null}

                  {(downloads[order.id]?.length ?? 0) > 0 ? (
                    <div className="mt-4 border-t border-border pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("account.downloads")}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {downloads[order.id]!.map((entry) => (
                          <Button
                            key={entry.id}
                            size="sm"
                            variant="secondary"
                            disabled={preparing === entry.id}
                            onClick={() => void runDownload(entry)}
                          >
                            <Download className="mr-1.5 size-3.5" />
                            {preparing === entry.id
                              ? t("account.preparing")
                              : `${t("account.download")} ${entry.format.toUpperCase()}`}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
