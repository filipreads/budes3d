import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type Locale, type TranslationKey } from "@/lib/i18n";

const NAV: { to: "/" | "/pricing" | "/editor"; labelKey: TranslationKey }[] = [
  { to: "/", labelKey: "nav.home" },
  { to: "/pricing", labelKey: "nav.pricing" },
  { to: "/editor", labelKey: "nav.studio" },
];

function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="flex items-center gap-1 rounded-full border border-border p-0.5" aria-label={t("nav.language")}>
      {(["en", "cs"] as Locale[]).map((code) => (
        <button
          key={code}
          onClick={() => setLocale(code)}
          aria-pressed={locale === code}
          className={`rounded-full px-2 py-0.5 text-xs uppercase transition-colors ${
            locale === code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (!user) { setAdmin(false); return; }
    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => setAdmin(Boolean(data)));
  }, [user]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-sm bg-primary text-primary-foreground font-display text-lg">
            R
          </span>
          <span className="font-display text-lg tracking-tight">Relievo Studio</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-sm text-foreground" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {t(item.labelKey)}
            </Link>
          ))}
          {!loading && user ? (
            <>
              <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground">
                {t("nav.projects")}
              </Link>
              <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
                {t("nav.dashboard")}
              </Link>
              <Link to="/account" className="text-sm text-muted-foreground hover:text-foreground">
                {t("nav.account")}
              </Link>
              {admin ? (
                <>
                  <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
                    {t("nav.admin")}
                  </Link>
                  <Link to="/admin-quota" className="text-sm text-muted-foreground hover:text-foreground">
                    {t("nav.quota")}
                  </Link>
                </>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                {t("nav.signout")}
              </Button>
            </>
          ) : (
            <Link to="/auth" search={{ redirect: "" }}>
              <Button variant="ghost" size="sm">
                {t("nav.signin")}
              </Button>
            </Link>
          )}
          <LanguageSwitcher />
          <Link to="/editor">
            <Button size="sm">{t("nav.cta")}</Button>
          </Link>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher />
          <button
            className="rounded-sm border border-border p-2"
            aria-label={t("nav.menu")}
            onClick={() => setOpen((value) => !value)}
          >
            <Menu className="size-4" />
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border/70 px-5 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} onClick={() => setOpen(false)} className="text-sm">
                {t(item.labelKey)}
              </Link>
            ))}
            {user ? (
              <>
                <Link to="/projects" onClick={() => setOpen(false)} className="text-sm">
                  {t("nav.projects")}
                </Link>
                <Link to="/dashboard" onClick={() => setOpen(false)} className="text-sm">
                  {t("nav.dashboard")}
                </Link>
                <Link to="/account" onClick={() => setOpen(false)} className="text-sm">
                  {t("nav.account")}
                </Link>
                {admin ? (
                  <>
                    <Link to="/admin" onClick={() => setOpen(false)} className="text-sm">
                      {t("nav.admin")}
                    </Link>
                    <Link to="/admin-quota" onClick={() => setOpen(false)} className="text-sm">
                      {t("nav.quota")}
                    </Link>
                  </>
                ) : null}
                <button className="text-left text-sm text-muted-foreground" onClick={() => void signOut()}>
                  {t("nav.signout")}
                </button>
              </>
            ) : (
              <Link to="/auth" search={{ redirect: "" }} onClick={() => setOpen(false)} className="text-sm">
                {t("nav.signin")}
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
