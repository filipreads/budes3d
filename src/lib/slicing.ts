/**
 * Browser-side slicing preview.
 *
 * The approved GLB is intersected with horizontal planes, exactly like a
 * slicer does, so the customer can see the printed layers and the key
 * parameters (layer height, infill, supports) before downloading files.
 * Nothing is uploaded and no real G-code is produced — these are estimates.
 *
 * Performance notes:
 *  - The GLB is parsed and flattened into a triangle soup exactly once per
 *    (url, height) pair and cached, so moving a slider never re-downloads or
 *    re-parses the model.
 *  - Per-triangle area, facing and z-range are precomputed, so recomputing the
 *    statistics for new settings is a single cheap pass over typed arrays.
 *  - Layer outlines are produced lazily, only for the layer being drawn, using
 *    a z-bucket index so each layer touches only the triangles that cross it.
 */
import { loadScene } from "./mesh-analysis";

export type SliceSettings = {
  /** Layer height in millimetres. */
  layerHeightMm: number;
  /** Infill density, 0–1. */
  infill: number;
  supports: "none" | "buildplate" | "everywhere";
  /** Overhang angle in degrees measured from vertical. */
  overhangDeg: number;
};

export const DEFAULT_SLICE: SliceSettings = {
  layerHeightMm: 0.2,
  infill: 0.15,
  supports: "buildplate",
  overhangDeg: 45,
};

export type SliceStats = {
  layerCount: number;
  heightMm: number;
  /** Solid volume of the model in cubic centimetres. */
  volumeCm3: number;
  /** Estimated material used with the chosen infill, in grams. */
  materialGrams: number;
  /** Rough print time in minutes. */
  printMinutes: number;
  /** Area needing support, in square centimetres. */
  supportAreaCm2: number;
  /** Share of the surface that overhangs beyond the allowed angle, 0–1. */
  overhangShare: number;
  thinWalls: boolean;
};

/** Parsed, unit-converted model kept in memory between parameter changes. */
export type PreparedModel = {
  /** Triangle soup in millimetres, 9 numbers per triangle, resting on z=0. */
  tris: Float32Array;
  triangleCount: number;
  /** Per-triangle area (mm²). */
  areas: Float32Array;
  /** Per-triangle downward facing, -nz / |n| — 1 means it points straight down. */
  facing: Float32Array;
  /** Per-triangle z range, 2 numbers per triangle. */
  zRange: Float32Array;
  volumeMm3: number;
  totalAreaMm2: number;
  heightMm: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

/** Flat list of segments: x1, y1, x2, y2 (millimetres, build-plate plane). */
export type SliceLayer = {
  index: number;
  zMm: number;
  segments: Float32Array;
};

/** Density used for the estimate, g/cm³ (cast resin / PLA are both ~1.2). */
const DENSITY = 1.2;

const cache = new Map<string, Promise<PreparedModel>>();

/** Parses the GLB once and keeps the triangle soup for later slicing. */
export function prepareModel(url: string, heightMm: number): Promise<PreparedModel> {
  const key = `${url}|${heightMm}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = buildModel(url, heightMm).catch((error) => {
    cache.delete(key);
    throw error;
  });
  // Only the most recent model is worth keeping around.
  if (cache.size > 1) cache.clear();
  cache.set(key, promise);
  return promise;
}

async function buildModel(url: string, heightMm: number): Promise<PreparedModel> {
  const THREE = await import("three");
  const scene = await loadScene(url);
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? heightMm / size.y : 1;

  const raw: number[] = [];
  const v = new THREE.Vector3();
  scene.traverse((child) => {
    const mesh = child as InstanceType<typeof THREE.Mesh>;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as InstanceType<typeof THREE.BufferGeometry>;
    const position = geometry.getAttribute("position") as InstanceType<typeof THREE.BufferAttribute> | undefined;
    if (!position || !("array" in position)) return;
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i++) {
      const vi = index ? index.getX(i) : i;
      v.fromBufferAttribute(position, vi).applyMatrix4(mesh.matrixWorld);
      // x/y stay the plate plane; the model's y becomes the print height z.
      raw.push((v.x - box.min.x) * scale, (v.z - box.min.z) * scale, (v.y - box.min.y) * scale);
    }
  });

  const tris = new Float32Array(raw);
  const triangleCount = Math.floor(tris.length / 9);
  const areas = new Float32Array(triangleCount);
  const facing = new Float32Array(triangleCount);
  const zRange = new Float32Array(triangleCount * 2);

  let volume = 0;
  let totalArea = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9;
    const ax = tris[o]!, ay = tris[o + 1]!, az = tris[o + 2]!;
    const bx = tris[o + 3]!, by = tris[o + 4]!, bz = tris[o + 5]!;
    const cx = tris[o + 6]!, cy = tris[o + 7]!, cz = tris[o + 8]!;

    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    areas[t] = len / 2;
    facing[t] = len === 0 ? 0 : -nz / len;
    totalArea += len / 2;

    zRange[t * 2] = Math.min(az, bz, cz);
    zRange[t * 2 + 1] = Math.max(az, bz, cz);

    if (ax < minX) minX = ax;
    if (bx < minX) minX = bx;
    if (cx < minX) minX = cx;
    if (ax > maxX) maxX = ax;
    if (bx > maxX) maxX = bx;
    if (cx > maxX) maxX = cx;
    if (ay < minY) minY = ay;
    if (by < minY) minY = by;
    if (cy < minY) minY = cy;
    if (ay > maxY) maxY = ay;
    if (by > maxY) maxY = by;
    if (cy > maxY) maxY = cy;
  }

  return {
    tris,
    triangleCount,
    areas,
    facing,
    zRange,
    volumeMm3: Math.abs(volume),
    totalAreaMm2: totalArea,
    heightMm,
    bounds: {
      minX: Number.isFinite(minX) ? minX : 0,
      maxX: Number.isFinite(maxX) ? maxX : 1,
      minY: Number.isFinite(minY) ? minY : 0,
      maxY: Number.isFinite(maxY) ? maxY : 1,
    },
  };
}

export function layerHeightOf(settings: SliceSettings): number {
  return Math.max(0.05, Math.min(0.3, settings.layerHeightMm));
}

/** Cheap statistics pass — safe to run on every slider move. */
export function computeStats(model: PreparedModel, settings: SliceSettings): SliceStats {
  const layerHeight = layerHeightOf(settings);
  const layerCount = Math.max(1, Math.round(model.heightMm / layerHeight));
  const cos = Math.cos((settings.overhangDeg * Math.PI) / 180);

  let supportArea = 0;
  if (settings.supports !== "none") {
    for (let t = 0; t < model.triangleCount; t++) {
      if (model.facing[t]! > cos) supportArea += model.areas[t]!;
    }
  }

  const volume = model.volumeMm3;
  const totalArea = model.totalAreaMm2;
  // Solid shell plus infill inside — a good enough material estimate.
  const shellShare = Math.min(0.6, (2 * layerHeight * totalArea) / Math.max(volume, 1));
  const usedVolume = volume * (shellShare + (1 - shellShare) * Math.max(0, Math.min(1, settings.infill)));

  return {
    layerCount,
    heightMm: model.heightMm,
    volumeCm3: volume / 1000,
    materialGrams: (usedVolume / 1000) * DENSITY,
    printMinutes: Math.round(layerCount * (0.12 + (usedVolume / 1000) / Math.max(layerCount, 1) * 6)),
    supportAreaCm2: supportArea / 100,
    overhangShare: totalArea > 0 ? supportArea / totalArea : 0,
    thinWalls: volume > 0 && volume / Math.max(totalArea, 1) < layerHeight * 3,
  };
}

export type LayerSlicer = {
  layerCount: number;
  layerHeightMm: number;
  bounds: PreparedModel["bounds"];
  /** Outline of one layer; computed on first use and cached. */
  layer(index: number): SliceLayer;
};

/**
 * Builds a z-bucket index for the given layer height so a single layer only
 * intersects the triangles that actually cross it.
 */
export function createSlicer(model: PreparedModel, settings: SliceSettings): LayerSlicer {
  const layerHeightMm = layerHeightOf(settings);
  const layerCount = Math.max(1, Math.round(model.heightMm / layerHeightMm));

  const counts = new Uint32Array(layerCount + 1);
  const first = new Int32Array(model.triangleCount);
  const last = new Int32Array(model.triangleCount);
  for (let t = 0; t < model.triangleCount; t++) {
    const lo = Math.max(0, Math.floor(model.zRange[t * 2]! / layerHeightMm));
    const hi = Math.min(layerCount - 1, Math.floor(model.zRange[t * 2 + 1]! / layerHeightMm));
    first[t] = lo;
    last[t] = hi;
    if (hi < lo) continue;
    for (let b = lo; b <= hi; b++) counts[b]! += 1;
  }

  const offsets = new Uint32Array(layerCount + 1);
  let running = 0;
  for (let b = 0; b < layerCount; b++) {
    offsets[b] = running;
    running += counts[b]!;
  }
  offsets[layerCount] = running;

  const cursor = offsets.slice();
  const bucket = new Uint32Array(running);
  for (let t = 0; t < model.triangleCount; t++) {
    const lo = first[t]!;
    const hi = last[t]!;
    if (hi < lo) continue;
    for (let b = lo; b <= hi; b++) bucket[cursor[b]!++] = t;
  }

  const cached = new Map<number, SliceLayer>();

  return {
    layerCount,
    layerHeightMm,
    bounds: model.bounds,
    layer(index: number): SliceLayer {
      const clamped = Math.max(0, Math.min(layerCount - 1, index));
      const hit = cached.get(clamped);
      if (hit) return hit;
      const z = (clamped + 0.5) * layerHeightMm;
      const out: number[] = [];
      const start = offsets[clamped]!;
      const end = offsets[clamped + 1]!;
      for (let i = start; i < end; i++) {
        intersect(model.tris, bucket[i]!, z, out);
      }
      const layer: SliceLayer = { index: clamped, zMm: z, segments: new Float32Array(out) };
      // Keep memory bounded while scrubbing or playing back.
      if (cached.size > 400) cached.clear();
      cached.set(clamped, layer);
      return layer;
    },
  };
}

/** Intersects one triangle with the plane z = height and appends the segment. */
function intersect(tris: Float32Array, t: number, height: number, out: number[]): void {
  const o = t * 9;
  let found = 0;
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  for (let e = 0; e < 3; e++) {
    const a = o + e * 3;
    const b = o + ((e + 1) % 3) * 3;
    const za = tris[a + 2]!;
    const zb = tris[b + 2]!;
    if ((za < height && zb >= height) || (zb < height && za >= height)) {
      const s = (height - za) / (zb - za);
      const x = tris[a]! + (tris[b]! - tris[a]!) * s;
      const y = tris[a + 1]! + (tris[b + 1]! - tris[a + 1]!) * s;
      if (found === 0) {
        x1 = x;
        y1 = y;
      } else if (found === 1) {
        x2 = x;
        y2 = y;
      }
      found += 1;
    }
  }
  if (found >= 2) out.push(x1, y1, x2, y2);
}
