import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import ModelStage from "@/components/studio/LazyModelStage";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { formatPrice } from "@/lib/pricing";
import { listAdminOrders, updateOrderStatus, type AdminEmail, type AdminOrder } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Orders dashboard — Relievo Studio" },
      { name: "description", content: "Manage customer 3D portrait orders, production status and model files." },
      { property: "og:title", content: "Orders dashboard — Relievo Studio" },
      { property: "og:description", content: "Internal order management for Relievo Studio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

const PAYMENT_STATES = ["pending", "paid", "refunded"] as const;
const FULFILMENT_STATES = ["new", "in_production", "shipped", "delivered", "cancelled"] as const;

function AdminPage() {
  const { user, loading } = useAuth();
  const { t, locale } = useI18n();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [emails, setEmails] = useState<AdminEmail[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");

  useEffect(() => {
    if (loading) return;
    if (!user) { setState("denied"); return; }
    listAdminOrders()
      .then((result) => {
        setOrders(result.orders);
        setEmails(result.emails);
        setState("ready");
      })
      .catch(() => setState("denied"));
  }, [user, loading]);

  async function update(order: AdminOrder, patch: { paymentStatus?: string; fulfilmentStatus?: string }) {
    try {
      const result = await updateOrderStatus({ data: { orderId: order.id, ...patch, locale } });
      setOrders((current) =>
        current.map((row) =>
          row.id === order.id
            ? { ...row, payment_status: result.paymentStatus, fulfilment_status: result.fulfilmentStatus }
            : row,
        ),
      );
      toast.success(t("admin.updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("admin.updateFailed"));
    }
  }

  if (state === "denied") {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 py-20 text-center">
          <h1 className="font-display text-2xl">{t("admin.denied")}</h1>
        </main>
      </div>
    );
  }

  const paidRevenue = orders
    .filter((order) => order.payment_status === "paid")
    .reduce((sum, order) => sum + order.total_cents, 0);
  const openOrders = orders.filter(
    (order) => order.fulfilment_status !== "delivered" && order.fulfilment_status !== "cancelled",
  ).length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12">
        <h1 className="font-display text-3xl">{t("admin.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("admin.subtitle")}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label={t("admin.allOrders")} value={String(orders.length)} />
          <Stat label={t("admin.openOrders")} value={String(openOrders)} />
          <Stat label={t("admin.revenue")} value={formatPrice(paidRevenue)} />
        </div>

        {state === "loading" ? (
          <p className="mt-8 text-sm text-muted-foreground">{t("admin.loading")}</p>
        ) : orders.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">{t("admin.empty")}</p>
        ) : (
          <div className="mt-6 space-y-3">
            {orders.map((order) => (
              <Card key={order.id}>
                <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.4fr_1fr_auto]">
                  <div>
                    <p className="font-display text-lg">{order.order_number}</p>
                    <p className="text-sm text-muted-foreground">
                      {order.customer_name ?? order.contact_email ?? "—"} ·{" "}
                      {new Date(order.created_at).toLocaleDateString()}
                    </p>
                    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      {order.line_items.map((item, index) => (
                        <li key={`${order.id}-${index}`}>{item.label}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2 text-sm">
                    <p className="font-semibold">{formatPrice(order.total_cents)}</p>
                    <StatusRow
                      label={t("admin.payment")}
                      options={PAYMENT_STATES}
                      value={order.payment_status}
                      onChange={(value) => void update(order, { paymentStatus: value })}
                    />
                    <StatusRow
                      label={t("admin.production")}
                      options={FULFILMENT_STATES}
                      value={order.fulfilment_status}
                      onChange={(value) => void update(order, { fulfilmentStatus: value })}
                    />
                  </div>

                  <div className="flex items-start">
                    {order.model_url ? (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            {t("admin.files")}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                          <DialogHeader>
                            <DialogTitle>{order.order_number}</DialogTitle>
                          </DialogHeader>
                          <div className="h-[420px]">
                            <ModelStage modelRef={order.model_url} materialId="resin" finishId="matte" canDownload />
                          </div>
                        </DialogContent>
                      </Dialog>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <h2 className="mt-12 font-display text-2xl">{t("admin.emails")}</h2>
        {emails.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("admin.emailsEmpty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <tbody>
                {emails.map((email) => (
                  <tr key={email.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">{new Date(email.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2">{email.to_email}</td>
                    <td className="px-4 py-2 text-muted-foreground">{email.subject}</td>
                    <td className="px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                      {t(`admin.email${email.status === "sent" ? "Sent" : email.status === "failed" ? "Failed" : "Queued"}` as TranslationKey)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-2xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function StatusRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={value === option ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            onClick={() => onChange(option)}
          >
            {t(`status.${option}` as TranslationKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
