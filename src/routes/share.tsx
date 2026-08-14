import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { getSharedPreview, type SharedPreview } from "@/lib/share.functions";

const ModelStage = lazy(() => import("@/components/studio/ModelStage"));

export const Route = createFileRoute("/share")({
  validateSearch: (search: Record<string, unknown>) => ({ token: String(search["token"] ?? "") }),
  head: () => ({
    meta: [
      { title: "Shared 3D portrait preview — Relievo Studio" },
      { name: "description", content: "A view-only 3D preview of a sculpted portrait made with Relievo Studio." },
      { property: "og:title", content: "Shared 3D portrait preview — Relievo Studio" },
      { property: "og:description", content: "Rotate and inspect a sculpted 3D portrait — view only." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SharePage,
});

function SharePage() {
  const { token } = Route.useSearch();
  const { t } = useI18n();
  const [preview, setPreview] = useState<SharedPreview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (!token) {
      setState("missing");
      return;
    }
    let cancelled = false;
    void getSharedPreview({ data: { token } })
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState("missing");
          return;
        }
        setPreview(result);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12">
        <h1 className="font-display text-3xl">{t("share.title")}</h1>

        {state === "loading" ? (
          <Card className="mt-6">
            <CardContent className="p-10 text-center text-muted-foreground">…</CardContent>
          </Card>
        ) : state === "missing" ? (
          <Card className="mt-6">
            <CardContent className="p-10 text-center">
              <p className="text-muted-foreground">{t("share.notFound")}</p>
              <Button asChild className="mt-5">
                <Link to="/editor">{t("share.cta")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview?.projectTitle ?? preview?.orderNumber} · {t("share.viewOnly")}
            </p>
            <div className="mt-5 h-[480px]">
              <Suspense fallback={<div className="h-full w-full rounded-lg border border-border bg-muted" />}>
                <ModelStage
                  modelRef={preview?.orderNumber ?? "sample://shared"}
                  modelUrl={preview?.modelUrl ?? null}
                  materialId="resin"
                  finishId="satin"
                  canDownload={false}
                />
              </Suspense>
            </div>
            <div className="mt-6 text-center">
              <Button asChild>
                <Link to="/editor">{t("share.cta")}</Link>
              </Button>
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
