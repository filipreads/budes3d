import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, PlayCircle, TriangleAlert } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { isAdmin } from "@/lib/admin.functions";
import { runTrellisSmokeStep, type SmokeState, type SmokeStep } from "@/lib/trellis-smoke.functions";

export const Route = createFileRoute("/trellis-test")({
  head: () => ({
    meta: [
      { title: "TRELLIS runtime smoke test — Relievo Studio" },
      { name: "description", content: "Run a real image-to-3D generation against the live TRELLIS.2 Space and read the logs." },
      { property: "og:title", content: "TRELLIS runtime smoke test" },
      { property: "og:description", content: "Internal diagnostics for the 3D reconstruction provider." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrellisTestPage,
});

const STEPS: SmokeStep[] = ["session", "sculpt", "extract"];
const STEP_LABEL: Record<SmokeStep, string> = {
  session: "1. Session + upload + preprocess",
  sculpt: "2. image_to_3d (GPU)",
  extract: "3. extract_glb + download",
};

function TrellisTestPage() {
  const checkAdmin = useServerFn(isAdmin);
  const runStep = useServerFn(runTrellisSmokeStep);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [current, setCurrent] = useState<SmokeStep | null>(null);
  const [failedAt, setFailedAt] = useState<SmokeStep | null>(null);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState(0);

  useEffect(() => {
    void checkAdmin()
      .then((result) => setAdmin(result.admin))
      .catch(() => setAdmin(false));
  }, [checkAdmin]);

  const run = async () => {
    setRunning(true);
    setLogs([]);
    setGlbUrl(null);
    setFailedAt(null);
    setErrorKind(null);
    setTotalMs(0);

    let state: SmokeState = {};
    let elapsed = 0;
    for (const step of STEPS) {
      setCurrent(step);
      try {
        const result = await runStep({
          data: { step, state, ...(step === "session" && imageUrl ? { imageUrl } : {}) },
        });
        elapsed += result.ms;
        setTotalMs(elapsed);
        setLogs((previous) => [...previous, `── ${STEP_LABEL[step]} ──`, ...result.logs]);
        state = result.state;
        if (!result.ok) {
          setFailedAt(step);
          setErrorKind(result.errorKind);
          break;
        }
        if (result.glbUrl) setGlbUrl(result.glbUrl);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setLogs((previous) => [...previous, `── ${STEP_LABEL[step]} ──`, `REQUEST FAILED: ${message}`]);
        setFailedAt(step);
        setErrorKind("fatal");
        break;
      }
    }
    setCurrent(null);
    setRunning(false);
  };

  if (admin === false) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 py-20 text-center">
          <h1 className="font-display text-2xl">Admins only</h1>
          <p className="mt-2 text-muted-foreground">This diagnostics page needs an admin account.</p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12">
        <h1 className="font-display text-3xl">TRELLIS runtime smoke test</h1>
        <p className="mt-2 text-muted-foreground">
          Runs a real image-to-3D generation on the live Space using the configured HF_TOKEN and ZeroGPU quota.
        </p>

        <Card className="mt-6">
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-2">
              <label htmlFor="image" className="text-sm font-medium">
                Test image URL (optional)
              </label>
              <Input
                id="image"
                placeholder="Leave empty to use the built-in sample"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
              />
            </div>

            <Button onClick={() => void run()} disabled={running || admin === null}>
              {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlayCircle className="mr-2 size-4" />}
              {running ? "Running…" : "Run smoke test"}
            </Button>

            <ol className="grid gap-2">
              {STEPS.map((step) => {
                const index = STEPS.indexOf(step);
                const failedIndex = failedAt ? STEPS.indexOf(failedAt) : -1;
                const done = failedIndex === -1 ? (current ? STEPS.indexOf(current) > index : logs.length > 0) : index < failedIndex;
                return (
                  <li key={step} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    {failedAt === step ? (
                      <TriangleAlert className="size-4 text-destructive" />
                    ) : current === step ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : done ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : (
                      <span className="size-4 rounded-full border border-border" />
                    )}
                    {STEP_LABEL[step]}
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              {totalMs > 0 ? <Badge variant="secondary">{(totalMs / 1000).toFixed(1)}s</Badge> : null}
              {errorKind ? <Badge variant="destructive">{errorKind}</Badge> : null}
              {glbUrl ? (
                <a className="text-primary underline" href={glbUrl} target="_blank" rel="noreferrer">
                  Download generated GLB
                </a>
              ) : null}
            </div>

            {logs.length > 0 ? (
              <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap">
                {logs.join("\n")}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </div>
  );
}
