# TRELLIS.2 integration — architecture recommendation

## Verified facts (checked live against the Space)

- The Space runs Gradio `6.1.0` with API prefix `/gradio_api`.
- Its public named endpoints are:
  - `/start_session`, `/preprocess_image`, `/get_seed`
  - `/image_to_3d` → returns a **video preview**, not a mesh file
  - `/extract_glb` (args: `decimation_target`, `texture_size`) → returns **Extracted GLB + Download GLB**
- So a full run is a **multi-step, session-bound conversation**: preprocess → image_to_3d → extract_glb, with the generated asset held in per-session server state on the Space.
- The Space header states uploads are cached on Hugging Face servers for the session and that users should not upload sensitive data.

## Recommendation

**Call the TRELLIS.2 Gradio API server-side. Do not embed the Space (no Web Component, no iframe, no redirect).**

The generation step stays behind the existing `runTrellis` adapter in `src/lib/trellis.server.ts`; nothing in the Studio UI changes shape. Customers never see Gradio.

### Why not the three embed options

| Option | Verdict | Reason |
| --- | --- | --- |
| 1. Gradio Web Component (`@gradio/lite`-style embed, 6.1.0) | Reject | Ships Microsoft/HF branding and the raw research UI into checkout flow; you cannot capture the resulting GLB into our storage or order records (the file lives on HF's temp filesystem); no control over copy, i18n (Czech), or the approval step; heavy JS bundle on a route that already loads three.js. |
| 2. iframe | Reject | Same branding/UX problem, plus cross-origin isolation: we cannot read the produced GLB out of the frame, cannot tie it to a `projects` row, and cannot gate it behind payment. Also breaks the responsive Studio layout and mobile flows. |
| 3. Direct URL / redirect | Reject | The customer leaves the product mid-funnel and comes back with a file we never controlled. No order linkage, no approval gate, no download entitlement. |

All three also leak the fact that the pipeline is a free public Space, which invites customers to bypass paying.

### Why server-side API is right

- The Studio keeps ownership of upload, retouch, progress, preview, approval, pricing and the paid download — the whole flow we already built.
- The GLB is fetched by our server and stored in the private `portrait-models` bucket, so downloads are entitlement-checked and permanent (the Space's copy is temporary).
- Any credentials (HF token) stay server-side; CORS is irrelevant because the browser never talks to `hf.space`.
- Swapping to a paid/faster host later (dedicated HF endpoint, fal.ai, Replicate) touches one file.

## Production reality check: which TRELLIS host to call

Calling the **public** `microsoft-trellis-2.hf.space` from a server is fine for a pilot but is not a production dependency:

- It runs on **ZeroGPU** with per-IP/per-token quota. Server-side calls from one origin share one IP, so concurrent customers will hit `GPU quota exceeded` and queue rejections. Higher quota requires an HF account token (`HF_TOKEN`), and ZeroGPU quota attribution normally expects the `X-IP-Token` header that only a browser session supplies.
- Spaces sleep, restart, and can change their function signatures without notice.
- No SLA, no commercial terms for a paid product built on it.

Recommended path:
1. **Phase 1 (now):** integrate against the public Space with an `HF_TOKEN`, behind our adapter, with a hard timeout and a clear failure state. Good enough to validate quality and the flow.
2. **Phase 2 (before selling at volume):** duplicate the Space into our own HF account on a **dedicated GPU** (or point the adapter at fal.ai / Replicate TRELLIS). Only `trellis.server.ts` and one secret change.

## How the server-side call works

Gradio 6 REST protocol (no `@gradio/client` dependency — that library is not a safe fit for the Cloudflare Worker runtime):

```text
POST /gradio_api/call/preprocess_image   { data: [imageFileData], session_hash }
  -> { event_id }
GET  /gradio_api/call/preprocess_image/{event_id}   (SSE, read until "complete")

POST /gradio_api/call/image_to_3d        { data: [image, seed, resolution, ...], session_hash }
GET  /gradio_api/call/image_to_3d/{event_id}        (SSE: progress + queue position)

POST /gradio_api/call/extract_glb        { data: [decimation_target, texture_size], session_hash }
GET  -> file URL for the GLB
```

Key details:
- One **stable `session_hash` per project** for all three calls — `extract_glb` reads state left by `image_to_3d`. Start with `/start_session`.
- The image is passed as a **publicly reachable URL** (short-lived signed URL from our `portrait-uploads` bucket) or base64 — the endpoint accepts either.
- Auth: `Authorization: Bearer ${HF_TOKEN}` (secret, read inside the handler only).
- Our server downloads the returned GLB and re-uploads it to `portrait-models/{user_id}/{project_id}.glb`; `projects.model_url` stores that path instead of today's `sample://` ref.

### Progress and long-running jobs

Generation takes tens of seconds to minutes, plus queue time. Rather than holding one request open:

- `projects` gains generation job fields (`provider_job_id`, `session_hash`, `progress`, `stage`).
- `generateModel` starts the job and returns immediately; the Studio polls a lightweight `getGenerationStatus` server function every ~2s and drives the existing `StudioProgress` component (queued → preprocessing → sculpting → extracting GLB → ready), with real queue position from the SSE stream where available.
- Timeout and quota/queue errors surface as the existing failure state with a retry, and the customer is never charged for a failed run.

### Preview and download

- `image_to_3d` returns a preview **video**; `extract_glb` returns the mesh. The Studio shows the real GLB in the existing `ModelStage` viewer (loaded via `GLTFLoader` from a signed URL) — replacing the procedural sample mesh — and can optionally show the turntable video while the mesh extracts.
- STL is derived from the GLB (client-side exporter as today, or server-side at order time) so both promised formats stay real.
- Downloads remain gated by `order_downloads` and payment; the HF copy is never linked to the customer.

## Technical summary

- `src/lib/trellis.server.ts`: real implementation — `startSession`, `preprocessImage`, `imageTo3d`, `extractGlb`, SSE reader, GLB fetch + upload to storage. Reads `HF_TOKEN` (and an optional `TRELLIS_SPACE_URL` so the host is configurable) inside the handler.
- `src/lib/studio.functions.ts`: `generateModel` becomes start-job; add `getGenerationStatus`. Signatures the editor calls stay stable.
- Migration: add generation job/progress columns to `projects`.
- `ModelStage`: load a real GLB when `model_url` points at storage, keep the procedural fallback for legacy/sample projects.
- Secrets needed: `HF_TOKEN` (Hugging Face read token). Optional: `TRELLIS_SPACE_URL`.
- No client-side Gradio code, no CORS surface, no third-party UI shown to customers.

## Open question

If quality on the public Space is acceptable, do you want Phase 2 (own GPU host) planned in the same build, or after you have seen real generations?
