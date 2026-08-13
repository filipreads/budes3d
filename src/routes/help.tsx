import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help & FAQ — Relievo Studio" },
      {
        name: "description",
        content: "Answers about 3D portrait orders, file downloads, invoices, shared previews, production and shipping.",
      },
      { property: "og:title", content: "Help & FAQ — Relievo Studio" },
      { property: "og:description", content: "Support for orders, downloads and 3D portrait production." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HelpPage,
});

const FAQ = [1, 2, 3, 4, 5, 6, 7];

function HelpPage() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14">
        <h1 className="font-display text-4xl">{t("help.title")}</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">{t("help.intro")}</p>

        <div className="mt-8 space-y-3">
          {FAQ.map((index) => (
            <Card key={index}>
              <CardContent className="p-6">
                <h2 className="font-display text-lg">{t(`help.q${index}` as TranslationKey)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`help.a${index}` as TranslationKey)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/contact">{t("help.contactCta")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/account">{t("footer.orders")}</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
