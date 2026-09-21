/**
 * Server-side printability check.
 *
 * Runs on the raw GLB bytes as soon as a provider job finishes, so the verdict
 * is persisted with the job instead of depending on the customer's browser.
 * It parses only what a print shop cares about: triangle count, open (boundary)
 * edges and the bounding box.
 */
import type { PrintabilityReport } from "./photo3d";

type Accessor = {
  bufferView?: number;
  componentType: number;
  count: number;
  type: string;
  byteOffset?: number;
};

type Gltf = {
  accessors?: Accessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
};

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Splits a binary glTF container into its JSON and BIN chunks. */
function parseGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file");
  let offset = 12;
  let json: Gltf | null = null;
  let bin = new Uint8Array(0);
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const chunk = bytes.subarray(start, start + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as Gltf;
    if (type === 0x004e4942) bin = chunk as Uint8Array<ArrayBuffer>;
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

function readAccessor(gltf: Gltf, bin: Uint8Array, index: number): number[] {
  const accessor = gltf.accessors?.[index];
  if (!accessor) return [];
  const view = gltf.bufferViews?.[accessor.bufferView ?? -1];
  if (!view) return [];
  const components = accessor.type === "VEC3" ? 3 : accessor.type === "SCALAR" ? 1 : 0;
  if (!components) return [];
  const size = COMPONENT_SIZE[accessor.componentType] ?? 4;
  const stride = view.byteStride || components * size;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out: number[] = [];
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const at = base + i * stride + c * size;
      if (at + size > bin.byteLength) return out;
      switch (accessor.componentType) {
        case 5126:
          out.push(data.getFloat32(at, true));
          break;
        case 5125:
          out.push(data.getUint32(at, true));
          break;
        case 5123:
          out.push(data.getUint16(at, true));
          break;
        case 5121:
          out.push(data.getUint8(at));
          break;
        default:
          out.push(0);
      }
    }
  }
  return out;
}

/** Triangle count, boundary edges and bounding box of every mesh in the file. */
export function inspectGlb(bytes: Uint8Array): PrintabilityReport {
  const { json, bin } = parseGlb(bytes);
  let triangles = 0;
  const edges = new Map<string, number>();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positionIndex = primitive.attributes["POSITION"];
      if (positionIndex === undefined) continue;
      const positions = readAccessor(json, bin, positionIndex);
      const vertexCount = Math.floor(positions.length / 3);
      for (let v = 0; v < vertexCount; v++) {
        for (let axis = 0; axis < 3; axis++) {
          const value = positions[v * 3 + axis] ?? 0;
          if (value < (min[axis] ?? Infinity)) min[axis] = value;
          if (value > (max[axis] ?? -Infinity)) max[axis] = value;
        }
      }
      const indices =
        primitive.indices !== undefined
          ? readAccessor(json, bin, primitive.indices)
          : Array.from({ length: vertexCount }, (_, i) => i);

      const key = (i: number) => {
        const x = Math.round((positions[i * 3] ?? 0) * 1e4);
        const y = Math.round((positions[i * 3 + 1] ?? 0) * 1e4);
        const z = Math.round((positions[i * 3 + 2] ?? 0) * 1e4);
        return `${x},${y},${z}`;
      };
      const addEdge = (a: string, b: string) => {
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      };

      for (let t = 0; t + 2 < indices.length; t += 3) {
        triangles += 1;
        const a = key(indices[t] ?? 0);
        const b = key(indices[t + 1] ?? 0);
        const c = key(indices[t + 2] ?? 0);
        addEdge(a, b);
        addEdge(b, c);
        addEdge(c, a);
      }
    }
  }

  let openEdges = 0;
  for (const uses of edges.values()) if (uses === 1) openEdges += 1;

  const size = {
    x: Number.isFinite(max[0]) ? (max[0] as number) - (min[0] as number) : 0,
    y: Number.isFinite(max[1]) ? (max[1] as number) - (min[1] as number) : 0,
    z: Number.isFinite(max[2]) ? (max[2] as number) - (min[2] as number) : 0,
  };

  const issues: string[] = [];
  if (triangles === 0) issues.push("empty");
  if (openEdges > 0) issues.push("holes");
  if (triangles > 900_000) issues.push("heavy");
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) issues.push("flat");

  return {
    triangles,
    openEdges,
    watertight: triangles > 0 && openEdges === 0,
    size,
    printable: triangles > 0 && issues.filter((issue) => issue !== "holes").length === 0,
    issues,
  };
}

/** Never throws: a failed inspection must not fail an otherwise good job. */
export function safeInspect(bytes: Uint8Array): PrintabilityReport | null {
  try {
    return inspectGlb(bytes);
  } catch {
    return null;
  }
}
