/**
 * Browser-side delivery of purchased files.
 * The stored asset is always a GLB; STL is converted in the browser from that
 * exact mesh, so what the customer approved is what they receive.
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
) {
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error("Could not fetch the model file");
  const buffer = await response.arrayBuffer();

  if (format !== "stl") {
    saveBlob(new Blob([buffer], { type: "model/gltf-binary" }), filename);
    return;
  }

  const [{ GLTFLoader }, { STLExporter }] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/exporters/STLExporter.js"),
  ]);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");

  // Slicers read STL as millimetres. The generated mesh is unit-less, so
  // normalise it to the ordered print height before exporting.
  if (heightMm && heightMm > 0) {
    const { Box3, Vector3 } = await import("three");
    const box = new Box3().setFromObject(gltf.scene);
    const size = box.getSize(new Vector3());
    if (size.y > 0) {
      const factor = heightMm / size.y;
      gltf.scene.scale.setScalar(factor);
      gltf.scene.updateMatrixWorld(true);
    }
  }

  const output = new STLExporter().parse(gltf.scene, { binary: true }) as unknown as BlobPart;
  saveBlob(new Blob([output], { type: "model/stl" }), filename);
}
