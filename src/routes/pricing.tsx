import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  BASES,
  DIGITAL_PRICE,
  ENGRAVING_PRICE,
  MATERIALS,
  PREMIUM_GENERATION_PRICE,
  RUSH_RATE,
  SHIPPING_PRICE,
  SIZES,
  amount,
} from "@/lib/pricing";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Relievo Studio 3D portraits" },
      {
        name: "description",
        content:
          "Transparent pricing for digital 3D portrait files and hand-finished printed busts: sizes, materials, plinths and shipping.",
      },
      { property: "og:title", content: "Pricing — Relievo Studio" },
      {
        property: "og:description",
        content: "Digital files and printed portrait busts — see every size, material and extra before you order.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/pricing" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/pricing" }],
  }),
  component: PricingPage,
});

function PricingPage() {
  const { t, money, currency } = useI18n();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <section className="surface-glow border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-5 py-14 text-center sm:py-20">
            <h1 className="text-balance-tight font-display text-3xl sm:text-5xl">{t("pricing.heroTitle")}</h1>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{t("pricing.lead")}</p>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-12 md:grid-cols-2">
          <Card className="elevate panel-edge bg-card/70">
            <CardContent className="p-6">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("pricing.digitalTag")}
              </p>
              <h2 className="mt-2 font-display text-2xl">{t("pricing.digitalTitle")}</h2>
              <p className="mt-3 font-display text-3xl">{money(amount(DIGITAL_PRICE, currency))}</p>
              <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                {["pricing.digital1", "pricing.digital2", "pricing.digital3"].map((key) => (
                  <li key={key} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {t(key as never)}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full sm:w-auto">
                <Link to="/editor">{t("pricing.cta")}</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="elevate bg-card/70">
            <CardContent className="p-6">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t("pricing.printTag")}</p>
              <h2 className="mt-2 font-display text-2xl">{t("pricing.printTitle")}</h2>
              <p className="mt-3 font-display text-3xl">
                {t("pricing.from", { price: money(amount(SIZES[0].price, currency)) })}
              </p>
              <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                {["pricing.print1", "pricing.print2", "pricing.print3"].map((key) => (
                  <li key={key} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {t(key as never)}
                  </li>
                ))}
              </ul>
              <Button asChild variant="secondary" className="mt-6 w-full sm:w-auto">
                <Link to="/editor">{t("pricing.configure")}</Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-12">
          <h2 className="font-display text-2xl">{t("pricing.sizes")}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SIZES.map((size) => (
              <Card key={size.id} className="elevate bg-card/70">
                <CardContent className="p-5">
                  <p className="font-display text-lg">{size.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{size.heightMm} mm</p>
                  <p className="mt-4 font-display text-xl">{money(amount(size.price, currency))}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-stone-deep">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-12 md:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl">{t("pricing.materials")}</h2>
              <ul className="mt-4 space-y-3">
                {MATERIALS.map((material) => (
                  <li key={material.id} className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
                    <span className="min-w-0">
                      <span className="block text-sm">{material.label}</span>
                      <span className="block text-xs text-muted-foreground">{material.hint}</span>
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      ×{material.multiplier.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-display text-2xl">{t("pricing.extras")}</h2>
              <ul className="mt-4 space-y-3 text-sm">
                {BASES.filter((base) => base.price[currency] > 0).map((base) => (
                  <li key={base.id} className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
                    <span>{base.label}</span>
                    <span className="text-muted-foreground">{money(amount(base.price, currency))}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
                  <span>{t("pricing.engraving")}</span>
                  <span className="text-muted-foreground">{money(amount(ENGRAVING_PRICE, currency))}</span>
                </li>
                <li className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
                  <span>{t("pricing.premium")}</span>
                  <span className="text-muted-foreground">
                    {money(amount(PREMIUM_GENERATION_PRICE, currency))}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
                  <span>{t("pricing.rush")}</span>
                  <span className="text-muted-foreground">+{Math.round(RUSH_RATE * 100)} %</span>
                </li>
                <li className="flex items-center justify-between gap-4">
                  <span>{t("pricing.shipping")}</span>
                  <span className="text-muted-foreground">{money(amount(SHIPPING_PRICE, currency))}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-4xl px-5 py-16 text-center">
          <div className="panel-edge surface-glow rounded-3xl px-6 py-12 sm:px-12">
            <h2 className="text-balance-tight font-display text-2xl sm:text-3xl">{t("pricing.ctaTitle")}</h2>
            <p className="mx-auto mt-3 max-w-lg text-muted-foreground">{t("pricing.note")}</p>
            <Button asChild size="lg" className="mt-7 w-full sm:w-auto">
              <Link to="/editor">
                {t("pricing.cta")} <ArrowRight className="ml-1.5 size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
