export type EditSettings = {
  zoom: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  brightness: number;
  contrast: number;
  warmth: number;
  smoothing: number;
  removedBackground: boolean;
};

export const DEFAULT_EDITS: EditSettings = {
  zoom: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  brightness: 100,
  contrast: 100,
  warmth: 0,
  smoothing: 0,
  removedBackground: false,
};

export function cssFilter(edits: EditSettings) {
  return [
    `brightness(${edits.brightness}%)`,
    `contrast(${edits.contrast}%)`,
    `sepia(${Math.max(edits.warmth, 0)}%)`,
    `saturate(${100 - Math.min(Math.max(-edits.warmth, 0), 60)}%)`,
    `blur(${(edits.smoothing / 100) * 1.6}px)`,
  ].join(" ");
}

/** Bakes crop/straighten/retouch settings into a square JPEG data URL. */
export async function renderEdited(src: string, edits: EditSettings, size = 1024): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.fillStyle = "#1b1a18";
  ctx.fillRect(0, 0, size, size);
  ctx.filter = cssFilter(edits);
  ctx.translate(size / 2 + (edits.offsetX / 100) * size, size / 2 + (edits.offsetY / 100) * size);
  ctx.rotate((edits.rotation * Math.PI) / 180);

  const scale = (size / Math.min(image.width, image.height)) * edits.zoom;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Export failed"))), "image/jpeg", 0.92),
  );
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image"));
    image.src = src;
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}
