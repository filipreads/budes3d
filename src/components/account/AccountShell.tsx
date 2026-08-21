import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { PaymentTestModeBanner } from "@/components/payments/PaymentTestModeBanner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type TranslationKey } from "@/lib/i18n";

const TABS: { to: "/account" | "/account/orders" | "/account/downloads" | "/account/settings"; labelKey: TranslationKey }[] = [
  { to: "/account", labelKey: "account.tabs.overview" },
  { to: "/account/orders", labelKey: "account.tabs.orders" },
  { to: "/account/downloads", labelKey: "account.tabs.downloads" },
  { to: "/account/settings", labelKey: "account.tabs.settings" },
];

export function AccountShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

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
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PaymentTestModeBanner />
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <h1 className="font-display text-3xl">{t("nav.account")}</h1>
        <nav
          className="mt-5 -mx-1 flex gap-1 overflow-x-auto rounded-full border border-border p-1"
          aria-label={t("nav.account")}
        >
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.to === "/account" }}
              className="whitespace-nowrap rounded-full px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "bg-primary text-primary-foreground hover:text-primary-foreground" }}
            >
              {t(tab.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="mt-7">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
