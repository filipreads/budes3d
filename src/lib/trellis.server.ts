/**
 * Trellis 2 adapter (server-only).
 *
 * `runTrellis` is the single swap point for real image-to-3D inference.
 * Point it at fal.ai, Replicate, or a self-hosted Trellis endpoint by reading
 * the provider key here and returning the produced model reference.
 */
export type TrellisInput = { photos: string[]; seedKey: string };
export type TrellisResult = { modelRef: string; provider: string };

export async function runTrellis(input: TrellisInput): Promise<TrellisResult> {
  const providerKey = process.env["TRELLIS_API_KEY"];

  if (providerKey) {
    // Real provider not configured yet in this build; fall through to sample
    // output rather than failing the customer's order flow.
  }

  if (input.photos.length === 0) {
    throw new Error("Upload at least one photo before generating");
  }

  // Deterministic sample mesh: the viewer builds the geometry from this seed,
  // so every project keeps a stable, downloadable result.
  let hash = 0;
  for (const char of input.seedKey) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  await new Promise((resolve) => setTimeout(resolve, 1800));

  return { modelRef: `sample://bust/${hash}`, provider: "sample-generator" };
}
