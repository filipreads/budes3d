import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-border/70 bg-stone-deep">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="font-display text-xl">Relievo Studio</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t("footer.tagline")}</p>
        </div>
        <div>
          <p className="text-sm font-semibold">{t("footer.studio")}</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/editor" className="hover:text-foreground">
                {t("nav.cta")}
              </Link>
            </li>
            <li>
              <Link to="/pricing" className="hover:text-foreground">
                {t("nav.pricing")}
              </Link>
            </li>
            <li>
              <Link to="/account" className="hover:text-foreground">
                {t("footer.orders")}
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">{t("footer.support")}</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>hello@relievo.studio</li>
            <li>{t("footer.hours")}</li>
            <li>{t("footer.shipping")}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/70 px-5 py-5 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Relievo Studio. {t("footer.rights")}
      </div>
    </footer>
  );
}
