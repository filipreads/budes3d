import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getModelUrl } from "@/lib/studio.functions";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Center } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Download, Lightbulb, Boxes } from "lucide-react";
import { toast } from "sonner";

const MATERIAL_LOOK: Record<string, { color: string; metalness: number; roughness: number }> = {
  resin: { color: "#e8e1d6", metalness: 0.05, roughness: 0.62 },
  marble: { color: "#d9dde0", metalness: 0.02, roughness: 0.35 },
  bronze: { color: "#b07a3c", metalness: 0.92, roughness: 0.28 },
  fullcolor: { color: "#d7a68b", metalness: 0.05, roughness: 0.75 },
};

const FINISH_ROUGHNESS: Record<string, number> = { matte: 0.25, satin: 0, gloss: -0.18 };

function seedFrom(ref: string) {
  let hash = 7;
  for (const char of ref) hash = (hash * 31 + char.charCodeAt(0)) % 99991;
  return hash / 99991;
}

/** Builds a deterministic sculpted bust mesh from the generation seed. */
function buildBustGeometry(seed: number) {
  const profile: THREE.Vector2[] = [];
  const shoulderWidth = 0.85 + seed * 0.25;
  const neckWidth = 0.24 + seed * 0.05;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const y = -1.1 + t * 1.35;
    const taper = Math.pow(1 - t, 1.7);
    const radius = neckWidth + taper * shoulderWidth + Math.sin(t * 7 + seed * 6) * 0.015;
    profile.push(new THREE.Vector2(Math.max(radius, 0.08), y));
  }
  const torso = new THREE.LatheGeometry(profile, 96);

  const head = new THREE.SphereGeometry(0.52, 96, 96);
  const position = head.attributes["position"] as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const jaw = vertex.y < -0.05 ? 1 - Math.abs(vertex.y) * 0.35 : 1;
    const face = 1 + Math.max(vertex.z, 0) * 0.12 * (0.6 + seed);
    const noise =
      Math.sin(vertex.x * 9 + seed * 12) * 0.008 +
      Math.cos(vertex.y * 11 + seed * 5) * 0.008 +
      Math.sin(vertex.z * 7) * 0.006;
    vertex.multiplyScalar(jaw * face).addScalar(noise);
    vertex.y *= 1.16;
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  head.computeVertexNormals();
  head.translate(0, 0.72, 0);

  const merged = mergeGeometries([torso, head]);
  merged.computeVertexNormals();
  return merged;
}

function mergeGeometries(list: THREE.BufferGeometry[]) {
  const result = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  for (const geometry of list) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    positions.push(...Array.from(nonIndexed.attributes["position"]!.array as Float32Array));
    const normal = nonIndexed.attributes["normal"];
    if (normal) normals.push(...Array.from(normal.array as Float32Array));
  }
  result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    result.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  }
  return result;
}

type Props = {
  modelRef: string;
  materialId: string;
  finishId: string;
  showBase?: boolean;
  canDownload?: boolean;
};

export default function ModelStage({
  modelRef,
  materialId,
  finishId,
  showBase = true,
  canDownload = false,
}: Props) {
  const [wireframe, setWireframe] = useState(false);
  const [warmLight, setWarmLight] = useState(true);
  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const isGeneratedFile = !modelRef.startsWith("sample://");

  const seed = useMemo(() => seedFrom(modelRef), [modelRef]);
  const geometry = useMemo(() => buildBustGeometry(seed), [seed]);
  const look = MATERIAL_LOOK[materialId] ?? MATERIAL_LOOK["resin"]!;
  const roughness = Math.min(Math.max(look.roughness + (FINISH_ROUGHNESS[finishId] ?? 0), 0.03), 1);

  // Real TRELLIS output lives in private storage: resolve a signed URL, then load the GLB.
  useEffect(() => {
    if (!isGeneratedFile) {
      setLoadedScene(null);
      setLoadFailed(false);
      return;
    }
    let cancelled = false;
    setLoadedScene(null);
    setLoadFailed(false);
    void (async () => {
      try {
        const { url } = await getModelUrl({ data: { storagePath: modelRef } });
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
  }, [modelRef, isGeneratedFile]);

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
    const source: THREE.Object3D | null = loadedScene ?? meshRef.current;
    if (!source) return;
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
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch {
      toast.error("Could not export the model");
    }
  }

  const showProcedural = !isGeneratedFile || loadFailed;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-stone-deep">
      <Canvas shadows camera={{ position: [0, 0.4, 3.4], fov: 38 }} dpr={[1, 2]}>
        <color attach="background" args={["#141311"]} />
        <ambientLight intensity={warmLight ? 0.5 : 0.25} />
        <directionalLight
          position={[3, 4, 3]}
          intensity={warmLight ? 2.4 : 1.4}
          color={warmLight ? "#ffd9a8" : "#cfe0ff"}
          castShadow
        />
        <directionalLight position={[-3, 1, -2]} intensity={0.8} color="#6d7f9c" />
        <Suspense fallback={null}>
          <Center>
            <group ref={groupRef}>
              {loadedScene ? (
                <primitive object={loadedScene} />
              ) : showProcedural ? (
                <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
                  <meshStandardMaterial
                    color={look.color}
                    metalness={look.metalness}
                    roughness={roughness}
                    wireframe={wireframe}
                  />
                </mesh>
              ) : null}
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
