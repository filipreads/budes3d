/**
 * Pre-print slicing preview: draws the sliced layers of the approved model on a
 * canvas, with layer height, infill and support settings and the resulting
 * estimates. Slicing runs in the browser on the same GLB that gets exported.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_SLICE, sliceModelUrl, type SliceResult, type SliceSettings } from "@/lib/slicing";

type Props = {
  /** Signed URL of the stored GLB. */
  modelUrl: string;
  heightMm: number;
  settings?: SliceSettings;
  onSettingsChange?: (settings: SliceSettings) => void;
};

export function SlicePreview({ modelUrl, heightMm, settings: external, onSettingsChange }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SliceSettings>(external ?? DEFAULT_SLICE);
  const [result, setResult] = useState<SliceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const update = useCallback(
    (patch: Partial<SliceSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        onSettingsChange?.(next);
        return next;
      });
    },
    [onSettingsChange],
  );

  const run = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const sliced = await sliceModelUrl(modelUrl, heightMm, settings);
      setResult(sliced);
      setCurrent(Math.floor(sliced.layers.length / 2));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [modelUrl, heightMm, settings]);

  // Re-slice when a parameter changes, but only once a first run exists.
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => void run(), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.layerHeightMm, settings.infill, settings.supports, settings.overhangDeg]);

  useEffect(() => {
    if (!playing || !result) return;
    const timer = setInterval(() => {
      setCurrent((index) => (index + 1) % result.layers.length);
    }, 60);
    return () => clearInterval(timer);
  }, [playing, result]);

  const layer = result?.layers[Math.min(current, result.layers.length - 1)] ?? null;

  // Draw the active layer plus a few faded layers below for depth.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result || !layer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { minX, maxX, minY, maxY } = result.bounds;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min(width / spanX, height / spanY) * 0.85;
    const offsetX = width / 2 - ((minX + maxX) / 2) * scale;
    const offsetY = height / 2 + ((minY + maxY) / 2) * scale;
    const px = (x: number) => offsetX + x * scale;
    const py = (y: number) => offsetY - y * scale;

    const draw = (segments: Float32Array, alpha: number, lineWidth: number) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < segments.length; i += 4) {
        ctx.moveTo(px(segments[i]!), py(segments[i + 1]!));
        ctx.lineTo(px(segments[i + 2]!), py(segments[i + 3]!));
      }
      ctx.stroke();
    };

    const styles = getComputedStyle(canvas);
    ctx.strokeStyle = styles.getPropertyValue("color") || "currentColor";
    const index = result.layers.indexOf(layer);
    for (let back = 6; back >= 1; back--) {
      const previous = result.layers[index - back];
      if (previous) draw(previous.segments, 0.08 * (7 - back) * 0.3, 1);
    }
    draw(layer.segments, 1, 1.6);
    ctx.globalAlpha = 1;
  }, [layer, result]);

  const stats = result?.stats;
  const number = useMemo(() => new Intl.NumberFormat(), []);

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4" aria-hidden />
          {t("editor.slice.title")}
        </p>
        {result ? (
          <Button size="sm" variant="ghost" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
        ) : null}
      </div>

      {!result ? (
        <>
          <p className="text-xs text-muted-foreground">{t("editor.slice.intro")}</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
            {busy ? t("editor.slice.working") : t("editor.slice.run")}
          </Button>
        </>
      ) : null}

      {failed ? <p className="text-xs text-destructive">{t("editor.slice.failed")}</p> : null}

      {result && layer ? (
        <>
          <canvas ref={canvasRef} className="h-56 w-full rounded-md bg-muted text-primary" />
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {t("editor.slice.layer")} {number.format(layer.index + 1)} / {number.format(result.stats.layerCount)}
              </span>
              <span>{layer.zMm.toFixed(2)} mm</span>
            </div>
            <Slider
              value={[Math.min(current, result.layers.length - 1)]}
              min={0}
              max={Math.max(0, result.layers.length - 1)}
              step={1}
              onValueChange={([value]) => setCurrent(value ?? 0)}
            />
          </div>
        </>
      ) : null}

      <div className="space-y-3">
        <ParamSlider
          label={t("editor.slice.layerHeight")}
          value={settings.layerHeightMm}
          min={0.05}
          max={0.3}
          step={0.05}
          format={(v) => `${v.toFixed(2)} mm`}
          onChange={(v) => update({ layerHeightMm: v })}
        />
        <ParamSlider
          label={t("editor.slice.infill")}
          value={settings.infill * 100}
          min={0}
          max={100}
          step={5}
          format={(v) => `${Math.round(v)} %`}
          onChange={(v) => update({ infill: v / 100 })}
        />
        <ParamSlider
          label={t("editor.slice.overhang")}
          value={settings.overhangDeg}
          min={20}
          max={70}
          step={5}
          format={(v) => `${Math.round(v)}°`}
          onChange={(v) => update({ overhangDeg: v })}
        />
        <div className="space-y-1.5">
          <Label className="text-xs">{t("editor.slice.supports")}</Label>
          <div className="grid grid-cols-3 gap-2">
            {(["none", "buildplate", "everywhere"] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={settings.supports === mode ? "default" : "outline"}
                onClick={() => update({ supports: mode })}
              >
                {t(`editor.slice.support.${mode}`)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {stats ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Stat label={t("editor.slice.layers")} value={number.format(stats.layerCount)} />
          <Stat label={t("editor.slice.material")} value={`${stats.materialGrams.toFixed(1)} g`} />
          <Stat label={t("editor.slice.volume")} value={`${stats.volumeCm3.toFixed(1)} cm³`} />
          <Stat
            label={t("editor.slice.time")}
            value={`${Math.floor(stats.printMinutes / 60)} h ${stats.printMinutes % 60} min`}
          />
          <Stat label={t("editor.slice.supportArea")} value={`${stats.supportAreaCm2.toFixed(1)} cm²`} />
          <Stat label={t("editor.slice.overhangShare")} value={`${Math.round(stats.overhangShare * 100)} %`} />
        </dl>
      ) : null}

      {stats?.thinWalls ? (
        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          {t("editor.slice.thinWalls")}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <Label className="text-xs">{label}</Label>
        <span className="text-muted-foreground">{format(value)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v ?? value)} />
    </div>
  );
}
