import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Download, LayoutGrid, Package, Settings, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { PaymentTestModeBanner } from "@/components/payments/PaymentTestModeBanner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useI18n, type TranslationKey } from "@/lib/i18n";

type TabPath = "/account" | "/account/orders" | "/account/downloads" | "/account/settings";

const TABS: { to: TabPath; labelKey: TranslationKey; icon: typeof LayoutGrid }[] = [
  { to: "/account", labelKey: "account.tabs.overview", icon: LayoutGrid },
  { to: "/account/orders", labelKey: "account.tabs.orders", icon: Package },
  { to: "/account/downloads", labelKey: "account.tabs.downloads", icon: Download },
  { to: "/account/settings", labelKey: "account.tabs.settings", icon: Settings },
];

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PaymentTestModeBanner />
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}

export function AccountShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { profile } = useProfile();
  const { t } = useI18n();
  const navigate = useNavigate();

  if (loading) {
    return (
      <Frame>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
          <div className="h-16 w-64 animate-pulse rounded-lg bg-muted" />
          <div className="mt-6 h-64 animate-pulse rounded-xl bg-muted" />
        </main>
      </Frame>
    );
  }

  if (!user) {
    return (
      <Frame>
        <main className="mx-auto w-full max-w-md flex-1 px-5 py-20 text-center">
          <h1 className="font-display text-2xl">{t("account.signIn")}</h1>
          <Button className="mt-6" onClick={() => void navigate({ to: "/auth", search: { redirect: "/account" } })}>
            {t("nav.signin")}
          </Button>
        </main>
      </Frame>
    );
  }

  const name = profile?.displayName || profile?.email || "";

  return (
    <Frame>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
            ) : (
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-muted font-display text-lg">
                {(name || "?").charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl leading-tight">{name || t("nav.account")}</h1>
              <p className="truncate text-sm text-muted-foreground">{profile?.email}</p>
            </div>
          </div>
          <Button asChild size="sm">
            <Link to="/editor">
              <Sparkles className="mr-1.5 size-4" />
              {t("account.newPortrait")}
            </Link>
          </Button>
        </header>

        <div className="mt-7 gap-8 md:flex">
          <nav
            className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 md:mx-0 md:w-52 md:shrink-0 md:flex-col md:overflow-visible md:px-0"
            aria-label={t("nav.account")}
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  activeOptions={{ exact: tab.to === "/account" }}
                  className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:w-full"
                  activeProps={{
                    className: "bg-muted font-medium text-foreground",
                  }}
                >
                  <Icon className="size-4" aria-hidden />
                  {t(tab.labelKey)}
                </Link>
              );
            })}
          </nav>
          <div className="mt-5 min-w-0 flex-1 md:mt-0">{children}</div>
        </div>
      </main>
    </Frame>
  );
}
