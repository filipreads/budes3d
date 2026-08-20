import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Generation dashboard — Relievo Studio" },
      {
        name: "description",
        content: "Live status of every portrait reconstruction: stage, progress and error details per project and order.",
      },
      { property: "og:title", content: "Generation dashboard — Relievo Studio" },
      { property: "og:description", content: "Track each 3D reconstruction stage, progress and errors in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

type Row = {
  id: string;
  title: string;
  status: string;
  generation_stage: string | null;
  generation_progress: number | null;
  generation_error: string | null;
  generation_started_at: string | null;
  model_url: string | null;
  created_at: string;
};

type OrderRow = {
  id: string;
  order_number: string;
  project_id: string | null;
  payment_status: string;
  fulfilment_status: string;
};

const STAGE_ORDER = ["queued", "preprocessing", "sculpting", "extracting", "storing", "ready"] as const;

function DashboardPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    const [projectsResult, ordersResult] = await Promise.all([
      supabase
        .from("projects")
        .select(
          "id, title, status, generation_stage, generation_progress, generation_error, generation_started_at, model_url, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("orders").select("id, order_number, project_id, payment_status, fulfilment_status").limit(100),
    ]);
    setRows((projectsResult.data ?? []) as Row[]);
    setOrders((ordersResult.data ?? []) as OrderRow[]);
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh while any job is still running.
  useEffect(() => {
    const active = rows.some((row) => row.status === "generating");
    if (!active) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [rows, load]);

  if (!loading && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 py-20 text-center">
          <h1 className="font-display text-2xl">{t("dash.signIn")}</h1>
          <Button className="mt-6" onClick={() => void navigate({ to: "/auth", search: { redirect: "/dashboard" } })}>
            {t("nav.signin")}
          </Button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">{t("dash.title")}</h1>
            <p className="mt-2 text-muted-foreground">{t("dash.subtitle")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw className={`mr-2 size-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("dash.refresh")}
          </Button>
        </div>

        {rows.length === 0 ? (
          <Card className="mt-6">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">{t("projects.empty")}</p>
              <Button asChild className="mt-5">
                <Link to="/editor">{t("nav.cta")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-6 space-y-3">
            {rows.map((row) => {
              const stage = row.generation_stage ?? (row.model_url ? "ready" : "queued");
              const pct = row.generation_progress ?? (row.model_url ? 100 : 0);
              const linked = orders.filter((order) => order.project_id === row.id);
              const quotaBlocked =
                row.status === "quota_blocked" || (!!row.generation_error && /quota/i.test(row.generation_error));
              const failed = !quotaBlocked && (row.status === "failed" || stage === "failed");
              return (
                <Card key={row.id}>
                  <CardContent className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("projects.created")}: {new Date(row.created_at).toLocaleString()}
                        </p>
                      </div>
                      <Badge
                        variant={
                          failed ? "destructive" : quotaBlocked ? "outline" : row.status === "ready" ? "default" : "secondary"
                        }
                      >
                        {quotaBlocked ? t("quota.blocked") : row.status}
                      </Badge>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-[width] duration-500 ${failed ? "bg-destructive" : "bg-primary"}`}
                          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
                    </div>

                    <ol className="mt-3 flex flex-wrap gap-1.5">
                      {STAGE_ORDER.map((name) => {
                        const index = STAGE_ORDER.indexOf(name);
                        const current = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
                        const done = current > index || stage === "ready";
                        const active = name === stage;
                        return (
                          <li
                            key={name}
                            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                              active
                                ? "border-primary/60 bg-primary/10 text-foreground"
                                : done
                                  ? "border-border bg-background text-foreground"
                                  : "border-border/60 text-muted-foreground"
                            }`}
                          >
                            {name}
                          </li>
                        );
                      })}
                    </ol>

                    {row.generation_error ? (
                      <p
                        className={`mt-3 flex items-start gap-2 rounded-md p-3 text-sm ${
                          quotaBlocked ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                        <span className="break-words">{row.generation_error}</span>
                      </p>
                    ) : null}

                    {linked.length > 0 ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {t("dash.orders")}:{" "}
                        {linked
                          .map((order) => `${order.order_number} (${order.payment_status}/${order.fulfilment_status})`)
                          .join(", ")}
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/editor" search={{ project: row.id }}>
                          {t("projects.open")}
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/account">{t("nav.account")}</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
