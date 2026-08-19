import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { getQuotaOverview, setZeroGpuPlan, type QuotaOverview } from "@/lib/quota.functions";

export const Route = createFileRoute("/admin-quota")({
  head: () => ({
    meta: [
      { title: "TRELLIS.2 quota — Relievo Studio" },
      { name: "description", content: "Remaining ZeroGPU quota, plan switch and full generation history." },
      { property: "og:title", content: "TRELLIS.2 quota — Relievo Studio" },
      { property: "og:description", content: "Monitor GPU quota and reconstruction history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QuotaPage,
});

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function QuotaPage() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<QuotaOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getQuotaOverview();
      setData(result);
      setState("ready");
    } catch {
      setState("denied");
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) { setState("denied"); return; }
    void load();
  }, [user, loading, load]);

  async function switchPlan(plan: "free" | "pro") {
    setBusy(true);
    try {
      const result = await setZeroGpuPlan({ data: { plan } });
      toast.success(
        result.requeued
          ? t("quota.switchedRequeued", { count: String(result.requeued) })
          : t("quota.switched"),
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("admin.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (state === "denied") {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 py-20 text-center">
          <h1 className="font-display text-2xl">{t("admin.denied")}</h1>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const pct = data ? Math.min(100, Math.round((data.usedSeconds / Math.max(1, data.quotaSeconds)) * 100)) : 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">{t("quota.title")}</h1>
            <p className="mt-2 text-muted-foreground">{t("quota.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-2 size-4" />
              {t("dash.refresh")}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin">{t("admin.title")}</Link>
            </Button>
          </div>
        </div>

        {!data ? (
          <p className="mt-8 text-muted-foreground">{t("admin.loading")}</p>
        ) : (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <Card>
                <CardContent className="p-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("quota.plan")}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Zap className="size-4 text-primary" />
                    <span className="font-display text-2xl uppercase">{data.plan}</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      variant={data.plan === "free" ? "default" : "outline"}
                      disabled={busy}
                      onClick={() => void switchPlan("free")}
                    >
                      {t("quota.free")}
                    </Button>
                    <Button
                      size="sm"
                      variant={data.plan === "pro" ? "default" : "outline"}
                      disabled={busy}
                      onClick={() => void switchPlan("pro")}
                    >
                      {t("quota.pro")}
                    </Button>
                  </div>
                  {data.hfAccount ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("quota.hfAccount")}: {data.hfAccount}
                      {data.hfIsPro ? " · PRO" : ""}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardContent className="p-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("quota.remaining")}</p>
                  <p className="mt-2 font-display text-3xl">{fmt(data.remainingSeconds)}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${pct > 90 ? "bg-destructive" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("quota.used")}: {fmt(data.usedSeconds)} / {fmt(data.quotaSeconds)} · {t("quota.runs")}:{" "}
                    {data.runs24h}
                    {data.quotaBlocked ? ` · ${t("quota.blocked")}: ${data.quotaBlocked}` : ""}
                  </p>
                </CardContent>
              </Card>
            </div>

            <h2 className="mt-10 font-display text-2xl">{t("quota.history")}</h2>
            <div className="mt-4 space-y-2">
              {data.history.length === 0 ? (
                <p className="text-muted-foreground">{t("projects.empty")}</p>
              ) : (
                data.history.map((row) => (
                  <Card key={row.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(row.startedAt ?? row.createdAt).toLocaleString()} · {row.stage ?? "—"} ·{" "}
                          {row.progress}%{row.plan ? ` · ${row.plan}` : ""}
                        </p>
                        {row.error ? (
                          <p className="mt-1 break-words text-xs text-destructive">{row.error}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {row.seconds ? fmt(row.seconds) : "—"}
                        </span>
                        <Badge
                          variant={
                            row.status === "failed"
                              ? "destructive"
                              : row.status === "quota_blocked"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {row.status === "quota_blocked" ? t("quota.blocked") : row.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
