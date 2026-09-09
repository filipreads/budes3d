/**
 * Optional mesh repair run before approval.
 *
 * Everything happens in the browser on the generated GLB:
 *  - duplicate vertices welded together (closes seams that only look like holes)
 *  - degenerate (zero-area) triangles dropped
 *  - normals recomputed so shading and slicing agree on inside/outside
 *  - small boundary loops fan-filled, which is what makes the mesh watertight
 *
 * The result is exported back to a GLB blob so the caller can store it and use
 * it for every later export. The original file is never mutated in place.
 */
import { loadScene, reportScene, type MeshReport } from "./mesh-analysis";

export type RepairResult = {
  before: MeshReport;
  after: MeshReport;
  blob: Blob;
  /** Boundary loops that were closed by the repair. */
  filledHoles: number;
  /** Triangles removed because they had no area. */
  removedTriangles: number;
};

/** Largest boundary loop we are willing to fan-fill without distorting the shape. */
const MAX_HOLE_EDGES = 48;

export async function repairModelUrl(url: string, level: "light" | "full" = "light"): Promise<RepairResult> {
  const [THREE, utils] = await Promise.all([
    import("three"),
    import("three/examples/jsm/utils/BufferGeometryUtils.js"),
  ]);
  const scene = await loadScene(url);
  const before = await reportScene(scene);

  let filledHoles = 0;
  let removedTriangles = 0;

  const meshes: InstanceType<typeof THREE.Mesh>[] = [];
  scene.traverse((child) => {
    const mesh = child as InstanceType<typeof THREE.Mesh>;
    if (mesh.isMesh) meshes.push(mesh);
  });

  for (const mesh of meshes) {
    let geometry = mesh.geometry as unknown as import("three").BufferGeometry;
    // Weld: the tolerance is relative to the model, which is unit-less here.
    geometry = utils.mergeVertices(geometry, level === "full" ? 1e-3 : 1e-5);

    const dropped = dropDegenerate(geometry);
    removedTriangles += dropped;

    filledHoles += fillHoles(geometry, THREE);

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
  }

  const after = await reportScene(scene);
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const binary = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;

  return {
    before,
    after,
    filledHoles,
    removedTriangles,
    blob: new Blob([binary], { type: "model/gltf-binary" }),
  };
}

/** Removes triangles whose three corners are not three distinct points. */
function dropDegenerate(geometry: import("three").BufferGeometry): number {
  const index = geometry.getIndex();
  if (!index) return 0;
  const position = geometry.getAttribute("position");
  const kept: number[] = [];
  let removed = 0;

  for (let t = 0; t < index.count / 3; t++) {
    const a = index.getX(t * 3);
    const b = index.getX(t * 3 + 1);
    const c = index.getX(t * 3 + 2);
    if (a === b || b === c || a === c || area(position, a, b, c) <= 1e-12) {
      removed += 1;
      continue;
    }
    kept.push(a, b, c);
  }
  if (removed > 0) geometry.setIndex(kept);
  return removed;
}

function area(position: import("three").BufferAttribute | import("three").InterleavedBufferAttribute, a: number, b: number, c: number): number {
  const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
  const bx = position.getX(b) - ax, by = position.getY(b) - ay, bz = position.getZ(b) - az;
  const cx = position.getX(c) - ax, cy = position.getY(c) - ay, cz = position.getZ(c) - az;
  const x = by * cz - bz * cy;
  const y = bz * cx - bx * cz;
  const z = bx * cy - by * cx;
  return 0.5 * Math.sqrt(x * x + y * y + z * z);
}

/**
 * Walks the boundary edges (edges used by a single triangle), chains them into
 * loops and closes each small loop with a triangle fan around its centroid.
 */
function fillHoles(geometry: import("three").BufferGeometry, THREE: typeof import("three")): number {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index) return 0;

  const uses = new Map<string, { a: number; b: number; count: number }>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < index.count / 3; t++) {
    const tri = [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      const k = key(a, b);
      const entry = uses.get(k);
      if (entry) entry.count += 1;
      else uses.set(k, { a, b, count: 1 });
    }
  }

  // Adjacency limited to boundary edges.
  const neighbours = new Map<number, number[]>();
  for (const edge of uses.values()) {
    if (edge.count !== 1) continue;
    (neighbours.get(edge.a) ?? neighbours.set(edge.a, []).get(edge.a)!).push(edge.b);
    (neighbours.get(edge.b) ?? neighbours.set(edge.b, []).get(edge.b)!).push(edge.a);
  }
  if (neighbours.size === 0) return 0;

  const visited = new Set<number>();
  const newTriangles: number[] = [];
  const extraVertices: number[] = [];
  let nextVertex = position.count;
  let filled = 0;

  for (const start of neighbours.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let current = start;
    let previous = -1;
    while (current !== undefined && !visited.has(current) && loop.length <= MAX_HOLE_EDGES + 1) {
      visited.add(current);
      loop.push(current);
      const next = (neighbours.get(current) ?? []).find((candidate) => candidate !== previous && !visited.has(candidate));
      previous = current;
      if (next === undefined) break;
      current = next;
    }
    if (loop.length < 3 || loop.length > MAX_HOLE_EDGES) continue;

    // Fan around the loop centroid — stable for the small holes we allow.
    const centroid = new THREE.Vector3();
    for (const v of loop) centroid.add(new THREE.Vector3(position.getX(v), position.getY(v), position.getZ(v)));
    centroid.multiplyScalar(1 / loop.length);
    const centre = nextVertex++;
    extraVertices.push(centroid.x, centroid.y, centroid.z);
    for (let i = 0; i < loop.length; i++) {
      newTriangles.push(centre, loop[i]!, loop[(i + 1) % loop.length]!);
    }
    filled += 1;
  }

  if (filled === 0) return 0;

  const merged = new Float32Array(position.count * 3 + extraVertices.length);
  for (let i = 0; i < position.count; i++) {
    merged[i * 3] = position.getX(i);
    merged[i * 3 + 1] = position.getY(i);
    merged[i * 3 + 2] = position.getZ(i);
  }
  merged.set(extraVertices, position.count * 3);

  const indices: number[] = [];
  for (let i = 0; i < index.count; i++) indices.push(index.getX(i));
  indices.push(...newTriangles);

  // Filled geometry carries positions only; UVs/normals no longer line up.
  const attributes = Object.keys(geometry.attributes);
  for (const name of attributes) if (name !== "position") geometry.deleteAttribute(name);
  geometry.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  geometry.setIndex(indices);
  return filled;
}
