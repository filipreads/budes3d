/**
 * Browser-side mesh analysis for the pre-approval print check.
 *
 * Loads the generated GLB once and reports what a print shop cares about:
 * triangle count, open (boundary) edges — i.e. holes that break watertightness —
 * and the bounding box. Runs entirely in the browser; nothing is uploaded.
 */
export type MeshReport = {
  triangles: number;
  /** Edges used by exactly one triangle — 0 means the mesh is watertight. */
  openEdges: number;
  watertight: boolean;
  /** Bounding box in model units (y is height before mm scaling). */
  size: { x: number; y: number; z: number };
};

export async function analyzeModelUrl(url: string): Promise<MeshReport> {
  const [{ GLTFLoader }, THREE] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three"),
  ]);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not fetch the model file");
  const buffer = await response.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buffer, "");

  let triangles = 0;
  const edgeUse = new Map<string, number>();
  const box = new THREE.Box3().setFromObject(gltf.scene);

  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((child) => {
    const mesh = child as InstanceType<typeof THREE.Mesh>;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as InstanceType<typeof THREE.BufferGeometry>;
    const position = geometry.getAttribute("position") as unknown as InstanceType<typeof THREE.BufferAttribute> | undefined;
    if (!position) return;
    const index = geometry.getIndex();

    const readVertex = (i: number) => {
      // Quantised key — welded vertices share one key so seam detection works.
      const x = Math.round(position.getX(i) * 1e4);
      const y = Math.round(position.getY(i) * 1e4);
      const z = Math.round(position.getZ(i) * 1e4);
      return `${x},${y},${z}`;
    };
    const addEdge = (a: string, b: string) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    };

    const triCount = index ? index.count / 3 : position.count / 3;
    triangles += triCount;
    for (let t = 0; t < triCount; t++) {
      const a = readVertex(index ? index.getX(t * 3) : t * 3);
      const b = readVertex(index ? index.getX(t * 3 + 1) : t * 3 + 1);
      const c = readVertex(index ? index.getX(t * 3 + 2) : t * 3 + 2);
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }
  });

  let openEdges = 0;
  for (const uses of edgeUse.values()) if (uses === 1) openEdges += 1;

  const size = box.getSize(new THREE.Vector3());
  return {
    triangles: Math.round(triangles),
    openEdges,
    watertight: openEdges === 0 && triangles > 0,
    size: { x: size.x, y: size.y, z: size.z },
  };
}
