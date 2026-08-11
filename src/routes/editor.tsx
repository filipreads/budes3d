import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import ModelStage from "@/components/studio/ModelStage";
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
import { generateModel, removeBackground } from "@/lib/studio.functions";
import { Loader2, Upload } from "lucide-react";

export const Route = createFileRoute("/editor")({
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

type Step = "upload" | "retouch" | "preview" | "configure";

function EditorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("upload");
  const [photo, setPhoto] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditSettings>(DEFAULT_EDITS);
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_CONFIG);
  const [modelRef, setModelRef] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const priced = useMemo(() => quote(config), [config]);

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result));
      setEdits(DEFAULT_EDITS);
      setModelRef(null);
      setStep("retouch");
    };
    reader.readAsDataURL(file);
  }

  async function clearBackground() {
    if (!photo) return;
    setBusy("Clearing the background…");
    try {
      const baked = await renderEdited(photo, edits);
      const dataUrl = await blobToDataUrl(baked);
      const result = await removeBackground({ data: { imageDataUrl: dataUrl } });
      setPhoto(result.imageDataUrl);
      setEdits({ ...DEFAULT_EDITS, removedBackground: true });
      toast.success("Background cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clear the background");
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (!photo) return;
    if (!user) {
      void navigate({ to: "/auth", search: { redirect: "/editor" } });
      return;
    }
    setBusy("Sculpting your portrait…");
    try {
      const baked = await renderEdited(photo, edits);
      const path = `${user.id}/${crypto.randomUUID()}.jpg`;
      const upload = await supabase.storage.from("portrait-uploads").upload(path, baked, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (upload.error) throw new Error(upload.error.message);

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

      const result = await generateModel({ data: { projectId: project.id } });
      setModelRef(result.modelRef);
      sessionStorage.setItem("relievo:project", project.id);
      setStep("preview");
      toast.success("Your 3D portrait is ready");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  }

  function goToCheckout() {
    const projectId = sessionStorage.getItem("relievo:project");
    if (!projectId) { toast.error("Generate a portrait first"); return; }
    sessionStorage.setItem("relievo:config", JSON.stringify(config));
    void navigate({ to: "/checkout" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">
        <h1 className="font-display text-3xl">Portrait studio</h1>
        <ol className="mt-4 flex flex-wrap gap-2 text-xs">
          {(["upload", "retouch", "preview", "configure"] as Step[]).map((item, index) => (
            <li
              key={item}
              className={`rounded-full border px-3 py-1 capitalize ${
                step === item ? "border-primary text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {index + 1}. {item}
            </li>
          ))}
        </ol>

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
                  <span className="text-sm">Click to upload a portrait photograph</span>
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
                  <h2 className="font-display text-xl">Retouch & frame</h2>
                  <SliderRow label="Zoom" value={edits.zoom * 100} min={80} max={220} onChange={(v) => setEdits({ ...edits, zoom: v / 100 })} />
                  <SliderRow label="Straighten" value={edits.rotation} min={-20} max={20} onChange={(v) => setEdits({ ...edits, rotation: v })} />
                  <SliderRow label="Brightness" value={edits.brightness} min={60} max={150} onChange={(v) => setEdits({ ...edits, brightness: v })} />
                  <SliderRow label="Contrast" value={edits.contrast} min={60} max={160} onChange={(v) => setEdits({ ...edits, contrast: v })} />
                  <SliderRow label="Warmth" value={edits.warmth} min={-40} max={60} onChange={(v) => setEdits({ ...edits, warmth: v })} />
                  <SliderRow label="Skin smoothing" value={edits.smoothing} min={0} max={100} onChange={(v) => setEdits({ ...edits, smoothing: v })} />
                  <Button variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void clearBackground()}>
                    Clear background with AI
                  </Button>
                  <Button className="w-full" disabled={Boolean(busy)} onClick={() => void generate()}>
                    {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    {busy ?? "Generate 3D portrait"}
                  </Button>
                </>
              ) : null}

              {step === "upload" ? (
                <>
                  <h2 className="font-display text-xl">Upload</h2>
                  <p className="text-sm text-muted-foreground">
                    Use a sharp, front-facing photo with even light. Faces filling most of the frame reconstruct best.
                  </p>
                </>
              ) : null}

              {step === "preview" ? (
                <>
                  <h2 className="font-display text-xl">Approve the sculpture</h2>
                  <p className="text-sm text-muted-foreground">
                    Spin the model, change the lighting and inspect the mesh. Regenerate as often as you like.
                  </p>
                  <Button variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void generate()}>
                    Regenerate
                  </Button>
                  <Button className="w-full" onClick={() => setStep("configure")}>
                    Approve & choose product
                  </Button>
                </>
              ) : null}

              {step === "configure" ? (
                <>
                  <h2 className="font-display text-xl">Product details</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {(["print", "digital"] as const).map((delivery) => (
                      <Button
                        key={delivery}
                        variant={config.delivery === delivery ? "default" : "outline"}
                        onClick={() => setConfig({ ...config, delivery })}
                      >
                        {delivery === "print" ? "Printed piece" : "Digital file"}
                      </Button>
                    ))}
                  </div>

                  {config.delivery === "print" ? (
                    <>
                      <ChoiceRow
                        label="Size"
                        options={SIZES.map((s) => ({ id: s.id, label: `${s.label} · ${s.heightMm}mm` }))}
                        value={config.sizeId}
                        onChange={(id) => setConfig({ ...config, sizeId: id as StudioConfig["sizeId"] })}
                      />
                      <ChoiceRow
                        label="Material"
                        options={MATERIALS.map((m) => ({ id: m.id, label: m.label }))}
                        value={config.materialId}
                        onChange={(id) => setConfig({ ...config, materialId: id as StudioConfig["materialId"] })}
                      />
                      <ChoiceRow
                        label="Finish"
                        options={FINISHES.map((f) => ({ id: f.id, label: f.label }))}
                        value={config.finishId}
                        onChange={(id) => setConfig({ ...config, finishId: id as StudioConfig["finishId"] })}
                      />
                      <ChoiceRow
                        label="Plinth"
                        options={BASES.map((b) => ({ id: b.id, label: b.label }))}
                        value={config.baseId}
                        onChange={(id) => setConfig({ ...config, baseId: id as StudioConfig["baseId"] })}
                      />
                    </>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="engraving">Engraving (optional)</Label>
                    <Input
                      id="engraving"
                      maxLength={40}
                      value={config.engraving}
                      onChange={(event) => setConfig({ ...config, engraving: event.target.value })}
                      placeholder="Name, date or short line"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="rush">Rush production (5 days)</Label>
                    <Switch id="rush" checked={config.rush} onCheckedChange={(rush) => setConfig({ ...config, rush })} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="qty">Quantity</Label>
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
                      <span>Total</span>
                      <span>{formatPrice(priced.totalCents)}</span>
                    </div>
                  </div>

                  <Button className="w-full" onClick={goToCheckout}>
                    Continue to checkout
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
