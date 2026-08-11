# Photo → 3D Portrait Studio

An online service where customers upload a portrait photo, edit and configure it, get an AI-generated 3D model preview, then buy either the digital file or a printed piece.

## What gets built

**1. Landing page (`/`)**
Hero with a live rotating 3D sample, how-it-works (Upload → Edit → Preview → Order), gallery of examples, trust/FAQ, CTA into the editor.

**2. Pricing (`/pricing`)**
Three tiers side by side: Digital file, Printed (per size), Studio (multi-photo + revisions). Add-on table for finishes, bases, rush. Each tier links into the flow with the choice preselected.

**3. Editor (`/editor`)** — the core product
- Upload: drag-and-drop, multi-photo input (front/side references), file validation, crop and straighten.
- Retouch: background removal, brightness/contrast/warmth, blemish smoothing, subject isolation preview.
- Generate: sends the prepared image(s) to the 3D engine, shows progress states.
- Preview: interactive 3D viewer (orbit, zoom, pan, lighting toggle, wireframe/solid), regenerate with different settings.
- Configure: final dimensions (height in mm/in with live scale reference), material/finish, base/plinth style, engraving text, quantity — price updates live.
- Approve: side-by-side original photo vs 3D result, approve to proceed to checkout.

**4. Checkout (`/checkout`)**
Order summary from the editor config, delivery type (download vs shipped print), shipping address when physical, Stripe payment, confirmation page.

**5. Accounts**
Email/password + Google sign-in, order history, saved projects (resume an unfinished editor session), re-download purchased files anytime, download-link expiry per order.

## 3D generation

Trellis 2 is not part of Lovable's built-in AI, so the generation step is built behind a single swappable server-side adapter. For now it returns a sample 3D model after a realistic progress delay, so the whole flow is fully clickable end to end. When you're ready, you provide a fal.ai / Replicate / self-hosted key and only that adapter changes — no UI or database rework.

## Technical notes

- Lovable Cloud for database, auth, and file storage (uploads bucket private, generated models private with signed download URLs).
- Tables: `profiles`, `projects` (photo refs, edit settings, generated model, status), `orders` (line items, config snapshot, price, fulfilment status, shipping address), `order_downloads`, `user_roles` (separate table, for an admin fulfilment view later). RLS on everything, scoped to `auth.uid()`.
- Generation runs in a server function so the provider key is never exposed; job status polled from the editor.
- 3D viewer with `three` + `@react-three/fiber`, loaded client-side only.
- Image retouching client-side (canvas) so uploads stay light; background removal server-side.
- Stripe for payments (digital + physical in one checkout). Prices are computed server-side from the config so the client can't tamper with them.
- Per-route SEO metadata; landing and pricing are the indexable marketing surface.

## Order of work

1. Cloud + auth + schema + storage
2. Landing + pricing
3. Editor (upload → retouch → generate → viewer → configure)
4. Checkout + Stripe + order confirmation
5. Account area (orders, downloads, saved projects)
6. Publish

## Not included yet

Real Trellis inference, print-shop fulfilment integration, shipping-rate API. Each is a clean add-on once the flow is live.
