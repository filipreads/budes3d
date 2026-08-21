import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const { profile } = useProfile();
  const { t } = useI18n();
  const name = profile?.displayName || profile?.email || user?.email || "";
  const initial = (name || "?").charAt(0).toUpperCase();
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

          <LanguageSwitcher />

          {!loading && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-sm text-muted-foreground transition-colors hover:text-foreground">
                {profile?.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" className="size-6 rounded-full object-cover" />
                ) : (
                  <span className="grid size-6 place-items-center rounded-full bg-muted text-[11px]">{initial}</span>
                )}
                <span className="max-w-24 truncate">{profile?.displayName || t("nav.account")}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {profile?.email || user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/account">{t("nav.account")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/projects">{t("nav.projects")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/dashboard">{t("nav.dashboard")}</Link>
                </DropdownMenuItem>
                {admin ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/admin">{t("nav.admin")}</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin-quota">{t("nav.quota")}</Link>
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>{t("nav.signout")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link to="/auth" search={{ redirect: "" }}>
              <Button variant="ghost" size="sm">
                {t("nav.signin")}
              </Button>
            </Link>
          )}

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
                <div className="mt-1 border-t border-border/70 pt-3 text-xs uppercase tracking-wide text-muted-foreground">
                  {t("nav.account")}
                </div>
                <Link to="/account" onClick={() => setOpen(false)} className="text-sm">
                  {t("nav.account")}
                </Link>
                <Link to="/projects" onClick={() => setOpen(false)} className="text-sm">
                  {t("nav.projects")}
                </Link>
                <Link to="/dashboard" onClick={() => setOpen(false)} className="text-sm">
                  {t("nav.dashboard")}
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
            <Link to="/editor" onClick={() => setOpen(false)} className="mt-1">
              <Button size="sm" className="w-full">
                {t("nav.cta")}
              </Button>
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
