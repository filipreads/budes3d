/**
 * DOM-free GLB reader.
 *
 * Produces a plain triangle soup (world space, 9 floats per triangle) straight
 * from the binary glTF container, without three.js, textures or any browser
 * API. That makes it usable inside a Web Worker, which is where the slicing and
 * mesh-check work now happens so the editor UI never blocks.
 */

type Accessor = {
  bufferView?: number;
  componentType: number;
  count: number;
  type: string;
  byteOffset?: number;
};

type Node = {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};

type Gltf = {
  accessors?: Accessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  nodes?: Node[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
};

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

export function parseGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array<ArrayBufferLike> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file");
  let offset = 12;
  let json: Gltf | null = null;
  let bin: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const chunk = bytes.subarray(start, start + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as Gltf;
    if (type === 0x004e4942) bin = chunk;
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

function readAccessor(gltf: Gltf, bin: Uint8Array, index: number): Float64Array {
  const accessor = gltf.accessors?.[index];
  if (!accessor) return new Float64Array(0);
  const view = gltf.bufferViews?.[accessor.bufferView ?? -1];
  if (!view) return new Float64Array(0);
  const components = accessor.type === "VEC3" ? 3 : accessor.type === "VEC2" ? 2 : accessor.type === "SCALAR" ? 1 : 0;
  if (!components) return new Float64Array(0);
  const size = COMPONENT_SIZE[accessor.componentType] ?? 4;
  const stride = view.byteStride || components * size;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float64Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const at = base + i * stride + c * size;
      if (at + size > bin.byteLength) return out;
      let value = 0;
      switch (accessor.componentType) {
        case 5126:
          value = data.getFloat32(at, true);
          break;
        case 5125:
          value = data.getUint32(at, true);
          break;
        case 5123:
          value = data.getUint16(at, true);
          break;
        case 5121:
          value = data.getUint8(at);
          break;
        case 5122:
          value = data.getInt16(at, true);
          break;
        case 5120:
          value = data.getInt8(at);
          break;
        default:
          value = 0;
      }
      out[i * components + c] = value;
    }
  }
  return out;
}

type Matrix = number[]; // column-major 4x4, like glTF

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function nodeMatrix(node: Node): Matrix {
  if (node.matrix && node.matrix.length === 16) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = (qx ?? 0) * 2, y2 = (qy ?? 0) * 2, z2 = (qz ?? 0) * 2;
  const xx = (qx ?? 0) * x2, xy = (qx ?? 0) * y2, xz = (qx ?? 0) * z2;
  const yy = (qy ?? 0) * y2, yz = (qy ?? 0) * z2, zz = (qz ?? 0) * z2;
  const wx = (qw ?? 1) * x2, wy = (qw ?? 1) * y2, wz = (qw ?? 1) * z2;
  return [
    (1 - (yy + zz)) * (sx ?? 1), (xy + wz) * (sx ?? 1), (xz - wy) * (sx ?? 1), 0,
    (xy - wz) * (sy ?? 1), (1 - (xx + zz)) * (sy ?? 1), (yz + wx) * (sy ?? 1), 0,
    (xz + wy) * (sz ?? 1), (yz - wx) * (sz ?? 1), (1 - (xx + yy)) * (sz ?? 1), 0,
    tx ?? 0, ty ?? 0, tz ?? 0, 1,
  ];
}

function apply(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

/** Every triangle of the file in world space: 9 floats (x,y,z × 3) per triangle. */
export function glbTriangles(bytes: Uint8Array): Float32Array {
  const { json, bin } = parseGlb(bytes);
  const chunks: number[][] = [];
  let total = 0;

  const emit = (matrix: Matrix, meshIndex: number) => {
    const mesh = json.meshes?.[meshIndex];
    if (!mesh) return;
    for (const primitive of mesh.primitives) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positionIndex = primitive.attributes["POSITION"];
      if (positionIndex === undefined) continue;
      const positions = readAccessor(json, bin, positionIndex);
      const vertexCount = Math.floor(positions.length / 3);
      const indices =
        primitive.indices !== undefined ? readAccessor(json, bin, primitive.indices) : null;
      const count = indices ? indices.length : vertexCount;
      const out: number[] = [];
      for (let i = 0; i + 2 < count; i += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const vi = indices ? (indices[i + corner] ?? 0) : i + corner;
          const [x, y, z] = apply(
            matrix,
            positions[vi * 3] ?? 0,
            positions[vi * 3 + 1] ?? 0,
            positions[vi * 3 + 2] ?? 0,
          );
          out.push(x, y, z);
        }
      }
      chunks.push(out);
      total += out.length;
    }
  };

  const nodes = json.nodes ?? [];
  const walk = (index: number, parent: Matrix) => {
    const node = nodes[index];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) emit(world, node.mesh);
    for (const child of node.children ?? []) walk(child, world);
  };

  const roots = json.scenes?.[json.scene ?? 0]?.nodes;
  if (roots && roots.length > 0) {
    for (const root of roots) walk(root, IDENTITY);
  } else if (nodes.length > 0) {
    nodes.forEach((_, index) => walk(index, IDENTITY));
  } else {
    (json.meshes ?? []).forEach((_, index) => emit(IDENTITY, index));
  }

  const tris = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    tris.set(chunk, at);
    at += chunk.length;
  }
  return tris;
}

export type SoupReport = {
  triangles: number;
  /** Edges used by exactly one triangle — 0 means the mesh is watertight. */
  openEdges: number;
  watertight: boolean;
  size: { x: number; y: number; z: number };
};

/** Triangle count, boundary edges and bounding box of a triangle soup. */
export function soupReport(tris: Float32Array): SoupReport {
  const triangles = Math.floor(tris.length / 9);
  const edges = new Map<string, number>();
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const key = (o: number) =>
    `${Math.round((tris[o] ?? 0) * 1e4)},${Math.round((tris[o + 1] ?? 0) * 1e4)},${Math.round((tris[o + 2] ?? 0) * 1e4)}`;
  const addEdge = (a: string, b: string) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  };

  for (let t = 0; t < triangles; t++) {
    const o = t * 9;
    for (let c = 0; c < 3; c++) {
      const x = tris[o + c * 3] ?? 0;
      const y = tris[o + c * 3 + 1] ?? 0;
      const z = tris[o + c * 3 + 2] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const a = key(o);
    const b = key(o + 3);
    const c = key(o + 6);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  let openEdges = 0;
  for (const uses of edges.values()) if (uses === 1) openEdges += 1;

  return {
    triangles,
    openEdges,
    watertight: triangles > 0 && openEdges === 0,
    size: {
      x: Number.isFinite(maxX) ? maxX - minX : 0,
      y: Number.isFinite(maxY) ? maxY - minY : 0,
      z: Number.isFinite(maxZ) ? maxZ - minZ : 0,
    },
  };
}
