import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { formatPrice } from "@/lib/pricing";
import { getAccountSummary } from "@/lib/account.functions";
import { useProfile } from "@/hooks/useProfile";

export const Route = createFileRoute("/account/")({
  head: () => ({
    meta: [
      { title: "Account overview — Relievo Studio" },
      { name: "description", content: "Your portrait orders, projects and downloads at a glance." },
      { property: "og:title", content: "Account overview — Relievo Studio" },
      { property: "og:description", content: "Orders, projects and downloads in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountOverview,
});

function AccountOverview() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t } = useI18n();

  const { data, isLoading } = useQuery({
    queryKey: ["account-summary", user?.id],
    queryFn: () => getAccountSummary(),
    enabled: Boolean(user),
    staleTime: 60 * 1000,
  });

  const stats: { key: TranslationKey; value: number }[] = [
    { key: "account.stats.orders", value: data?.totals.orders ?? 0 },
    { key: "account.stats.awaiting", value: data?.totals.awaitingPayment ?? 0 },
    { key: "account.stats.production", value: data?.totals.inProduction ?? 0 },
    { key: "account.stats.downloads", value: data?.totals.downloads ?? 0 },
    { key: "account.stats.projects", value: data?.totals.projects ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {profile?.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <span className="grid size-12 place-items-center rounded-full bg-muted font-display text-lg">
            {(profile?.displayName || profile?.email || "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div>
          <p className="font-display text-xl">
            {t("account.hello", { name: profile?.displayName || profile?.email || "" })}
          </p>
          <p className="text-sm text-muted-foreground">{profile?.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.key}>
            <CardContent className="p-4">
              <p className="font-display text-2xl">{isLoading ? "—" : stat.value}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{t(stat.key)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg">{t("account.latestOrders")}</h2>
              <Button asChild size="sm" variant="ghost">
                <Link to="/account/orders">{t("account.viewAll")}</Link>
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {(data?.latestOrders ?? []).map((order) => (
                <div key={order.id} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium">{order.order_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`status.${order.payment_status}` as TranslationKey)} ·{" "}
                      {t(`status.${order.fulfilment_status}` as TranslationKey)}
                    </p>
                  </div>
                  <span>{formatPrice(order.total_cents)}</span>
                </div>
              ))}
              {!isLoading && (data?.latestOrders ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("account.empty")}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg">{t("account.latestProjects")}</h2>
              <Button asChild size="sm" variant="ghost">
                <Link to="/projects">{t("account.viewAll")}</Link>
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {(data?.latestProjects ?? []).map((project) => (
                <div key={project.id} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium">{project.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(project.created_at).toLocaleDateString()} · {project.status}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/editor" search={{ project: project.id }}>
                      {t("projects.open")}
                    </Link>
                  </Button>
                </div>
              ))}
              {!isLoading && (data?.latestProjects ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("projects.empty")}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 p-5">
          <Button asChild>
            <Link to="/editor">{t("account.newPortrait")}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/projects">{t("nav.projects")}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/contact">{t("account.support")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
