/**
 * Pre-print slicing preview: draws the sliced layers of the approved model on a
 * canvas, with layer height, infill and support settings and the resulting
 * estimates.
 *
 * All parsing and slicing happens in a Web Worker. The main thread only draws,
 * so dragging a slider never freezes the editor: settings changes are debounced,
 * the previously drawn layer stays on screen while a new one is computed and a
 * discreet "computing" hint shows that work is in flight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_SLICE,
  buildSlicer,
  computeStats,
  fetchLayer,
  prepareModel,
  releaseModel,
  type ModelBounds,
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

type SlicerMeta = { layerCount: number; layerHeightMm: number; bounds: ModelBounds };

export function SlicePreview({ modelUrl, heightMm, settings: external, onSettingsChange, onStats }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SliceSettings>(external ?? DEFAULT_SLICE);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<SliceStats | null>(null);
  const [slicer, setSlicer] = useState<SlicerMeta | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statsRef = useRef(onStats);
  statsRef.current = onStats;
  /** Layers already returned by the worker, so scrubbing back is instant. */
  const layersRef = useRef(new Map<number, Float32Array>());
  /** Bumped whenever the slicer is rebuilt, to drop stale worker answers. */
  const genRef = useRef(0);

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
    setReady(false);
    setSlicer(null);
    setStats(null);
    setPlaying(false);
    layersRef.current.clear();
  }, [modelUrl, heightMm]);

  // Free the parsed model when the customer leaves the print check.
  useEffect(() => () => void releaseModel().catch(() => {}), []);

  const run = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      await prepareModel(modelUrl, heightMm);
      setReady(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [modelUrl, heightMm]);

  // Statistics and the layer index are recomputed after the sliders settle.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setWorking(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const nextStats = await computeStats(settings);
          if (cancelled) return;
          setStats(nextStats);
          statsRef.current?.(nextStats);
          const meta = await buildSlicer(settings);
          if (cancelled) return;
          layersRef.current.clear();
          genRef.current += 1;
          setSlicer(meta);
        } catch {
          if (!cancelled) setFailed(true);
        } finally {
          if (!cancelled) setWorking(false);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, settings]);

  // Keep the scrub position valid when the layer count changes.
  useEffect(() => {
    if (!slicer) return;
    setCurrent((index) => (index === 0 ? Math.floor(slicer.layerCount / 2) : Math.min(index, slicer.layerCount - 1)));
  }, [slicer]);

  useEffect(() => {
    if (!playing || !slicer) return;
    const timer = setInterval(() => {
      setCurrent((index) => (index + 1) % slicer.layerCount);
    }, 90);
    return () => clearInterval(timer);
  }, [playing, slicer]);

  /** Draws the cached layers we have; missing ones are simply skipped. */
  const draw = useCallback(
    (index: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !slicer) return;
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

      const paint = (segments: Float32Array, alpha: number, lineWidth: number) => {
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
      const gap = Math.max(1, Math.round(slicer.layerCount / 200));
      for (let back = 3; back >= 1; back--) {
        const below = layersRef.current.get(index - back * gap);
        if (below) paint(below, 0.06 * (4 - back), 1);
      }
      const active = layersRef.current.get(index);
      if (active) paint(active, 1, 1.6);
      ctx.globalAlpha = 1;
    },
    [slicer],
  );

  // Request the visible layer (and a couple below it) from the worker, then draw.
  useEffect(() => {
    if (!slicer) return;
    const index = Math.min(current, slicer.layerCount - 1);
    const generation = genRef.current;
    let frame = requestAnimationFrame(() => draw(index));

    const gap = Math.max(1, Math.round(slicer.layerCount / 200));
    const wanted = [index, index - gap, index - 2 * gap, index - 3 * gap].filter(
      (i) => i >= 0 && !layersRef.current.has(i),
    );
    if (wanted.length === 0) return () => cancelAnimationFrame(frame);

    let cancelled = false;
    void (async () => {
      for (const want of wanted) {
        try {
          const layer = await fetchLayer(want);
          if (cancelled || generation !== genRef.current) return;
          if (layersRef.current.size > 400) layersRef.current.clear();
          layersRef.current.set(layer.index, layer.segments);
        } catch {
          return;
        }
      }
      if (cancelled) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => draw(index));
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [slicer, current, draw]);

  const layerZ = slicer ? (Math.min(current, slicer.layerCount - 1) + 0.5) * slicer.layerHeightMm : 0;
  const number = useMemo(() => new Intl.NumberFormat(), []);

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4" aria-hidden />
          {t("editor.slice.title")}
        </p>
        <div className="flex items-center gap-2">
          {working ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {t("editor.slice.working")}
            </span>
          ) : null}
          {slicer ? (
            <Button size="sm" variant="ghost" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
          ) : null}
        </div>
      </div>

      {!ready ? (
        <>
          <p className="text-xs text-muted-foreground">{t("editor.slice.intro")}</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
            {busy ? t("editor.slice.working") : t("editor.slice.run")}
          </Button>
        </>
      ) : null}

      {failed ? <p className="text-xs text-destructive">{t("editor.slice.failed")}</p> : null}

      {slicer ? (
        <>
          <canvas ref={canvasRef} className="h-56 w-full rounded-md bg-muted text-primary" />
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {t("editor.slice.layer")} {number.format(Math.min(current, slicer.layerCount - 1) + 1)} /{" "}
                {number.format(slicer.layerCount)}
              </span>
              <span>{layerZ.toFixed(2)} mm</span>
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
