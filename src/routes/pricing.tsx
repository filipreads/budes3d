import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check } from "lucide-react";
import {
  BASES,
  DIGITAL_CENTS,
  ENGRAVING_CENTS,
  FINISHES,
  MATERIALS,
  RUSH_RATE,
  SHIPPING_CENTS,
  SIZES,
  formatPrice,
} from "@/lib/pricing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Relievo Studio 3D portraits" },
      {
        name: "description",
        content:
          "Transparent pricing for 3D portrait files and printed busts: sizes, materials, finishes, plinths, engraving and rush production.",
      },
      { property: "og:title", content: "Pricing — Relievo Studio 3D portraits" },
      { property: "og:description", content: "Digital 3D files and hand-finished printed portrait sculptures." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-14">
        <h1 className="font-display text-4xl">Pricing</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Every order includes the 3D reconstruction, unlimited regenerations before approval, and the digital
          files. Printed pieces add material, finishing and shipping.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <Card className="border-border/80">
            <CardContent className="p-7">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Digital</p>
              <p className="mt-3 font-display text-4xl">{formatPrice(DIGITAL_CENTS)}</p>
              <p className="mt-1 text-sm text-muted-foreground">per portrait</p>
              <ul className="mt-6 space-y-2 text-sm">
                {["Watertight GLB and STL files", "Print-ready mesh, 4K sculpt detail", "Personal and commercial use", "Instant download after payment"].map(
                  (item) => (
                    <li key={item} className="flex gap-2">
                      <Check className="mt-0.5 size-4 text-primary" /> {item}
                    </li>
                  ),
                )}
              </ul>
              <Button asChild className="mt-7 w-full">
                <Link to="/editor">Start a digital portrait</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-primary/40 bg-card">
            <CardContent className="p-7">
              <p className="text-xs uppercase tracking-[0.22em] text-primary">Printed sculpture</p>
              <p className="mt-3 font-display text-4xl">from {formatPrice(SIZES[0].cents)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                includes the digital files · {formatPrice(SHIPPING_CENTS)} shipping
              </p>
              <ul className="mt-6 space-y-2 text-sm">
                {SIZES.map((size) => (
                  <li key={size.id} className="flex justify-between border-b border-border/60 pb-1.5">
                    <span>
                      {size.label} — {size.heightMm}mm tall
                    </span>
                    <span className="text-muted-foreground">{formatPrice(size.cents)}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-7 w-full">
                <Link to="/editor">Configure a printed piece</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          <PriceTable title="Materials" rows={MATERIALS.map((m) => [m.label, `×${m.multiplier}`])} />
          <PriceTable title="Finishes" rows={FINISHES.map((f) => [f.label, `×${f.multiplier}`])} />
          <PriceTable
            title="Add-ons"
            rows={[
              ...BASES.filter((base) => base.cents > 0).map((base) => [base.label, formatPrice(base.cents)] as [string, string]),
              ["Engraved inscription", formatPrice(ENGRAVING_CENTS)],
              ["Rush production (5 days)", `+${Math.round(RUSH_RATE * 100)}%`],
            ]}
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function PriceTable({ title, rows }: { title: string; rows: (readonly [string, string])[] }) {
  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="font-display text-xl">{title}</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <li key={label} className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="text-muted-foreground">{value}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
