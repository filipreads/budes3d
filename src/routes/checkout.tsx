import { CHECKOUT_KEY, SESSION_KEY, checkBinding, parseBinding } from "@/lib/studio-session";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_CONFIG, quote, sanitizeConfig, type LineItem, type StudioConfig } from "@/lib/pricing";
import { createOrder, getPremiumCharge } from "@/lib/studio.functions";
import { updateAccountProfile, EMPTY_SHIPPING_ADDRESS, type ShippingAddress } from "@/lib/account.functions";
import { useProfile } from "@/hooks/useProfile";
import { OrderCheckout } from "@/components/payments/OrderCheckout";
import { PaymentTestModeBanner } from "@/components/payments/PaymentTestModeBanner";

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Relievo Studio" },
      { name: "description", content: "Review your 3D portrait order, add delivery details and complete payment." },
      { property: "og:title", content: "Checkout — Relievo Studio" },
      { property: "og:description", content: "Complete your 3D portrait order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t, locale, money, currency } = useI18n();
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_CONFIG);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const { profile, refresh: refreshProfile } = useProfile();
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_SHIPPING_ADDRESS);
  const [useSaved, setUseSaved] = useState(true);
  const [saveDefault, setSaveDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    setProjectId(sessionStorage.getItem("relievo:project"));
    const stored = sessionStorage.getItem("relievo:config");
    if (stored) setConfig(sanitizeConfig(JSON.parse(stored)));
  }, []);

  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
  }, [user, email]);

  // Prefill from the saved default address unless the customer opted out.
  useEffect(() => {
    if (useSaved && profile?.shippingAddress) setAddress(profile.shippingAddress);
  }, [profile, useSaved]);

  // Premium engine runs are billed once per project, on top of the configured piece.
  const [extras, setExtras] = useState<LineItem[]>([]);
  useEffect(() => {
    if (!projectId) { setExtras([]); return; }
    let cancelled = false;
    void getPremiumCharge({ data: { projectId, currency } })
      .then((result) => { if (!cancelled) setExtras(result.lineItems as LineItem[]); })
      .catch(() => { if (!cancelled) setExtras([]); });
    return () => { cancelled = true; };
  }, [projectId, currency]);

  const priced = useMemo(() => quote(config, currency, extras), [config, currency, extras]);

  async function pay() {
    if (!projectId) { toast.error(t("checkout.startFirst")); return; }
    const binding = parseBinding(sessionStorage.getItem(CHECKOUT_KEY));
    const bindingProblem = checkBinding({ binding, sessionId: sessionStorage.getItem(SESSION_KEY), projectId });
    if (bindingProblem || !binding) { toast.error(t("editor.checkout.mismatch")); return; }
    setBusy(true);
    try {
      const order = await createOrder({
        data: {
          projectId,
          modelRef: binding.modelRef,
          config,
          contactEmail: email,
          locale,
          currency,
          shippingAddress: config.delivery === "print" ? address : null,
        },
      });
      if (config.delivery === "print" && saveDefault) {
        await updateAccountProfile({ data: { shippingAddress: address } });
        await refreshProfile();
      }
      sessionStorage.removeItem("relievo:project");
      sessionStorage.removeItem(CHECKOUT_KEY);
      setOrderId(order.orderId);
      toast.success(t("checkout.confirmed", { number: order.orderNumber }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("checkout.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 py-20 text-center">
          <h1 className="font-display text-2xl">{t("checkout.signIn")}</h1>
          <Button className="mt-6" onClick={() => void navigate({ to: "/auth", search: { redirect: "/checkout" } })}>
            {t("nav.signin")}
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PaymentTestModeBanner />
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-5 px-5 py-12 md:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardContent className="space-y-4 p-6">
            <h1 className="font-display text-2xl">{t("checkout.title")}</h1>

            {orderId ? (
              <OrderCheckout
                orderId={orderId}
                returnUrl={`${window.location.origin}/checkout-return?order=${orderId}`}
              />
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t("checkout.email")}</Label>
                  <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>

                {config.delivery === "print" ? (
                  <>
                  {profile?.shippingAddress ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={useSaved}
                        onChange={(event) => {
                          setUseSaved(event.target.checked);
                          if (!event.target.checked) setAddress(EMPTY_SHIPPING_ADDRESS);
                        }}
                      />
                      {t("checkout.useSaved")}
                    </label>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["name", "checkout.fullName"],
                        ["line1", "checkout.address"],
                        ["line2", "checkout.address2"],
                        ["city", "checkout.city"],
                        ["postalCode", "checkout.postalCode"],
                        ["country", "checkout.country"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={key}>{t(label)}</Label>
                        <Input
                          id={key}
                          value={address[key]}
                          onChange={(event) => setAddress({ ...address, [key]: event.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={saveDefault}
                      onChange={(event) => setSaveDefault(event.target.checked)}
                    />
                    {t("checkout.saveDefault")}
                  </label>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("checkout.digitalNote")}</p>
                )}

                <Button className="w-full" disabled={busy} onClick={() => void pay()}>
                  {t("checkout.pay", { price: money(priced.totalCents) })}
                </Button>
                <p className="text-xs text-muted-foreground">{t("checkout.paymentNote")}</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardContent className="p-6 text-sm">
            <h2 className="font-display text-xl">{t("checkout.summary")}</h2>
            <div className="mt-4 space-y-1">
              {priced.lineItems.map((item) => (
                <div key={item.label} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span>{item.cents ? money(item.cents) : "—"}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 pt-1">
                <span className="text-muted-foreground">{t("pricing.shipping")}</span>
                <span>{priced.shippingCents ? money(priced.shippingCents) : t("editor.shippingFree")}</span>
              </div>
            </div>
            <div className="mt-3 flex justify-between border-t border-border pt-3 font-semibold">
              <span>{t("editor.total")}</span>
              <span>{money(priced.totalCents)}</span>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
