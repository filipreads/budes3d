/**
 * Browser-side delivery of purchased files.
 * The stored asset is always a GLB; STL/OBJ/3MF are converted in the browser
 * from that exact mesh, so what the customer approved is what they receive.
 * 3MF and STL are scaled to the ordered print height in millimetres.
 */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadModelFile(
  signedUrl: string,
  format: string,
  filename: string,
  heightMm?: number,
  placement?: { yaw: number; tilt: number; scale: number; lift?: number; offsetX?: number; offsetZ?: number },
) {
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error("Could not fetch the model file");
  const buffer = await response.arrayBuffer();

  if (format !== "stl" && format !== "obj" && format !== "3mf") {
    saveBlob(new Blob([buffer], { type: "model/gltf-binary" }), filename);
    return;
  }

  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const THREE = await import("three");
  const gltf = await new GLTFLoader().parseAsync(buffer, "");

  // Bake the orientation and base placement the customer approved in the studio.
  if (placement) {
    gltf.scene.rotation.set((placement.tilt * Math.PI) / 180, (placement.yaw * Math.PI) / 180, 0);
    gltf.scene.position.set(placement.offsetX ?? 0, placement.lift ?? 0, placement.offsetZ ?? 0);
    gltf.scene.updateMatrixWorld(true);
  }

  // Slicers read STL/3MF as millimetres. The generated mesh is unit-less, so
  // normalise it to the ordered print height before exporting.
  if (heightMm && heightMm > 0 && format !== "obj") {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0) {
      const factor = heightMm / size.y;
      gltf.scene.scale.setScalar(factor);
      gltf.scene.updateMatrixWorld(true);
    }
  }

  if (format === "stl") {
    const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
    const output = new STLExporter().parse(gltf.scene, { binary: true }) as unknown as BlobPart;
    saveBlob(new Blob([output], { type: "model/stl" }), filename);
    return;
  }

  if (format === "obj") {
    const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js");
    const text = new OBJExporter().parse(gltf.scene);
    saveBlob(new Blob([text], { type: "text/plain" }), filename);
    return;
  }

  saveBlob(new Blob([build3mf(gltf.scene)], { type: "model/3mf" }), filename);
}

/**
 * Minimal but valid 3MF container: [Content_Types].xml, _rels/.rels and a
 * 3D/3dmodel.model with every mesh baked to world space. Units are mm, which
 * matches the scaling applied above — the file opens in a slicer at the
 * ordered size with no manual steps.
 */
async function build3mf(scene: import("three").Object3D): Promise<Uint8Array> {
  const [{ zipSync, strToU8 }, THREE] = await Promise.all([
    import("three/examples/jsm/libs/fflate.module.js"),
    import("three"),
  ]);

  scene.updateMatrixWorld(true);
  const vertex: string[] = [];
  const triangle: string[] = [];
  let offset = 0;
  const v = new THREE.Vector3();

  scene.traverse((child) => {
    const mesh = child as import("three").Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as import("three").BufferGeometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const index = geometry.getIndex();
    const count = position.count;

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      vertex.push(`<vertex x="${f(v.x)}" y="${f(v.y)}" z="${f(v.z)}"/>`);
    }
    const triCount = index ? index.count / 3 : count / 3;
    for (let t = 0; t < triCount; t++) {
      const a = (index ? index.getX(t * 3) : t * 3) + offset;
      const b = (index ? index.getX(t * 3 + 1) : t * 3 + 1) + offset;
      const c = (index ? index.getX(t * 3 + 2) : t * 3 + 2) + offset;
      triangle.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    }
    offset += count;
  });

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>${vertex.join("")}</vertices>
    <triangles>${triangle.join("")}</triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  });
}

function f(value: number): string {
  return (Math.round(value * 10000) / 10000).toString();
}
