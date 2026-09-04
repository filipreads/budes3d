# Photo-to-3D: alternative engines + roadmap for editing, slicing, export

## Current state

Generation goes through one swappable adapter (`src/lib/trellis.server.ts`) that speaks the Gradio `sse_v3` queue protocol to the public Microsoft TRELLIS.2 Space (`microsoft-trellis-2.hf.space`, ZeroGPU). The UI never touches the provider directly, so switching engines means changing this one file plus one secret. Downstream, GLB/STL download, scaling-to-mm and placement baking already exist (`src/lib/mesh-export.ts`, `src/lib/placement-metrics.ts`).

## Engine alternatives (photo → 3D)

| Engine | Access | Cost per model | Quality | Print suitability | Verdict |
| --- | --- | --- | --- | --- | --- |
| **TRELLIS.2 public Space (now)** | Free, ZeroGPU quota, shared IP | ~$0 | Good geometry, rough textures | Medium | Keep as free/fallback tier |
| **Own TRELLIS.2 on dedicated HF GPU** | Duplicated Space, ~$0.5–1.1/hr GPU | cents + fixed GPU cost | Same, no queue | Medium | Best first upgrade when volume grows |
| **Tripo3D API** | REST, task polling | ~$0.10–0.30 | Very good, watertight-ish meshes | High (offers print-ready export) | Best quality/price for production |
| **Meshy API (v6)** | REST, task polling | ~$0.15–0.40 | Best textures, retopology options | High | Best when customers pay for premium |
| **Rodin (Hyper3D)** | API, pricier | ~$0.50+ | Top-tier portraits | High | Premium tier option |
| **fal.ai / Replicate hosting of Trellis/Hunyuan3D** | Per-call serverless GPU | ~$0.02–0.10 | Same models, no self-hosting | Medium | Easiest drop-in replacement for the Space |

**Recommendation:** a two-provider strategy behind the existing adapter —

1. Keep TRELLIS.2 (own dedicated Space on HF, or fal.ai hosted) as the **standard tier** — cheap drafts, fast.
2. Add **Tripo3D** as the **premium tier** — both expose a simple `create task → poll → download GLB` REST flow that maps 1:1 onto our existing `generateModel`/`getGenerationStatus` server functions and the queued/preprocessing/sculpting/extracting/storing stage model.

Economics: at portrait-studio prices the generation cost is a few percent of the order either way; the real cost driver is failed regenerations, so a cheap draft step before a premium run pays for itself.

## Next-step roadmap (in dependency order)

**Phase 1 — provider abstraction (small)**
- Generalize `trellis.server.ts` into a `Provider` interface (`start(imageUrl) → jobId`, `status(jobId)`, `download(jobId)`), implement `TrellisProvider` (current code, unchanged behavior) and `Tripo3dProvider`.
- Provider + tier stored on the project row; studio shows which engine is running.

**Phase 2 — mesh editing (medium)**
- Client-side in the existing three.js viewer: decimation/simplification, hole filling, smoothing, and "make watertight" check before approval — all via `three` + a WASM mesh library, no new backend.
- Editing ops recorded as a config list (like placement), reapplied at export so the stored original GLB is never mutated.

**Phase 3 — pre-print checks + slicing (medium)**
- Server-side or browser-side analysis: wall thickness, overhang/self-intersection report, volume estimate → feed the existing pricing (material grams → price) so quotes reflect the real mesh.
- Slicing itself: do **not** build a slicer. Export print-ready STL/3MF (we already bake scale + placement) and hand off to the customer's slicer, or integrate a print-shop API later. Optionally generate a `.3mf` with orientation metadata — cheap to add, big UX win.

**Phase 4 — export formats (small)**
- Add 3MF and OBJ alongside GLB/STL (three.js exporters), plus a textured GLB for digital-tier buyers.
- Server-side export at order time for paid orders so customers can't regenerate files for free.

## Performance notes

- Viewer already lazy-loads three.js and has a low/high quality toggle; decimation in Phase 2 also reduces mobile load times (target < 500k tris for preview).
- Keep the poll-based job model (already resumable after reload) — all candidate providers support it, so no realtime infra is needed.

## What I'd build first

1. Provider interface + Tripo3D as premium engine (unlock revenue tier, remove ZeroGPU quota pain).
2. Watertight/repair check before the Approve button (kills the biggest refund risk).
3. 3MF export with baked scale/placement.

Say which of these you want and I'll turn it into an implementation plan.
