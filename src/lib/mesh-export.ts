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

export async function downloadModelFile(signedUrl: string, format: string, filename: string) {
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
  const output = new STLExporter().parse(gltf.scene, { binary: true }) as unknown as BlobPart;
  saveBlob(new Blob([output], { type: "model/stl" }), filename);
}
