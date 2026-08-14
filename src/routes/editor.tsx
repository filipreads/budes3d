import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import ModelStage from "@/components/studio/ModelStage";
import { StudioProgress, type StageId, type StageState } from "@/components/studio/StudioProgress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_EDITS, cssFilter, renderEdited, blobToDataUrl, type EditSettings } from "@/lib/image-edits";
import {
  BASES,
  DEFAULT_CONFIG,
  FINISHES,
  MATERIALS,
  SIZES,
  formatPrice,
  quote,
  type StudioConfig,
} from "@/lib/pricing";
import { generateModel, getGenerationStatus, removeBackground } from "@/lib/studio.functions";

const STAGE_LABEL: Record<string, string> = {
  queued: "Waiting for a free GPU slot…",
  preprocessing: "Preparing the portrait…",
  sculpting: "Sculpting the 3D geometry…",
  extracting: "Extracting the mesh and textures…",
  storing: "Saving your model…",
};

import { Loader2, Upload } from "lucide-react";

export const Route = createFileRoute("/editor")({
  validateSearch: (search: Record<string, unknown>) => ({ project: String(search["project"] ?? "") }),
  head: () => ({
    meta: [
      { title: "Portrait studio editor — Relievo Studio" },
      {
        name: "description",
        content: "Upload a portrait, retouch it, generate a 3D sculpture and configure size, material and finish.",
      },
      { property: "og:title", content: "Portrait studio editor — Relievo Studio" },
      { property: "og:description", content: "Turn a photo into an approved 3D portrait in minutes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditorPage,
});

type Step = StageId;

function EditorPage() {
  const navigate = useNavigate();
  const { project: projectParam } = Route.useSearch();
  const { user } = useAuth();
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("upload");
  const [photo, setPhoto] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditSettings>(DEFAULT_EDITS);
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_CONFIG);
  const [modelRef, setModelRef] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const priced = useMemo(() => quote(config), [config]);

  // Reopening a saved project from "My studio projects".
  useEffect(() => {
    if (!projectParam || !user) return;
    let cancelled = false;
    void supabase
      .from("projects")
      .select("id, config, model_url, status")
      .eq("id", projectParam)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        sessionStorage.setItem("relievo:project", data.id);
        if (data.config && typeof data.config === "object") {
          setConfig(sanitizeConfig(data.config as unknown as StudioConfig));
        }
        if (data.model_url) {
          setModelRef(data.model_url);
          setStep("preview");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectParam, user]);

  const stageStates = useMemo<Record<StageId, StageState>>(() => {
    const order: StageId[] = ["upload", "retouch", "preview", "configure"];
    const activeIndex = order.indexOf(step);
    const map = {} as Record<StageId, StageState>;
    order.forEach((stage, index) => {
      if (failure && stage === (modelRef ? step : "preview")) { map[stage] = "error"; return; }
      if (index < activeIndex) { map[stage] = "done"; return; }
      if (index === activeIndex) {
        map[stage] = busy ? "active" : stage === "configure" && modelRef ? "done" : "active";
        return;
      }
      map[stage] = "pending";
    });
    if (photo) map.upload = "done";
    if (modelRef && step !== "preview") map.preview = "done";
    return map;
  }, [step, busy, photo, modelRef, failure]);

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error(t("editor.toast.imageOnly")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result));
      setEdits(DEFAULT_EDITS);
      setModelRef(null);
      setFailure(null);
      setStep("retouch");
    };
    reader.readAsDataURL(file);
  }

  async function clearBackground() {
    if (!photo) return;
    setFailure(null);
    setBusy(t("editor.busy.background"));
    setProgress(35);
    try {
      const baked = await renderEdited(photo, edits);
      const dataUrl = await blobToDataUrl(baked);
      const result = await removeBackground({ data: { imageDataUrl: dataUrl } });
      setPhoto(result.imageDataUrl);
      setEdits({ ...DEFAULT_EDITS, removedBackground: true });
      toast.success(t("editor.toast.bgDone"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("editor.toast.bgFail");
      setFailure(message);
      toast.error(message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function generate() {
    if (!photo) return;
    if (!user) {
      void navigate({ to: "/auth", search: { redirect: "/editor" } });
      return;
    }
    setFailure(null);
    setBusy(t("editor.busy.upload"));
    setProgress(20);
    try {
      const baked = await renderEdited(photo, edits);
      const path = `${user.id}/${crypto.randomUUID()}.jpg`;
      const upload = await supabase.storage.from("portrait-uploads").upload(path, baked, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (upload.error) throw new Error(upload.error.message);

      setProgress(45);
      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          title: "Portrait sculpture",
          source_photos: [path],
          edit_settings: edits as unknown as Json,
          config: config as unknown as Json,
          status: "generating",
        })
        .select("id")
        .single();
      if (error || !project) throw new Error(error?.message ?? "Could not save the project");

      setBusy(t("editor.busy.generate"));
      setProgress(50);

      // TRELLIS runs for minutes: poll the project row so the studio progress
      // bar reflects the real preprocess → sculpt → extract → store stages.
      const poll = setInterval(() => {
        void getGenerationStatus({ data: { projectId: project.id } })
          .then((status) => {
            if (typeof status.progress === "number" && status.progress > 0) setProgress(status.progress);
            if (status.stage && status.stage !== "ready") setBusy(STAGE_LABEL[status.stage] ?? t("editor.busy.generate"));
          })
          .catch(() => undefined);
      }, 3000);

      try {
        const result = await generateModel({ data: { projectId: project.id } });
        setBusy(t("editor.busy.finalize"));
        setProgress(100);
        setModelRef(result.modelRef);
      } finally {
        clearInterval(poll);
      }
      sessionStorage.setItem("relievo:project", project.id);
      setStep("preview");
      toast.success(t("editor.toast.ready"));

    } catch (error) {
      const message = error instanceof Error ? error.message : t("editor.toast.genFail");
      setFailure(message);
      toast.error(message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function goToCheckout() {
    const projectId = sessionStorage.getItem("relievo:project");
    if (!projectId) { toast.error(t("editor.toast.generateFirst")); return; }
    sessionStorage.setItem("relievo:config", JSON.stringify(config));
    void navigate({ to: "/checkout" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">
        <h1 className="font-display text-3xl">{t("editor.title")}</h1>

        <div className="mt-5">
          <StudioProgress states={stageStates} message={busy} progress={progress} error={failure} />
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card className="min-h-[460px]">
            <CardContent className="h-full p-4">
              {step === "preview" || step === "configure" ? (
                modelRef ? (
                  <div className="h-[460px]">
                    <ModelStage
                      modelRef={modelRef}
                      materialId={config.materialId}
                      finishId={config.finishId}
                      showBase={config.baseId !== "none"}
                      canDownload
                    />
                  </div>
                ) : null
              ) : photo ? (
                <div className="flex h-[460px] items-center justify-center overflow-hidden rounded-lg bg-stone-deep">
                  <img
                    src={photo}
                    alt="Uploaded portrait preview"
                    className="max-h-full max-w-full object-contain"
                    style={{
                      filter: cssFilter(edits),
                      transform: `translate(${edits.offsetX}%, ${edits.offsetY}%) rotate(${edits.rotation}deg) scale(${edits.zoom})`,
                    }}
                  />
                </div>
              ) : (
                <label className="flex h-[460px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-muted-foreground">
                  <Upload className="size-6" />
                  <span className="text-sm">{t("editor.uploadPrompt")}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => onFile(event.target.files?.[0])}
                  />
                </label>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5 p-5">
              {step === "retouch" ? (
                <>
                  <h2 className="font-display text-xl">{t("editor.retouchHeading")}</h2>
                  <SliderRow label={t("editor.zoom")} value={edits.zoom * 100} min={80} max={220} onChange={(v) => setEdits({ ...edits, zoom: v / 100 })} />
                  <SliderRow label={t("editor.straighten")} value={edits.rotation} min={-20} max={20} onChange={(v) => setEdits({ ...edits, rotation: v })} />
                  <SliderRow label={t("editor.brightness")} value={edits.brightness} min={60} max={150} onChange={(v) => setEdits({ ...edits, brightness: v })} />
                  <SliderRow label={t("editor.contrast")} value={edits.contrast} min={60} max={160} onChange={(v) => setEdits({ ...edits, contrast: v })} />
                  <SliderRow label={t("editor.warmth")} value={edits.warmth} min={-40} max={60} onChange={(v) => setEdits({ ...edits, warmth: v })} />
                  <SliderRow label={t("editor.smoothing")} value={edits.smoothing} min={0} max={100} onChange={(v) => setEdits({ ...edits, smoothing: v })} />
                  <Button variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void clearBackground()}>
                    {t("editor.clearBackground")}
                  </Button>
                  <Button className="w-full" disabled={Boolean(busy)} onClick={() => void generate()}>
                    {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    {busy ?? t("editor.generate")}
                  </Button>
                </>
              ) : null}

              {step === "upload" ? (
                <>
                  <h2 className="font-display text-xl">{t("editor.uploadHeading")}</h2>
                  <p className="text-sm text-muted-foreground">{t("editor.uploadHint")}</p>
                </>
              ) : null}

              {step === "preview" ? (
                <>
                  <h2 className="font-display text-xl">{t("editor.previewHeading")}</h2>
                  <p className="text-sm text-muted-foreground">{t("editor.previewBody")}</p>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-semibold">{t("editor.downloads")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("editor.downloadsBody")}</p>
                  </div>
                  <Button variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void generate()}>
                    {t("editor.regenerate")}
                  </Button>
                  <Button className="w-full" onClick={() => setStep("configure")}>
                    {t("editor.approve")}
                  </Button>
                </>
              ) : null}

              {step === "configure" ? (
                <>
                  <h2 className="font-display text-xl">{t("editor.configureHeading")}</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {(["print", "digital"] as const).map((delivery) => (
                      <Button
                        key={delivery}
                        variant={config.delivery === delivery ? "default" : "outline"}
                        onClick={() => setConfig({ ...config, delivery })}
                      >
                        {delivery === "print" ? t("editor.printed") : t("editor.digital")}
                      </Button>
                    ))}
                  </div>

                  {config.delivery === "print" ? (
                    <>
                      <ChoiceRow
                        label={t("editor.size")}
                        options={SIZES.map((s) => ({ id: s.id, label: `${s.label} · ${s.heightMm}mm` }))}
                        value={config.sizeId}
                        onChange={(id) => setConfig({ ...config, sizeId: id as StudioConfig["sizeId"] })}
                      />
                      <ChoiceRow
                        label={t("editor.material")}
                        options={MATERIALS.map((m) => ({ id: m.id, label: m.label }))}
                        value={config.materialId}
                        onChange={(id) => setConfig({ ...config, materialId: id as StudioConfig["materialId"] })}
                      />
                      <ChoiceRow
                        label={t("editor.finish")}
                        options={FINISHES.map((f) => ({ id: f.id, label: f.label }))}
                        value={config.finishId}
                        onChange={(id) => setConfig({ ...config, finishId: id as StudioConfig["finishId"] })}
                      />
                      <ChoiceRow
                        label={t("editor.plinth")}
                        options={BASES.map((b) => ({ id: b.id, label: b.label }))}
                        value={config.baseId}
                        onChange={(id) => setConfig({ ...config, baseId: id as StudioConfig["baseId"] })}
                      />
                    </>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="engraving">{t("editor.engraving")}</Label>
                    <Input
                      id="engraving"
                      maxLength={40}
                      value={config.engraving}
                      onChange={(event) => setConfig({ ...config, engraving: event.target.value })}
                      placeholder={t("editor.engravingPlaceholder")}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="rush">{t("editor.rush")}</Label>
                    <Switch id="rush" checked={config.rush} onCheckedChange={(rush) => setConfig({ ...config, rush })} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="qty">{t("editor.quantity")}</Label>
                    <Input
                      id="qty"
                      type="number"
                      min={1}
                      max={25}
                      value={config.quantity}
                      onChange={(event) => setConfig({ ...config, quantity: Number(event.target.value) })}
                    />
                  </div>

                  <div className="rounded-lg border border-border p-4 text-sm">
                    {priced.lineItems.map((item) => (
                      <div key={item.label} className="flex justify-between gap-3 py-0.5">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span>{item.cents ? formatPrice(item.cents) : "—"}</span>
                      </div>
                    ))}
                    <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
                      <span>{t("editor.total")}</span>
                      <span>{formatPrice(priced.totalCents)}</span>
                    </div>
                  </div>

                  <Button className="w-full" onClick={goToCheckout}>
                    {t("editor.checkout")}
                  </Button>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <Label>{label}</Label>
        <span className="text-muted-foreground">{Math.round(value)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={1} onValueChange={([next]) => onChange(next ?? value)} />
    </div>
  );
}

function ChoiceRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={value === option.id ? "default" : "outline"}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
