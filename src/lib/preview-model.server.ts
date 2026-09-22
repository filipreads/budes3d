/**
 * Lightweight preview mesh.
 *
 * Right after generation we build a heavily simplified, texture-less copy of
 * the model. The studio shows it within a moment while the full-resolution
 * master still downloads in the background. It is only ever used for looking
 * at — downloads, the print check and orders always use the master file.
 */
import { glbTriangles } from "./glb-soup";

/** Above this the full model is already quick enough to load on its own. */
const SKIP_BELOW_TRIANGLES = 60_000;
/** Target for the simplified copy. */
const TARGET_TRIANGLES = 120_000;

/**
 * Vertex-clustering decimation: vertices are snapped to a grid, triangles that
 * collapse onto fewer than three distinct cells are dropped. Fast, allocation
 * friendly and good enough for a silhouette preview.
 */
function decimate(tris: Float32Array, cells: number): { positions: Float32Array; indices: Uint32Array } {
  const count = Math.floor(tris.length / 9);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count * 9; i += 3) {
    const x = tris[i] ?? 0, y = tris[i + 1] ?? 0, z = tris[i + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const step = span / cells;

  const cellOf = (x: number, y: number, z: number) =>
    `${Math.floor((x - minX) / step)},${Math.floor((y - minY) / step)},${Math.floor((z - minZ) / step)}`;

  const slot = new Map<string, number>();
  const sums: number[] = [];
  const hits: number[] = [];
  const indices: number[] = [];

  const vertexAt = (o: number): number => {
    const x = tris[o] ?? 0, y = tris[o + 1] ?? 0, z = tris[o + 2] ?? 0;
    const key = cellOf(x, y, z);
    let index = slot.get(key);
    if (index === undefined) {
      index = hits.length;
      slot.set(key, index);
      sums.push(0, 0, 0);
      hits.push(0);
    }
    sums[index * 3] = (sums[index * 3] ?? 0) + x;
    sums[index * 3 + 1] = (sums[index * 3 + 1] ?? 0) + y;
    sums[index * 3 + 2] = (sums[index * 3 + 2] ?? 0) + z;
    hits[index] = (hits[index] ?? 0) + 1;
    return index;
  };

  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const a = vertexAt(o);
    const b = vertexAt(o + 3);
    const c = vertexAt(o + 6);
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }

  const positions = new Float32Array(hits.length * 3);
  for (let i = 0; i < hits.length; i++) {
    const n = Math.max(1, hits[i] ?? 1);
    positions[i * 3] = (sums[i * 3] ?? 0) / n;
    positions[i * 3 + 1] = (sums[i * 3 + 1] ?? 0) / n;
    positions[i * 3 + 2] = (sums[i * 3 + 2] ?? 0) / n;
  }
  return { positions, indices: Uint32Array.from(indices) };
}

function pad4(length: number): number {
  return (4 - (length % 4)) % 4;
}

/** Writes a minimal single-mesh GLB (positions + indices, default material). */
export function writeGlb(positions: Float32Array, indices: Uint32Array): Uint8Array {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0, y = positions[i + 1] ?? 0, z = positions[i + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const positionBytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  const indexBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
  const indexOffset = positionBytes.byteLength + pad4(positionBytes.byteLength);
  const binLength = indexOffset + indexBytes.byteLength;
  const bin = new Uint8Array(binLength + pad4(binLength));
  bin.set(positionBytes, 0);
  bin.set(indexBytes, indexOffset);

  const json = {
    asset: { version: "2.0", generator: "relievo-preview" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes.byteLength, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      { bufferView: 1, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
  };

  const jsonRaw = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(jsonRaw.byteLength + pad4(jsonRaw.byteLength)).fill(0x20);
  jsonChunk.set(jsonRaw, 0);

  const total = 12 + 8 + jsonChunk.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  const binHeader = 20 + jsonChunk.byteLength;
  view.setUint32(binHeader, bin.byteLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  out.set(bin, binHeader + 8);
  return out;
}

/**
 * Returns a simplified GLB, or null when the master is already light enough or
 * cannot be parsed. Never throws: a missing preview only costs a slower load.
 */
export function buildPreviewGlb(master: Uint8Array): Uint8Array | null {
  try {
    const tris = glbTriangles(master);
    const triangles = Math.floor(tris.length / 9);
    if (triangles < SKIP_BELOW_TRIANGLES) return null;

    // Fewer grid cells for heavier models, so the result lands near the target.
    let cells = Math.max(48, Math.round(Math.cbrt(TARGET_TRIANGLES) * 6));
    let result = decimate(tris, cells);
    let guard = 0;
    while (result.indices.length / 3 > TARGET_TRIANGLES && guard < 4) {
      cells = Math.round(cells * 0.75);
      result = decimate(tris, cells);
      guard += 1;
    }
    if (result.indices.length < 3) return null;
    return writeGlb(result.positions, result.indices);
  } catch {
    return null;
  }
}
