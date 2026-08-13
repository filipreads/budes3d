import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact support — Relievo Studio" },
      {
        name: "description",
        content: "Contact the Relievo Studio team about an order, a download, an invoice or a reprint.",
      },
      { property: "og:title", content: "Contact support — Relievo Studio" },
      { property: "og:description", content: "Studio support for orders, downloads and printed portraits." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = `Relievo support — ${String(form.get("order") || "general")}`;
    const body = `${String(form.get("name") ?? "")} <${String(form.get("email") ?? "")}>\n\n${String(
      form.get("message") ?? "",
    )}`;
    window.location.href = `mailto:hello@relievo.studio?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
    toast.success(t("contact.sent"));
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-4xl flex-1 gap-8 px-5 py-14 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <h1 className="font-display text-4xl">{t("contact.title")}</h1>
          <p className="mt-3 text-muted-foreground">{t("contact.intro")}</p>

          <Card className="mt-6">
            <CardContent className="p-6">
              <form className="space-y-4" onSubmit={onSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="name">{t("contact.name")}</Label>
                    <Input id="name" name="name" required className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="email">{t("contact.email")}</Label>
                    <Input id="email" name="email" type="email" required className="mt-1.5" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="order">{t("contact.order")}</Label>
                  <Input id="order" name="order" placeholder="ORD-XXXXXXXX" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="message">{t("contact.message")}</Label>
                  <Textarea id="message" name="message" required rows={6} className="mt-1.5" />
                </div>
                <Button type="submit">{t("contact.send")}</Button>
                {sent ? <p className="text-sm text-muted-foreground">{t("contact.sent")}</p> : null}
              </form>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 text-sm text-muted-foreground">
          <p>{t("contact.direct")}</p>
          <p>{t("contact.support")}</p>
          <p>
            <Link to="/help" className="text-foreground underline underline-offset-4">
              {t("help.title")}
            </Link>
          </p>
          <p>
            <Link to="/account" className="text-foreground underline underline-offset-4">
              {t("footer.orders")}
            </Link>
          </p>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
