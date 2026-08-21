# Simpler, clearer account area

Goal: make the account section feel like one calm place instead of four separate pages of stacked cards. Fewer clicks, clearer hierarchy, less visual noise — no changes to business logic, pricing, orders or payments.

## What changes

### 1. Account shell
- Replace the pill tab bar with a cleaner layout: a compact profile header (avatar, name, email, sign-out) and a sidebar of sections on desktop, horizontal scrollable tabs on mobile.
- Add icons to each section for faster scanning, and keep the active state obvious.
- Show a skeleton while auth is resolving instead of a blank frame.

### 2. Overview (landing tab)
- Cut the five equal stat cards down to three that matter: orders, awaiting payment, ready downloads. Projects and production status move into the lists they belong to.
- Turn "Latest orders" and "Latest projects" into tappable rows with clear status chips instead of small grey text.
- Replace the separate action card at the bottom with one primary "New portrait" button in the header area.
- Friendly empty state for new users: a short line plus the single next step, instead of an empty card.

### 3. Orders
- One consistent order row/card: order number + date on the left, status chips and total on the right, actions revealed inside the card.
- Filter chips (all / awaiting payment / paid / in production) so long lists stay usable.

### 4. Downloads
- Group downloads under their order with format badges (GLB / STL) and a single obvious download button per file.
- Clear locked state when an order isn't paid yet, with the pay action inline.

### 5. Settings — the biggest simplification
- Collapse the four stacked cards into a single page with grouped sections and consistent field widths.
- Profile: avatar, name, language in one row-based group with inline save (no separate save button per card where a field can save itself).
- Sign-in details and two-factor stay together under one "Security" group.
- Shipping address collapses to a summary line with an "Edit" toggle when already saved.
- 3D preview quality becomes a compact segmented control with one-line explanation.

### 6. Consistency polish
- Shared status chip component reused across overview, orders and downloads so colours and wording match everywhere.
- All new labels added in both English and Czech.
- Verified at 390px width and on desktop.

## Technical notes
- Touches only presentation: `src/components/account/AccountShell.tsx`, `OrderCard.tsx`, `src/routes/account.index.tsx`, `account.orders.tsx`, `account.downloads.tsx`, `account.settings.tsx`, plus a small shared `StatusChip` component and new `src/lib/i18n.tsx` keys.
- Existing data hooks (`useProfile`, `getAccountSummary`, download signed-URL functions, `TwoFactorCard`) are reused unchanged.
- No database, RLS, payment or email changes.
