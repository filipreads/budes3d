# Account area upgrade + performance pass

## Goal

Turn the single flat `/account` orders list into a proper account area (overview, orders, downloads, profile settings) in the current visual style, and make the whole app noticeably faster to load and navigate.

## 1. Account area

New account shell with in-page tab navigation (Overview · Orders · Downloads · Settings), same card/typography style as today, fully responsive (tabs collapse to a scrollable row on mobile).

**Overview**
- Greeting with display name/avatar.
- Stat tiles: total orders, awaiting payment, in production, available downloads, active projects.
- Latest 3 orders and latest 3 projects with quick links.
- Quick actions: new portrait, view projects, contact support.

**Orders**
- Search by order number, filter by payment status, fulfilment status and delivery type, sort by newest/oldest/amount.
- Pagination (10 per page) instead of loading everything.
- Each order expands to a status timeline (created → paid → in production → shipped/delivered) plus items, totals and shipping address.
- Existing actions kept: Pay now (embedded checkout), invoice PDF, share link toggle, downloads.

**Downloads centre**
- One list of every file across paid orders, with order number, format, size/label and date.
- Format choice per file (GLB / STL) using the existing export path, and a per-file "preparing" state.
- Empty state explaining files unlock after payment.

**Profile & settings**
- Edit display name, upload/replace avatar (stored in existing bucket, profile row updated).
- Preferred language (persists the current i18n choice to the profile).
- Change email and password through the auth API, with confirmation feedback.
- Sign out, plus a plain-language note about data and support.

All new copy added to both English and Czech dictionaries.

## 2. Performance

**Data loading**
- Move account/projects/dashboard reads to TanStack Query (the client already exists in the router context) with sensible stale times, so switching tabs or revisiting a page uses cache instead of refetching.
- Fetch order downloads in a single batched call instead of one request per order, and only for the visible page of orders.
- Select only the columns each view needs; add server-side pagination limits.

**Bundle / initial load**
- Lazy-load the heavy pieces behind their actual use: 3D viewer (three + fiber + drei) in the editor as it already is on the share page, Stripe embedded checkout only when "Pay now" is opened, jsPDF only when an invoice is requested.
- Split the i18n dictionary loading so only the active locale is parsed.

**Editor / 3D viewer**
- Memoise derived pricing/config values and debounce slider-driven state so placement changes don't re-render the whole editor.
- Reuse a single canvas/renderer setup, dispose geometries and textures on unmount, and throttle the generation polling interval with backoff.
- Do image quality analysis and rotation off the render path (downscaled sample) so uploads stay responsive.

**Housekeeping**
- Cancel in-flight requests on unmount to remove state-update warnings.
- Keep head metadata per route intact and add distinct titles/descriptions for the new account tabs where they are separate URLs.

## Technical notes

- Account tabs use nested routes under `/account` (`account.index.tsx`, `account.orders.tsx`, `account.downloads.tsx`, `account.settings.tsx`) with a shared `account.tsx` layout rendering the tab bar and `<Outlet />`.
- Profile reads/writes go through the existing `profiles` table under current RLS (own row only); avatar uploads reuse existing storage with a signed URL for display.
- No schema changes expected; if avatar storage needs its own bucket policy, that migration will include GRANTs and owner-scoped policies.
- Query keys scoped per user so sign-out clears cached account data.

## Out of scope

Payment logic, TRELLIS pipeline behaviour, pricing rules and admin pages stay functionally unchanged (admin pages only benefit from the shared caching layer).
