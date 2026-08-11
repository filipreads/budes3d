import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import heroBust from "@/assets/hero-bust.jpg";
import { ArrowRight, Camera, Layers, Sparkles, Truck } from "lucide-react";
import { formatPrice, DIGITAL_CENTS, SIZES } from "@/lib/pricing";

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
  { icon: Camera, title: "Upload a portrait", body: "One clear, front-facing photo is all the studio needs." },
  { icon: Sparkles, title: "Retouch & frame", body: "Crop, straighten, soften skin and clear the background." },
  { icon: Layers, title: "Reconstruct in 3D", body: "Our image-to-3D engine sculpts a full volumetric bust." },
  { icon: Truck, title: "Download or print", body: "Take the GLB/STL files, or have the piece cast and shipped." },
];

function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-border">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-16 md:grid-cols-2 md:py-24">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Photo → sculpture</p>
              <h1 className="mt-4 font-display text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
                Your photograph, carved into a three-dimensional portrait.
              </h1>
              <p className="mt-5 max-w-md text-base text-muted-foreground">
                Upload one portrait. The studio reconstructs it as a sculpted 3D bust you can spin, approve, and
                take home — as a file, or cast in resin, marble or bronze.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link to="/editor">
                    Open the studio <ArrowRight className="ml-1.5 size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/pricing">See pricing</Link>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Digital files from {formatPrice(DIGITAL_CENTS)} · printed pieces from {formatPrice(SIZES[0].cents)}
              </p>
            </div>
            <div className="relative">
              <img
                src={heroBust}
                alt="Ivory resin portrait bust on a walnut plinth in a dark studio"
                width={1408}
                height={1056}
                className="w-full rounded-xl border border-border object-cover shadow-2xl"
              />
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl">Four steps, about ten minutes</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <Card key={step.title} className="bg-card/70">
                <CardContent className="p-5">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                    <step.icon className="size-4" />
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">Step {index + 1}</p>
                  <h3 className="mt-1 font-display text-lg">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-stone-deep">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-16 md:grid-cols-3">
            {[
              { title: "Studio-grade reconstruction", body: "Volumetric geometry with clean topology, ready for printing or animation." },
              { title: "Approve before you pay", body: "Rotate, relight and inspect the sculpture in the browser. Regenerate free until it's right." },
              { title: "Materials that last", body: "Resin, cast marble, polished bronze or full-colour sandstone, mounted on walnut or marble." },
            ].map((item) => (
              <div key={item.title}>
                <h3 className="font-display text-xl">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-4xl px-5 py-20 text-center">
          <h2 className="font-display text-3xl sm:text-4xl">Start with a single photograph</h2>
          <p className="mt-3 text-muted-foreground">No account needed to try the editor — sign in when you order.</p>
          <Button asChild size="lg" className="mt-7">
            <Link to="/editor">
              Create your portrait <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
