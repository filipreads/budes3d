/**
 * Browser-side slicing preview.
 *
 * The approved GLB is intersected with horizontal planes, exactly like a
 * slicer does, so the customer can see the printed layers and the key
 * parameters (layer height, infill, supports) before downloading files.
 * Nothing is uploaded and no real G-code is produced — these are estimates.
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

export type SliceLayer = {
  index: number;
  /** Height of this layer above the build plate, in millimetres. */
  zMm: number;
  /** Flat list of segments: x1, y1, x2, y2 (millimetres, build-plate plane). */
  segments: Float32Array;
};

export type SliceResult = {
  layers: SliceLayer[];
  /** Footprint of the model on the plate, in millimetres. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  stats: {
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
};

/** Preview cap — more layers than this are sampled for drawing only. */
const MAX_PREVIEW_LAYERS = 320;
/** Density used for the estimate, g/cm³ (cast resin / PLA are both ~1.2). */
const DENSITY = 1.2;

export async function sliceModelUrl(
  url: string,
  heightMm: number,
  settings: SliceSettings,
): Promise<SliceResult> {
  const THREE = await import("three");
  const scene = await loadScene(url);
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? heightMm / size.y : 1;

  // Collect every triangle once, in millimetres, with the model resting on z=0.
  const tris: number[] = [];
  const v = new THREE.Vector3();
  scene.traverse((child) => {
    const mesh = child as InstanceType<typeof THREE.Mesh>;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as InstanceType<typeof THREE.BufferGeometry>;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i++) {
      const vi = index ? index.getX(i) : i;
      v.fromBufferAttribute(position as InstanceType<typeof THREE.BufferAttribute>, vi).applyMatrix4(mesh.matrixWorld);
      // x/y stay the plate plane; the model's y becomes the print height z.
      tris.push((v.x - box.min.x) * scale, (v.z - box.min.z) * scale, (v.y - box.min.y) * scale);
    }
  });

  const triangleCount = Math.floor(tris.length / 9);
  const layerHeight = Math.max(0.05, Math.min(0.3, settings.layerHeightMm));
  const layerCount = Math.max(1, Math.round(heightMm / layerHeight));
  const cos = Math.cos((settings.overhangDeg * Math.PI) / 180);

  // Volume (signed tetrahedra) and support area in one pass over the triangles.
  let volume = 0;
  let supportArea = 0;
  let totalArea = 0;
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
    if (len === 0) continue;
    const area = len / 2;
    totalArea += area;
    // Downward-facing beyond the overhang angle → needs support.
    if (settings.supports !== "none" && -nz / len > cos) supportArea += area;
  }
  volume = Math.abs(volume);

  // Solid shell plus infill inside — a good enough material estimate.
  const shellShare = Math.min(0.6, (2 * layerHeight * totalArea) / Math.max(volume, 1));
  const usedVolume = volume * (shellShare + (1 - shellShare) * Math.max(0, Math.min(1, settings.infill)));

  const step = Math.max(1, Math.ceil(layerCount / MAX_PREVIEW_LAYERS));
  const layers: SliceLayer[] = [];
  for (let i = 0; i < layerCount; i += step) {
    const z = (i + 0.5) * layerHeight;
    layers.push({ index: i, zMm: z, segments: sliceAt(tris, triangleCount, z) });
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let t = 0; t < triangleCount * 3; t++) {
    const x = tris[t * 3]!, y = tris[t * 3 + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    layers,
    bounds: { minX, maxX, minY, maxY },
    stats: {
      layerCount,
      heightMm,
      volumeCm3: volume / 1000,
      materialGrams: (usedVolume / 1000) * DENSITY,
      printMinutes: Math.round(layerCount * (0.12 + (usedVolume / 1000) / Math.max(layerCount, 1) * 6)),
      supportAreaCm2: supportArea / 100,
      overhangShare: totalArea > 0 ? supportArea / totalArea : 0,
      thinWalls: volume > 0 && (volume / Math.max(totalArea, 1)) < layerHeight * 3,
    },
  };
}

/** Intersects all triangles with the plane z = height and returns 2D segments. */
function sliceAt(tris: number[], triangleCount: number, height: number): Float32Array {
  const out: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9;
    const p = [
      [tris[o]!, tris[o + 1]!, tris[o + 2]!],
      [tris[o + 3]!, tris[o + 4]!, tris[o + 5]!],
      [tris[o + 6]!, tris[o + 7]!, tris[o + 8]!],
    ];
    const hits: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = p[e]!;
      const b = p[(e + 1) % 3]!;
      const za = a[2]!;
      const zb = b[2]!;
      if ((za < height && zb >= height) || (zb < height && za >= height)) {
        const s = (height - za) / (zb - za);
        hits.push(a[0]! + (b[0]! - a[0]!) * s, a[1]! + (b[1]! - a[1]!) * s);
      }
    }
    if (hits.length >= 4) out.push(hits[0]!, hits[1]!, hits[2]!, hits[3]!);
  }
  return new Float32Array(out);
}
