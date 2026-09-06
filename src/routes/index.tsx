import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import heroBust from "@/assets/hero-bust.jpg";
import { ArrowRight, Camera, Layers, Sparkles, Truck } from "lucide-react";
import { DIGITAL_PRICE, SIZES, amount } from "@/lib/pricing";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Relievo Studio — Turn a portrait photo into a 3D sculpture" },
      {
        name: "description",
        content:
          "Upload a portrait photograph, generate a sculpted 3D model in minutes, then download the file or order a hand-finished printed piece.",
      },
      { property: "og:title", content: "Relievo Studio — Portrait photos into 3D sculpture" },
      {
        property: "og:description",
        content: "Photo-to-3D portrait studio: AI reconstruction, live preview, digital files and printed busts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

const STEPS = [
  { icon: Camera, key: "home.step1" },
  { icon: Sparkles, key: "home.step2" },
  { icon: Layers, key: "home.step3" },
  { icon: Truck, key: "home.step4" },
] as const;

function LandingPage() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <section className="surface-glow relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-14 md:grid-cols-2 md:py-24">
            <div className="rise-in">
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-primary">
                <Sparkles className="size-3" aria-hidden />
                {t("home.eyebrow")}
              </p>
              <h1 className="text-balance-tight mt-5 font-display text-[2.1rem] leading-[1.05] sm:text-5xl md:text-6xl">
                {t("home.title")}
              </h1>
              <p className="mt-5 max-w-md text-base text-muted-foreground sm:text-lg">
                {t("home.subtitle")}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link to="/editor">
                    {t("home.openStudio")} <ArrowRight className="ml-1.5 size-4" />
                  </Link>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {t("home.priceLine", { digital: money(amount(DIGITAL_PRICE, currency)), print: money(amount(SIZES[0].price, currency)) })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("home.priceNote")}</p>
            </div>
            <div className="relative rise-in">
              <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-primary/15 blur-3xl" />
              <img
                src={heroBust}
                alt={t("home.heroAlt")}
                width={1408}
                height={1056}
                loading="eager"
                className="panel-edge w-full rounded-2xl object-cover"
              />
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:py-16">
          <h2 className="text-balance-tight font-display text-2xl sm:text-3xl">{t("home.stepsTitle")}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <Card key={step.key} className="elevate relative overflow-hidden bg-card/70">
                <span className="pointer-events-none absolute right-4 top-3 font-display text-4xl text-primary/10">
                  {index + 1}
                </span>
                <CardContent className="p-5">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <step.icon className="size-4.5" />
                  </div>
                  <p className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t("home.step", { n: index + 1 })}
                  </p>
                  <h3 className="mt-1 font-display text-lg">{t(`${step.key}.title` as TranslationKey)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`${step.key}.body` as TranslationKey)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-stone-deep">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-14 sm:py-16 md:grid-cols-3">
            {["home.feature1", "home.feature2", "home.feature3"].map((item) => (
              <div key={item} className="border-l-2 border-primary/40 pl-4">
                <h3 className="font-display text-xl">{t(`${item}.title` as TranslationKey)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`${item}.body` as TranslationKey)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-4xl px-5 py-16 sm:py-20">
          <div className="panel-edge surface-glow rounded-3xl px-6 py-12 text-center sm:px-12">
            <h2 className="text-balance-tight font-display text-2xl sm:text-4xl">{t("home.ctaTitle")}</h2>
            <p className="mx-auto mt-3 max-w-lg text-muted-foreground">{t("home.ctaBody")}</p>
            <Button asChild size="lg" className="mt-7 w-full sm:w-auto">
              <Link to="/editor">
                {t("home.ctaButton")} <ArrowRight className="ml-1.5 size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

