/**
 * Pure slicing maths over a triangle soup.
 *
 * No three.js, no DOM: this module runs inside the mesh Web Worker so that
 * dragging the layer, infill or support sliders never blocks the editor.
 */

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

export type ModelBounds = { minX: number; maxX: number; minY: number; maxY: number };

/** Summary of a prepared model that is cheap to send to the main thread. */
export type ModelSummary = {
  triangleCount: number;
  heightMm: number;
  volumeMm3: number;
  bounds: ModelBounds;
};

export type PreparedModel = ModelSummary & {
  /** Triangle soup in millimetres, 9 numbers per triangle, resting on z=0. */
  tris: Float32Array;
  areas: Float32Array;
  /** Downward facing per triangle, -nz / |n| — 1 means it points straight down. */
  facing: Float32Array;
  zRange: Float32Array;
  totalAreaMm2: number;
};

/** Flat list of segments: x1, y1, x2, y2 (millimetres, build-plate plane). */
export type SliceLayer = {
  index: number;
  zMm: number;
  segments: Float32Array;
};

/** Density used for the estimate, g/cm³ (cast resin / PLA are both ~1.2). */
const DENSITY = 1.2;

/**
 * Converts a model-space triangle soup (y up) into print space (z up),
 * scaled to the ordered height in millimetres and resting on the plate.
 */
export function prepareFromTriangles(source: Float32Array, heightMm: number): PreparedModel {
  const count = Math.floor(source.length / 9);
  let minY = Infinity, maxY = -Infinity, minX = Infinity, minZ = Infinity;
  for (let i = 0; i < count * 9; i += 3) {
    const x = source[i] ?? 0;
    const y = source[i + 1] ?? 0;
    const z = source[i + 2] ?? 0;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
  }
  const span = Number.isFinite(maxY) && maxY > minY ? maxY - minY : 1;
  const scale = heightMm > 0 ? heightMm / span : 1;

  const tris = new Float32Array(count * 9);
  for (let i = 0; i < count * 9; i += 3) {
    tris[i] = ((source[i] ?? 0) - minX) * scale;
    tris[i + 1] = ((source[i + 2] ?? 0) - minZ) * scale;
    tris[i + 2] = ((source[i + 1] ?? 0) - minY) * scale;
  }

  const areas = new Float32Array(count);
  const facing = new Float32Array(count);
  const zRange = new Float32Array(count * 2);

  let volume = 0;
  let totalArea = 0;
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;

  for (let t = 0; t < count; t++) {
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

    bMinX = Math.min(bMinX, ax, bx, cx);
    bMaxX = Math.max(bMaxX, ax, bx, cx);
    bMinY = Math.min(bMinY, ay, by, cy);
    bMaxY = Math.max(bMaxY, ay, by, cy);
  }

  return {
    tris,
    triangleCount: count,
    areas,
    facing,
    zRange,
    volumeMm3: Math.abs(volume),
    totalAreaMm2: totalArea,
    heightMm,
    bounds: {
      minX: Number.isFinite(bMinX) ? bMinX : 0,
      maxX: Number.isFinite(bMaxX) ? bMaxX : 1,
      minY: Number.isFinite(bMinY) ? bMinY : 0,
      maxY: Number.isFinite(bMaxY) ? bMaxY : 1,
    },
  };
}

export function summarize(model: PreparedModel): ModelSummary {
  return {
    triangleCount: model.triangleCount,
    heightMm: model.heightMm,
    volumeMm3: model.volumeMm3,
    bounds: model.bounds,
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
  bounds: ModelBounds;
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
      for (let i = start; i < end; i++) intersect(model.tris, bucket[i]!, z, out);
      const layer: SliceLayer = { index: clamped, zMm: z, segments: new Float32Array(out) };
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
