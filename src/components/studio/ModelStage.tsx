import { Suspense, useEffect, useRef, useState } from "react";
import { getModelUrl } from "@/lib/studio.functions";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Center } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Download, Lightbulb, Boxes, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

type Props = {
  modelRef: string;
  materialId: string;
  finishId: string;
  showBase?: boolean;
  canDownload?: boolean;
  /** Pre-signed model URL (used by public share links, which cannot sign one). */
  modelUrl?: string | null;
};

export default function ModelStage({
  modelRef,
  materialId,
  finishId,
  showBase = true,
  canDownload = false,
  modelUrl = null,
}: Props) {
  void materialId;
  void finishId;
  const { t } = useI18n();
  const [wireframe, setWireframe] = useState(false);
  const [warmLight, setWarmLight] = useState(true);
  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

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
    void (async () => {
      try {
        const url = modelUrl ?? (await getModelUrl({ data: { storagePath: modelRef } })).url;
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const gltf = await new GLTFLoader().loadAsync(url);
        if (cancelled) return;
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        setLoadedScene(gltf.scene);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelRef, modelUrl, hasFile]);

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

              {showBase ? (
                <mesh position={[0, -1.22, 0]} receiveShadow>
                  <cylinderGeometry args={[0.95, 1.05, 0.22, 64]} />
                  <meshStandardMaterial color="#3c2f24" roughness={0.6} metalness={0.05} />
                </mesh>
              ) : null}
            </group>
          </Center>
          <ContactShadows position={[0, -1.4, 0]} opacity={0.55} scale={7} blur={2.6} far={4} />
        </Suspense>
        <OrbitControls enablePan minDistance={1.8} maxDistance={7} autoRotate autoRotateSpeed={0.6} />
      </Canvas>


      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="pointer-events-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setWireframe((value) => !value)}>
            <Boxes className="mr-1.5 size-3.5" />
            {wireframe ? "Solid" : "Wireframe"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setWarmLight((value) => !value)}>
            <Lightbulb className="mr-1.5 size-3.5" />
            {warmLight ? "Warm" : "Cool"}
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
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
