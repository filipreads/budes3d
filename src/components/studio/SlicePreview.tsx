/**
 * Pre-print slicing preview: draws the sliced layers of the approved model on a
 * canvas, with layer height, infill and support settings and the resulting
 * estimates. Slicing runs in the browser on the same GLB that gets exported.
 *
 * The model is parsed once; afterwards moving a slider only recomputes cheap
 * statistics and the outline of the single layer on screen, so the editor stays
 * responsive even while dragging.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_SLICE,
  computeStats,
  createSlicer,
  prepareModel,
  type LayerSlicer,
  type PreparedModel,
  type SliceSettings,
  type SliceStats,
} from "@/lib/slicing";

type Props = {
  /** Signed URL of the stored GLB. */
  modelUrl: string;
  heightMm: number;
  settings?: SliceSettings;
  onSettingsChange?: (settings: SliceSettings) => void;
  /** Reports the current estimates so the page can compare runs. */
  onStats?: (stats: SliceStats) => void;
};

export function SlicePreview({ modelUrl, heightMm, settings: external, onSettingsChange, onStats }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SliceSettings>(external ?? DEFAULT_SLICE);
  const [model, setModel] = useState<PreparedModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statsRef = useRef(onStats);
  statsRef.current = onStats;

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

  // A new model file (for example after a repair) invalidates the parse.
  useEffect(() => {
    setModel(null);
    setPlaying(false);
  }, [modelUrl, heightMm]);

  const run = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const prepared = await prepareModel(modelUrl, heightMm);
      setModel(prepared);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [modelUrl, heightMm]);

  // Statistics are a single cheap pass — recompute them on every change.
  const stats = useMemo(() => (model ? computeStats(model, settings) : null), [model, settings]);
  useEffect(() => {
    if (stats) statsRef.current?.(stats);
  }, [stats]);

  // The bucket index only depends on the layer height, so it is rebuilt rarely.
  const [slicer, setSlicer] = useState<LayerSlicer | null>(null);
  useEffect(() => {
    if (!model) {
      setSlicer(null);
      return;
    }
    let cancelled = false;
    // Defer so a fast slider drag does not rebuild the index on every frame.
    const timer = setTimeout(() => {
      if (cancelled) return;
      setSlicer(createSlicer(model, settings));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [model, settings.layerHeightMm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the scrub position valid when the layer count changes.
  useEffect(() => {
    if (!slicer) return;
    setCurrent((index) => (index === 0 ? Math.floor(slicer.layerCount / 2) : Math.min(index, slicer.layerCount - 1)));
  }, [slicer]);

  useEffect(() => {
    if (!playing || !slicer) return;
    const timer = setInterval(() => {
      setCurrent((index) => (index + 1) % slicer.layerCount);
    }, 60);
    return () => clearInterval(timer);
  }, [playing, slicer]);

  // Draw the active layer plus a few faded layers below for depth, on a frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slicer) return;
    let frame = 0;
    frame = requestAnimationFrame(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const { minX, maxX, minY, maxY } = slicer.bounds;
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
      const index = Math.min(current, slicer.layerCount - 1);
      const gap = Math.max(1, Math.round(slicer.layerCount / 200));
      for (let back = 3; back >= 1; back--) {
        const below = index - back * gap;
        if (below >= 0) draw(slicer.layer(below).segments, 0.06 * (4 - back), 1);
      }
      draw(slicer.layer(index).segments, 1, 1.6);
      ctx.globalAlpha = 1;
    });
    return () => cancelAnimationFrame(frame);
  }, [slicer, current]);

  const layer = slicer ? slicer.layer(Math.min(current, slicer.layerCount - 1)) : null;
  const number = useMemo(() => new Intl.NumberFormat(), []);

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4" aria-hidden />
          {t("editor.slice.title")}
        </p>
        {slicer ? (
          <Button size="sm" variant="ghost" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
        ) : null}
      </div>

      {!model ? (
        <>
          <p className="text-xs text-muted-foreground">{t("editor.slice.intro")}</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
            {busy ? t("editor.slice.working") : t("editor.slice.run")}
          </Button>
        </>
      ) : null}

      {failed ? <p className="text-xs text-destructive">{t("editor.slice.failed")}</p> : null}

      {slicer && layer ? (
        <>
          <canvas ref={canvasRef} className="h-56 w-full rounded-md bg-muted text-primary" />
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {t("editor.slice.layer")} {number.format(layer.index + 1)} / {number.format(slicer.layerCount)}
              </span>
              <span>{layer.zMm.toFixed(2)} mm</span>
            </div>
            <Slider
              value={[Math.min(current, slicer.layerCount - 1)]}
              min={0}
              max={Math.max(0, slicer.layerCount - 1)}
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
