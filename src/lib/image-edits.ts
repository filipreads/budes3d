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

/** Rotates an image by a multiple of 90° and returns a new data URL. */
export async function rotate90(src: string, direction: 1 | -1 = 1): Promise<string> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.height;
  canvas.height = image.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((direction * Math.PI) / 2);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export type QualityReport = {
  width: number;
  height: number;
  /** 0–100, higher is sharper. */
  sharpness: number;
  /** 0–255 average luminance. */
  brightness: number;
  warnings: ("resolution" | "blurry" | "dark" | "bright")[];
};

/** Cheap client-side quality check run before a generation is started. */
export async function analyzeImageQuality(src: string): Promise<QualityReport> {
  const image = await loadImage(src);
  const sample = 256;
  const canvas = document.createElement("canvas");
  canvas.width = sample;
  canvas.height = sample;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(image, 0, 0, sample, sample);
  const { data } = ctx.getImageData(0, 0, sample, sample);

  const gray = new Float32Array(sample * sample);
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const value = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    gray[i] = value;
    sum += value;
  }
  const brightness = sum / gray.length;

  // Laplacian variance — the standard cheap blur estimate.
  let mean = 0;
  const lap: number[] = [];
  for (let y = 1; y < sample - 1; y += 1) {
    for (let x = 1; x < sample - 1; x += 1) {
      const i = y * sample + x;
      const value =
        4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - sample]! - gray[i + sample]!;
      lap.push(value);
      mean += value;
    }
  }
  mean /= lap.length;
  const variance = lap.reduce((acc, value) => acc + (value - mean) ** 2, 0) / lap.length;
  const sharpness = Math.min(100, Math.round(variance / 4));

  const warnings: QualityReport["warnings"] = [];
  if (Math.min(image.width, image.height) < 700) warnings.push("resolution");
  if (sharpness < 12) warnings.push("blurry");
  if (brightness < 55) warnings.push("dark");
  if (brightness > 225) warnings.push("bright");

  return { width: image.width, height: image.height, sharpness, brightness, warnings };
}
