/**
 * Printable extras baked into the exported files: the plinth, the lettering
 * and the hollow inner shell. Everything here works in millimetres and is
 * applied only at export time — the stored master mesh is never modified.
 */
import type * as THREE_NS from "three";
import type { BaseSpec, EngravingSpec, HollowSpec } from "./pricing";

type Three = typeof THREE_NS;

/** Grid step of the plinth's top surface; fine enough for readable lettering. */
const CELL_MM = 0.6;

/** True when the point lies inside the plinth outline, in -1..1 space. */
function insideShape(shape: BaseSpec["shape"], u: number, v: number): boolean {
  if (shape === "square") return Math.abs(u) <= 1 && Math.abs(v) <= 1;
  if (shape === "oval") return u * u + (v / 0.68) ** 2 <= 1;
  return u * u + v * v <= 1;
}

/**
 * Rasterises the lettering into a mask. Returns a sampler in -1..1 plinth
 * space; 1 means "inside a letter". Falls back to an empty mask when no
 * canvas is available.
 */
function letterMask(text: string, spec: EngravingSpec, base: BaseSpec): (u: number, v: number) => boolean {
  const clean = text.trim();
  if (!clean) return () => false;

  const pxPerMm = 4;
  const width = Math.max(32, Math.round(base.widthMm * pxPerMm));
  const height = Math.max(16, Math.round(base.widthMm * 0.5 * pxPerMm));
  let data: Uint8ClampedArray | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(spec.sizeMm * pxPerMm)}px system-ui, sans-serif`;
    ctx.fillText(clean, width / 2, height / 2, width * 0.86);
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return () => false;
  }

  const pixels = data;
  return (u, v) => {
    // Lettering sits in the front half of the plinth top.
    const x = Math.round(((u + 1) / 2) * (width - 1));
    const y = Math.round((1 - (v * 2 + 1.1) / 2) * (height - 1));
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return (pixels[(y * width + x) * 4] ?? 0) > 128;
  };
}

/**
 * Builds the plinth as a solid: a heightmapped top surface (so engraved or
 * raised lettering is real geometry, not a texture), a skirt and a flat base.
 */
export function buildPlinth(
  THREE: Three,
  base: BaseSpec,
  engraving: { text: string; spec: EngravingSpec },
): THREE_NS.BufferGeometry {
  const half = base.widthMm / 2;
  const cells = Math.max(24, Math.min(320, Math.round(base.widthMm / CELL_MM)));
  const mask = letterMask(engraving.text, engraving.spec, base);
  const depth = Math.max(0.3, engraving.spec.depthMm);

  const positions: number[] = [];

  const topY = (u: number, v: number) => {
    if (!mask(u, v)) return base.heightMm;
    return engraving.spec.raised ? base.heightMm + depth : base.heightMm - depth;
  };
  const point = (u: number, v: number): [number, number, number] => [u * half, topY(u, v), v * half];

  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
  ) => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  };

  // Top surface.
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const u0 = (i / cells) * 2 - 1;
      const u1 = ((i + 1) / cells) * 2 - 1;
      const v0 = (j / cells) * 2 - 1;
      const v1 = ((j + 1) / cells) * 2 - 1;
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      if (!insideShape(base.shape, cu, cv)) continue;
      quad(point(u0, v0), point(u0, v1), point(u1, v1), point(u1, v0));
      // Bottom face, wound the other way.
      quad(
        [u0 * half, 0, v0 * half],
        [u1 * half, 0, v0 * half],
        [u1 * half, 0, v1 * half],
        [u0 * half, 0, v1 * half],
      );
    }
  }

  // Skirt: walk the outline and drop a wall to the ground.
  const steps = 160;
  const outline: Array<[number, number]> = [];
  for (let s = 0; s < steps; s++) {
    const angle = (s / steps) * Math.PI * 2;
    let u = Math.cos(angle);
    let v = Math.sin(angle);
    if (base.shape === "square") {
      const m = Math.max(Math.abs(u), Math.abs(v)) || 1;
      u /= m;
      v /= m;
    } else if (base.shape === "oval") {
      v *= 0.68;
    }
    outline.push([u, v]);
  }
  for (let s = 0; s < outline.length; s++) {
    const [u0, v0] = outline[s]!;
    const [u1, v1] = outline[(s + 1) % outline.length]!;
    quad(
      [u0 * half, 0, v0 * half],
      [u0 * half, base.heightMm, v0 * half],
      [u1 * half, base.heightMm, v1 * half],
      [u1 * half, 0, v1 * half],
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Adds an inward-offset copy of every mesh so the print comes out hollow.
 * The inner shell is flipped, which is what a slicer expects. Optional drain
 * openings are cut by dropping the triangles around the lowest point.
 */
export function hollowScene(THREE: Three, root: THREE_NS.Object3D, spec: HollowSpec): void {
  if (!spec.enabled) return;
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const floor = box.min.y;
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;
  const holeRadius = Math.max(3, Math.min(10, (box.max.x - box.min.x) * 0.08));

  const additions: THREE_NS.Mesh[] = [];
  const meshes: THREE_NS.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE_NS.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });

  for (const mesh of meshes) {
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    source.computeVertexNormals();
    const position = source.getAttribute("position");
    const normal = source.getAttribute("normal");
    if (!position || !normal) continue;

    const inner = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      inner[i * 3] = position.getX(i) - normal.getX(i) * spec.wallMm;
      inner[i * 3 + 1] = position.getY(i) - normal.getY(i) * spec.wallMm;
      inner[i * 3 + 2] = position.getZ(i) - normal.getZ(i) * spec.wallMm;
    }

    const kept: number[] = [];
    for (let t = 0; t < inner.length / 9; t++) {
      const o = t * 9;
      if (spec.drainHoles) {
        let low = true;
        for (let k = 0; k < 3; k++) {
          const x = inner[o + k * 3] ?? 0;
          const y = inner[o + k * 3 + 1] ?? 0;
          const z = inner[o + k * 3 + 2] ?? 0;
          if (y > floor + spec.wallMm * 2 || Math.hypot(x - centerX, z - centerZ) > holeRadius) {
            low = false;
            break;
          }
        }
        if (low) continue;
      }
      // Reverse winding so the inner surface faces into the cavity.
      kept.push(
        inner[o]!, inner[o + 1]!, inner[o + 2]!,
        inner[o + 6]!, inner[o + 7]!, inner[o + 8]!,
        inner[o + 3]!, inner[o + 4]!, inner[o + 5]!,
      );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
    geometry.computeVertexNormals();
    const shell = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    shell.applyMatrix4(mesh.matrixWorld);
    additions.push(shell);
    source.dispose();
  }

  for (const shell of additions) root.add(shell);
}

/** Places a plinth under the sculpture and returns it, already positioned. */
export function attachPlinth(
  THREE: Three,
  root: THREE_NS.Object3D,
  base: BaseSpec,
  engraving: { text: string; spec: EngravingSpec },
): THREE_NS.Mesh {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const geometry = buildPlinth(THREE, base, engraving);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  // The plinth's own origin is its underside, so the sculpture rests on top.
  mesh.position.set((box.min.x + box.max.x) / 2, box.min.y - base.heightMm, (box.min.z + box.max.z) / 2);
  root.add(mesh);
  return mesh;
}
