import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getOrderPaymentState } from "@/lib/payments.functions";
import { formatPrice, sanitizeCurrency } from "@/lib/pricing";


export const Route = createFileRoute("/checkout-return")({
  head: () => ({
    meta: [
      { title: "Payment result — Relievo Studio" },
      { name: "description", content: "Confirmation of your Relievo Studio 3D portrait payment." },
      { property: "og:title", content: "Payment result — Relievo Studio" },
      { property: "og:description", content: "Confirmation of your Relievo Studio 3D portrait payment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { order?: string | undefined } => ({
    order: typeof search["order"] === "string" ? search["order"] : undefined,
  }),
  component: CheckoutReturnPage,
});

function CheckoutReturnPage() {
  const { order } = Route.useSearch();
  const [state, setState] = useState<{ order_number: string; payment_status: string; total_cents: number; currency: string } | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void getOrderPaymentState({ data: { orderId: order } })
          .then((row) => {
            if (cancelled) return;
            setState(row as never);
            if (row.payment_status !== "paid" && tries < 10) setTries((n) => n + 1);
          })
          .catch(() => setState(null));
      },
      tries === 0 ? 0 : 2000,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [order, tries]);

  const paid = state?.payment_status === "paid";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg flex-1 px-5 py-16">
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            {paid ? (
              <CheckCircle2 className="mx-auto size-10 text-primary" />
            ) : (
              <Loader2 className="mx-auto size-10 animate-spin text-muted-foreground" />
            )}
            <h1 className="font-display text-2xl">
              {paid ? "Payment received" : "Confirming your payment…"}
            </h1>
            {state ? (
              <p className="text-sm text-muted-foreground">
                {state.order_number} · {formatPrice(state.total_cents, sanitizeCurrency(state.currency))}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {paid
                ? "Your receipt is on its way and your downloads are unlocked in your account."
                : "This can take a few seconds while your payment is verified."}
            </p>
            <Link to="/account">
              <Button className="mt-2">Go to my orders</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
