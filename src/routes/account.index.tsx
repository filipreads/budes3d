import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, Download, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/account/StatusChip";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { formatPrice } from "@/lib/pricing";
import { getAccountSummary } from "@/lib/account.functions";

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

function Section({
  title,
  actionLabel,
  action,
  children,
}: {
  title: string;
  actionLabel: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg">{title}</h2>
          <Button asChild size="sm" variant="ghost" aria-label={actionLabel}>
            {action}
          </Button>
        </div>
        <div className="mt-2 divide-y divide-border">{children}</div>
      </CardContent>
    </Card>
  );
}

function AccountOverview() {
  const { user } = useAuth();
  const { t } = useI18n();

  const { data, isLoading } = useQuery({
    queryKey: ["account-summary", user?.id],
    queryFn: () => getAccountSummary(),
    enabled: Boolean(user),
    staleTime: 60 * 1000,
  });

  const stats: { key: TranslationKey; value: number; icon: typeof Package }[] = [
    { key: "account.stats.orders", value: data?.totals.orders ?? 0, icon: Package },
    { key: "account.stats.awaiting", value: data?.totals.awaitingPayment ?? 0, icon: Clock },
    { key: "account.stats.downloads", value: data?.totals.downloads ?? 0, icon: Download },
  ];

  const orders = data?.latestOrders ?? [];
  const projects = data?.latestProjects ?? [];
  const isNew = !isLoading && orders.length === 0 && projects.length === 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (isNew) {
    return (
      <Card>
        <CardContent className="space-y-3 p-8 text-center">
          <h2 className="font-display text-xl">{t("account.emptyTitle")}</h2>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{t("account.emptyHint")}</p>
          <Button asChild>
            <Link to="/editor">{t("account.newPortrait")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("account.overviewLead")}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.key} className="transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <p className="mt-3 font-display text-2xl">{stat.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t(stat.key)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Section
        title={t("account.latestOrders")}
        actionLabel={t("account.viewAll")}
        action={<Link to="/account/orders">{t("account.viewAll")}</Link>}
      >
        {orders.map((order) => (
          <Link
            key={order.id}
            to="/account/orders"
            className="flex items-center justify-between gap-3 py-3 text-sm transition-colors hover:text-primary"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{order.order_number}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <StatusChip status={order.payment_status} />
                <StatusChip status={order.fulfilment_status} />
              </div>
            </div>
            <span className="flex items-center gap-1 font-medium">
              {formatPrice(order.total_cents)}
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </span>
          </Link>
        ))}
        {orders.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("account.empty")}</p> : null}
      </Section>

      <Section
        title={t("account.latestProjects")}
        actionLabel={t("account.viewAll")}
        action={<Link to="/projects">{t("account.viewAll")}</Link>}
      >
        {projects.map((project) => (
          <Link
            key={project.id}
            to="/editor"
            search={{ project: project.id }}
            className="flex items-center justify-between gap-3 py-3 text-sm transition-colors hover:text-primary"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{project.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusChip status={project.status} />
                <span className="text-xs text-muted-foreground">
                  {new Date(project.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        ))}
        {projects.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("projects.empty")}</p> : null}
      </Section>
    </div>
  );
}
