import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getModelUrl } from "@/lib/studio.functions";

import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Center } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import {
  Download,
  Lightbulb,
  Boxes,
  AlertTriangle,
  Maximize2,
  Minimize2,
  RotateCcw,
  Play,
  Pause,
  Gauge,
  ZoomIn,
  ZoomOut,
  Move,
  Layers,
  Magnet,
  Undo2,
  Redo2,
} from "lucide-react";

import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { BASE_GEOMETRY, DEFAULT_PLACEMENT, type Placement } from "@/lib/pricing";
import {
  placementMetrics,
  snapToGrid,
  unitsPerMm,
  formatMm,
  SNAP_STEP_MM,
  FINE_STEP_MM,
  COARSE_STEP_MM,
} from "@/lib/placement-metrics";
import {
  QUALITY_SETTINGS,
  resolveViewerQuality,
  rememberViewerQuality,
  VIEWER_QUALITY_EVENT,
  type ViewerQuality,
} from "@/lib/viewer-quality";




/** Scene floor the plinth rests on; the sculpture is placed relative to it. */
const BASE_FLOOR_Y = -1.33;

type Props = {
  modelRef: string;
  materialId: string;
  finishId: string;
  showBase?: boolean;
  /** Which plinth is ordered — drives the base size the sculpture is placed on. */
  baseId?: string;
  canDownload?: boolean;
  /** Pre-signed model URL (used by public share links, which cannot sign one). */
  modelUrl?: string | null;
  /** Manual placement of the sculpture on its plinth. */
  placement?: Placement;
  /** Ordered print height, shown as a real-world scale reference. */
  heightMm?: number | null;
  /** When provided, the sculpture and plinth can be dragged directly in the scene. */
  onPlacementChange?: (patch: Partial<Placement>) => void;
  /** Placement history, surfaced as undo/redo buttons inside the viewer. */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
};

type DragTarget = "model" | "base";
type DragState = {
  target: DragTarget;
  axis: "xz" | "y";
  origin: THREE.Vector3;
  from: Placement;
};

export default function ModelStage({
  modelRef,
  materialId,
  finishId,
  showBase = true,
  baseId = "walnut",
  canDownload = false,
  modelUrl = null,
  placement = DEFAULT_PLACEMENT,
  heightMm = null,
  onPlacementChange,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: Props) {

  void materialId;
  void finishId;
  const { t } = useI18n();
  const [wireframe, setWireframe] = useState(false);
  const [warmLight, setWarmLight] = useState(true);
  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loadPercent, setLoadPercent] = useState(0);
  const [quality, setQuality] = useState<ViewerQuality>("high");
  const [autoRotate, setAutoRotate] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<{ preset: ViewPreset; nonce: number }>({ preset: "front", nonce: 0 });
  const [zoom, setZoom] = useState<{ factor: number; nonce: number }>({ factor: 1, nonce: 0 });
  const [moveMode, setMoveMode] = useState<DragTarget | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [snap, setSnap] = useState(true);

  const shellRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const placementRef = useRef(placement);
  placementRef.current = placement;

  const editable = Boolean(onPlacementChange);
  const settings = QUALITY_SETTINGS[quality];
  const baseGeometry = BASE_GEOMETRY[baseId] ?? BASE_GEOMETRY["walnut"]!;
  const metrics = placementMetrics(placement, showBase ? baseId : "none", heightMm);

  /** Rounds a dragged coordinate onto the millimetre grid when snapping is on. */
  const grid = useCallback(
    (value: number) => (snap ? snapToGrid(value, SNAP_STEP_MM, heightMm) : value),
    [snap, heightMm],
  );

  const startDrag = useCallback(
    (target: DragTarget, event: ThreeEvent<PointerEvent>) => {
      if (!editable || moveMode !== target) return;
      event.stopPropagation();
      setAutoRotate(false);
      setDrag({
        target,
        axis: target === "model" && (event.shiftKey || event.altKey) ? "y" : "xz",
        origin: event.point.clone(),
        from: { ...placementRef.current },
      });
    },
    [editable, moveMode],
  );

  const applyDrag = useCallback(
    (state: DragState, delta: THREE.Vector3) => {
      if (!onPlacementChange) return;
      if (state.target === "model") {
        if (state.axis === "y") {
          onPlacementChange({ lift: clamp(grid(state.from.lift + delta.y), -0.5, 0.5) });
        } else {
          onPlacementChange({
            offsetX: clamp(grid((state.from.offsetX ?? 0) + delta.x), -0.6, 0.6),
            offsetZ: clamp(grid((state.from.offsetZ ?? 0) + delta.z), -0.6, 0.6),
          });
        }
      } else {
        onPlacementChange({
          baseOffsetX: clamp(grid((state.from.baseOffsetX ?? 0) + delta.x), -0.8, 0.8),
          baseOffsetZ: clamp(grid((state.from.baseOffsetZ ?? 0) + delta.z), -0.8, 0.8),
        });
      }
    },
    [onPlacementChange, grid],
  );

  // Keyboard nudging: arrows move by 1 mm, Shift+arrows by 10 mm, and while the
  // sculpture is selected PageUp/PageDown (or Shift+↑/↓ with Alt) change height.
  useEffect(() => {
    if (!editable || !moveMode || !onPlacementChange) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      const perMm = unitsPerMm(heightMm) || 0.004;
      const step = perMm * (event.shiftKey ? COARSE_STEP_MM : FINE_STEP_MM);
      const current = placementRef.current;
      const isModel = moveMode === "model";
      const x = isModel ? (current.offsetX ?? 0) : (current.baseOffsetX ?? 0);
      const z = isModel ? (current.offsetZ ?? 0) : (current.baseOffsetZ ?? 0);
      const limit = isModel ? 0.6 : 0.8;
      const move = (dx: number, dz: number) =>
        onPlacementChange!(
          isModel
            ? { offsetX: clamp(x + dx, -limit, limit), offsetZ: clamp(z + dz, -limit, limit) }
            : { baseOffsetX: clamp(x + dx, -limit, limit), baseOffsetZ: clamp(z + dz, -limit, limit) },
        );

      switch (event.key) {
        case "ArrowLeft":
          move(-step, 0);
          break;
        case "ArrowRight":
          move(step, 0);
          break;
        case "ArrowUp":
          move(0, -step);
          break;
        case "ArrowDown":
          move(0, step);
          break;
        case "PageUp":
          if (!isModel) return;
          onPlacementChange!({ lift: clamp(current.lift + step, -0.5, 0.5) });
          break;
        case "PageDown":
          if (!isModel) return;
          onPlacementChange!({ lift: clamp(current.lift - step, -0.5, 0.5) });
          break;
        default:
          return;
      }
      event.preventDefault();
      setAutoRotate(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editable, moveMode, onPlacementChange, heightMm]);




  // Manual preference wins; otherwise weak devices start in the light preset.
  useEffect(() => {
    function sync() {
      const effective = resolveViewerQuality();
      setQuality(effective);
      setAutoRotate(QUALITY_SETTINGS[effective].autoRotate);
    }
    sync();
    window.addEventListener(VIEWER_QUALITY_EVENT, sync);
    return () => window.removeEventListener(VIEWER_QUALITY_EVENT, sync);
  }, []);

  function switchQuality(next: ViewerQuality) {
    setQuality(next);
    rememberViewerQuality(next);
    if (next === "low") setAutoRotate(false);
  }


  // There is no stand-in mesh: either the real generated file loads, or the
  // customer sees an explicit error instead of an approvable placeholder.
  const hasFile = Boolean(modelUrl) || (Boolean(modelRef) && !modelRef.startsWith("sample://"));

  // Real TRELLIS output lives in private storage: resolve a signed URL, then load the GLB.
  useEffect(() => {
    if (!hasFile) {
      setLoadedScene(null);
      setLoadFailed(true);
      return;
    }
    let cancelled = false;
    setLoadedScene(null);
    setLoadFailed(false);
    setLoadPercent(0);
    void (async () => {
      try {
        const url = modelUrl ?? (await getModelUrl({ data: { storagePath: modelRef } })).url;
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const gltf = await new GLTFLoader().loadAsync(url, (event) => {
          if (!cancelled && event.total) setLoadPercent(Math.round((event.loaded / event.total) * 100));
        });
        if (cancelled) return;
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        setLoadPercent(100);
        setLoadedScene(gltf.scene);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelRef, modelUrl, hasFile, attempt]);

  // Free GPU memory when the viewer unmounts or swaps models — mobile browsers
  // drop the whole WebGL context once too many buffers pile up.
  useEffect(() => {
    if (!loadedScene) return;
    return () => {
      loadedScene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const standard = material as THREE.MeshStandardMaterial;
          standard.map?.dispose();
          standard.normalMap?.dispose();
          standard.roughnessMap?.dispose();
          standard.dispose?.();
        }
      });
    };
  }, [loadedScene]);


  useEffect(() => {
    if (!loadedScene) return;
    loadedScene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      const list = Array.isArray(material) ? material : [material];
      for (const entry of list) {
        if ("wireframe" in entry) entry.wireframe = wireframe;
      }
    });
  }, [loadedScene, wireframe]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch {
      /* fullscreen is a nice-to-have; ignore refusals */
    }
  }

  async function exportModel(format: "stl" | "glb") {
    const source: THREE.Object3D | null = loadedScene;
    if (!source) {
      toast.error(t("viewer.exportFailed"));
      return;
    }
    try {
      const target = source.clone();
      if (format === "stl") {
        const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
        const output = new STLExporter().parse(target, { binary: true }) as unknown as DataView;
        downloadBlob(new Blob([output as unknown as BlobPart], { type: "model/stl" }), "portrait.stl");
      } else {
        const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
        const buffer = await new GLTFExporter().parseAsync(target, { binary: true });
        downloadBlob(new Blob([buffer as ArrayBuffer], { type: "model/gltf-binary" }), "portrait.glb");
      }
      toast.success(`${format.toUpperCase()} ✓`);
    } catch {
      toast.error(t("viewer.exportFailed"));
    }
  }

  return (
    <div
      ref={shellRef}
      className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-stone-deep"
    >
      <Canvas
        shadows={settings.shadows}
        camera={{ position: [0, 0.4, 3.4], fov: 38 }}
        dpr={settings.dpr}
        gl={{ antialias: settings.antialias, powerPreference: "high-performance" }}
        frameloop={autoRotate ? "always" : "demand"}
      >
        <color attach="background" args={["#141311"]} />
        {/* Gallery rig: soft ambient fill, warm key, cool fill and a rim light for silhouette. */}
        <ambientLight intensity={warmLight ? 0.55 : 0.3} />
        <hemisphereLight
          intensity={warmLight ? 0.45 : 0.3}
          color={warmLight ? "#ffe8c8" : "#dce8ff"}
          groundColor="#1b1a17"
        />
        <directionalLight
          position={[3, 4, 3]}
          intensity={warmLight ? 2.4 : 1.4}
          color={warmLight ? "#ffd9a8" : "#cfe0ff"}
          castShadow={settings.shadows}
        />
        <directionalLight position={[-3, 1, -2]} intensity={0.8} color="#6d7f9c" />
        <spotLight
          position={[-1.6, 2.6, -3.2]}
          angle={0.7}
          penumbra={1}
          intensity={warmLight ? 1.5 : 1.1}
          color={warmLight ? "#fff1dd" : "#e6f0ff"}
        />
        <Suspense fallback={null}>
          <Center>
            <group>
              {/* Sculpture and plinth are transformed independently. */}
              <group
                ref={groupRef}
                rotation={[(placement.tilt * Math.PI) / 180, (placement.yaw * Math.PI) / 180, 0]}
                position={[
                  placement.offsetX ?? 0,
                  placement.lift + (baseGeometry.height - BASE_GEOMETRY["walnut"]!.height),
                  placement.offsetZ ?? 0,
                ]}
                scale={placement.scale}
                onPointerDown={(event) => startDrag("model", event)}
              >
                {loadedScene ? <primitive object={loadedScene} /> : null}
              </group>
              {showBase && loadedScene && baseGeometry.height > 0 ? (
                <group
                  position={[
                    placement.baseOffsetX ?? 0,
                    BASE_FLOOR_Y + baseGeometry.height / 2,
                    placement.baseOffsetZ ?? 0,
                  ]}
                  rotation={[0, ((placement.baseYaw ?? 0) * Math.PI) / 180, 0]}
                  onPointerDown={(event) => startDrag("base", event)}
                >
                  <mesh ref={meshRef} receiveShadow={settings.shadows} castShadow={settings.shadows}>
                    <cylinderGeometry
                      args={[
                        baseGeometry.radius,
                        baseGeometry.radius * 1.1,
                        baseGeometry.height,
                        settings.shadows ? 64 : 28,
                      ]}
                    />
                    <meshStandardMaterial
                      color={baseGeometry.color}
                      roughness={baseId === "marble" ? 0.18 : 0.55}
                      metalness={baseId === "marble" ? 0.12 : 0.05}
                    />
                  </mesh>
                  {/* Thin top plate reads as a machined bevel and catches the key light. */}
                  <mesh position={[0, baseGeometry.height / 2 + 0.006, 0]} receiveShadow={settings.shadows}>
                    <cylinderGeometry args={[baseGeometry.radius * 0.99, baseGeometry.radius * 0.99, 0.012, settings.shadows ? 64 : 28]} />
                    <meshStandardMaterial
                      color={baseGeometry.color}
                      roughness={baseId === "marble" ? 0.1 : 0.35}
                      metalness={0.18}
                    />
                  </mesh>
                </group>
              ) : null}
            </group>
          </Center>

          {settings.contactShadows ? (
            <ContactShadows position={[0, -1.4, 0]} opacity={0.55} scale={7} blur={2.6} far={4} />
          ) : null}
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan
          enabled={!drag}
          enableDamping={quality === "high"}
          minDistance={1.8}
          maxDistance={7}
          autoRotate={autoRotate}
          autoRotateSpeed={0.6}
        />
        <CameraRig preset={view.preset} nonce={view.nonce} />
        <CameraZoom factor={zoom.factor} nonce={zoom.nonce} />
        <FitCamera object={loadedScene} />
        <DragManager drag={drag} onMove={applyDrag} onEnd={() => setDrag(null)} />



      </Canvas>


      {loadFailed ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-deep/95 px-6 text-center"
        >
          <AlertTriangle className="size-6 text-destructive" aria-hidden />
          <p className="font-display text-lg text-background">{t("viewer.errorTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("viewer.errorBody")}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAttempt((n) => n + 1)}>
            {t("viewer.retry")}
          </Button>
        </div>
      ) : !loadedScene ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stone-deep/80 px-6">
          <p className="text-sm text-muted-foreground">
            {t("viewer.loading")} {loadPercent > 0 ? `${loadPercent}%` : ""}
          </p>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.max(6, loadPercent)}%` }}
              role="progressbar"
              aria-valuenow={loadPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      ) : null}

      {loadedScene ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-3">
          <div className="scroll-x pointer-events-auto flex min-w-0 flex-nowrap gap-1.5 [&>button]:shrink-0 sm:flex-wrap">

            {(["front", "angle", "side", "top"] as const).map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant="secondary"
                className="h-8 px-2.5 text-xs sm:text-sm"
                onClick={() => setView((state) => ({ preset, nonce: state.nonce + 1 }))}
              >
                {t(`viewer.view.${preset}`)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              className="h-8 w-8 p-0"
              aria-label={t("viewer.zoomIn")}
              onClick={() => setZoom((state) => ({ factor: 0.82, nonce: state.nonce + 1 }))}
            >
              <ZoomIn className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 w-8 p-0"
              aria-label={t("viewer.zoomOut")}
              onClick={() => setZoom((state) => ({ factor: 1.22, nonce: state.nonce + 1 }))}
            >
              <ZoomOut className="size-3.5" />
            </Button>

            <Button
              size="sm"
              variant="secondary"
              className="h-8 w-8 p-0"
              aria-label={t("viewer.reset")}
              onClick={() => setView((state) => ({ preset: "front", nonce: state.nonce + 1 }))}
            >
              <RotateCcw className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 w-8 p-0"
              aria-label={autoRotate ? t("viewer.pause") : t("viewer.play")}
              onClick={() => setAutoRotate((value) => !value)}
            >
              {autoRotate ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 gap-1 px-2 text-xs"
              aria-pressed={quality === "low"}
              title={t("viewer.qualityHint")}
              onClick={() => switchQuality(quality === "low" ? "high" : "low")}
            >
              <Gauge className="size-3.5" />
              {quality === "low" ? t("viewer.qualityLow") : t("viewer.qualityHigh")}
            </Button>
            {editable ? (
              <>
                <Button
                  size="sm"
                  variant={moveMode === "model" ? "default" : "secondary"}
                  className="h-8 gap-1 px-2 text-xs"
                  aria-pressed={moveMode === "model"}
                  onClick={() => setMoveMode((mode) => (mode === "model" ? null : "model"))}
                >
                  <Move className="size-3.5" />
                  {t("viewer.moveModel")}
                </Button>
                {showBase && baseGeometry.height > 0 ? (
                  <Button
                    size="sm"
                    variant={moveMode === "base" ? "default" : "secondary"}
                    className="h-8 gap-1 px-2 text-xs"
                    aria-pressed={moveMode === "base"}
                    onClick={() => setMoveMode((mode) => (mode === "base" ? null : "base"))}
                  >
                    <Layers className="size-3.5" />
                    {t("viewer.moveBase")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={snap ? "default" : "secondary"}
                  className="h-8 gap-1 px-2 text-xs"
                  aria-pressed={snap}
                  title={t("viewer.snapHint")}
                  onClick={() => setSnap((value) => !value)}
                >
                  <Magnet className="size-3.5" />
                  {snap ? t("viewer.snapOn") : t("viewer.snapOff")}
                </Button>
                {onUndo ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 w-8 p-0"
                    disabled={!canUndo}
                    aria-label={t("viewer.undo")}
                    onClick={onUndo}
                  >
                    <Undo2 className="size-3.5" />
                  </Button>
                ) : null}
                {onRedo ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 w-8 p-0"
                    disabled={!canRedo}
                    aria-label={t("viewer.redo")}
                    onClick={onRedo}
                  >
                    <Redo2 className="size-3.5" />
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              className="h-8 w-8 p-0"
              aria-label={t("viewer.fullscreen")}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </Button>
          </div>

          {heightMm ? (
            <span className="pointer-events-auto shrink-0 rounded-full border border-border/60 bg-background/85 px-3 py-1 text-xs tabular-nums text-foreground backdrop-blur">
              {t("viewer.scale").replace("{mm}", String(Math.round(heightMm * placement.scale)))}
            </span>
          ) : null}
        </div>
      ) : null}

      {loadedScene && moveMode ? (
        <div className="pointer-events-none absolute inset-x-0 top-14 flex flex-col items-center gap-1.5 px-3 sm:top-16">
          <span className="rounded-full border border-border/60 bg-background/85 px-3 py-1 text-center text-[11px] text-muted-foreground backdrop-blur">
            {moveMode === "model" ? t("viewer.moveHintModel") : t("viewer.moveHintBase")}
          </span>
          <span className="rounded-full border border-border/60 bg-background/85 px-3 py-1 text-center text-[11px] text-muted-foreground backdrop-blur">
            {t("viewer.keysHint")}
          </span>
        </div>
      ) : null}

      {/* Live measurement of how the sculpture sits on its plinth. */}
      {loadedScene && metrics.hasBase && metrics.measured ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-3 sm:bottom-14">
          <span
            className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border px-3 py-1 text-[11px] tabular-nums backdrop-blur ${
              metrics.level === "error"
                ? "border-destructive/60 bg-destructive/15 text-destructive"
                : metrics.level === "warn"
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-500"
                  : "border-border/60 bg-background/85 text-muted-foreground"
            }`}
            role="status"
          >
            <span>
              {metrics.clearanceMm < 0
                ? `${t("viewer.metric.overhang")} ${formatMm(Math.abs(metrics.clearanceMm))}`
                : `${t("viewer.metric.edge")} ${formatMm(metrics.clearanceMm)}`}
            </span>
            <span>
              {t("viewer.metric.float")} {formatMm(metrics.floatMm, true)}
            </span>
          </span>
        </div>
      ) : null}



      {loadedScene ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 p-2 sm:p-3">
          <div className="pointer-events-auto flex shrink-0 gap-2">

            <Button size="sm" variant="secondary" className="h-8 px-2.5 text-xs sm:text-sm" onClick={() => setWireframe((value) => !value)}>
              <Boxes className="mr-1.5 size-3.5" />
              {wireframe ? t("viewer.solid") : t("viewer.wireframe")}
            </Button>
            <Button size="sm" variant="secondary" className="h-8 px-2.5 text-xs sm:text-sm" onClick={() => setWarmLight((value) => !value)}>
              <Lightbulb className="mr-1.5 size-3.5" />
              {warmLight ? t("viewer.warm") : t("viewer.cool")}
            </Button>
          </div>

          {canDownload ? (
            <div className="pointer-events-auto flex gap-2">
              <Button size="sm" onClick={() => void exportModel("glb")}>
                <Download className="mr-1.5 size-3.5" /> GLB
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void exportModel("stl")}>
                <Download className="mr-1.5 size-3.5" /> STL
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type ViewPreset = "front" | "angle" | "side" | "top";

const VIEW_POSITIONS: Record<ViewPreset, [number, number, number]> = {
  front: [0, 0.4, 3.4],
  angle: [2.3, 1, 2.4],
  side: [3.3, 0.4, 0.2],
  top: [0, 3.2, 1.4],
};

/** Frames the freshly extracted model so it fills the preview without manual zooming. */
function FitCamera({ object }: { object: THREE.Object3D | null }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    if (!object) return;
    // Wait a frame so <Center> has laid the scene out before measuring it.
    const id = requestAnimationFrame(() => {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fov = ((camera.fov ?? 38) * Math.PI) / 180;
      const distance = Math.min(7, Math.max(1.8, (sphere.radius * 1.5) / Math.sin(fov / 2)));
      const direction = camera.position.clone().sub(controls?.target ?? new THREE.Vector3()).normalize();
      if (direction.lengthSq() === 0) direction.set(0, 0.12, 1);
      camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
      controls?.target.copy(sphere.center);
      controls?.update();
      camera.updateProjectionMatrix();
    });
    return () => cancelAnimationFrame(id);
  }, [object, camera, controls]);
  return null;
}

/** Dollies the camera in or out whenever `nonce` changes, respecting orbit limits. */
function CameraZoom({ factor, nonce }: { factor: number; nonce: number }) {

  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    if (nonce === 0) return;
    const target = controls?.target ?? new THREE.Vector3();
    const offset = camera.position.clone().sub(target);
    const distance = Math.min(7, Math.max(1.8, offset.length() * factor));
    camera.position.copy(target).add(offset.setLength(distance));
    controls?.update();
  }, [factor, nonce, camera, controls]);
  return null;
}


/** Moves the camera to a preset whenever `nonce` changes. */
function CameraRig({ preset, nonce }: { preset: ViewPreset; nonce: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    if (nonce === 0) return;
    const [x, y, z] = VIEW_POSITIONS[preset];
    camera.position.set(x, y, z);
    controls?.target.set(0, 0, 0);
    controls?.update();
    camera.updateProjectionMatrix();
  }, [preset, nonce, camera, controls]);
  return null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Translates pointer movement into scene-space deltas while a sculpture or
 * plinth is being dragged. Horizontal drags run on the ground plane; vertical
 * drags run on a plane facing the camera.
 */
function DragManager({
  drag,
  onMove,
  onEnd,
}: {
  drag: DragState | null;
  onMove: (state: DragState, delta: THREE.Vector3) => void;
  onEnd: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!drag) return;
    const element = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const plane =
      drag.axis === "y"
        ? new THREE.Plane().setFromNormalAndCoplanarPoint(
            new THREE.Vector3(camera.position.x, 0, camera.position.z).normalize(),
            drag.origin,
          )
        : new THREE.Plane(new THREE.Vector3(0, 1, 0), -drag.origin.y);

    function onPointerMove(event: PointerEvent) {
      const rect = element.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      onMove(drag!, hit.clone().sub(drag!.origin));
      invalidate();
    }

    function stop() {
      onEnd();
      invalidate();
    }

    element.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      element.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [drag, camera, gl, invalidate, onMove, onEnd]);

  return null;
}

