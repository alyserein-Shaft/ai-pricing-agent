# product_compatibility Disposition — DEPRECATED (2026-08-31)

## Decision

**DEPRECATE** `product_compatibility` as a duplicate of `engineering_relationships`.
Nothing was deleted — schema, migrations, the read API, and tests remain in
place. Only the always-empty "Compatibility" count in the Product Library
detail panel was removed from the UI.

## Why

- **Zero real rows**, ever.
- **No write path anywhere** in the codebase — confirmed by grep across
  `worker/`, `app/`, and `scripts/` for `INSERT INTO product_compatibility` /
  `UPDATE product_compatibility`: no matches.
- Two existing ingestion test suites already assert against writing to it:
  `tests/ifp75-datasheet-ingestion.test.mjs` ("persistence is checksum-
  idempotent and creates no compatibility records") and
  `tests/6815-persistence-safety.test.mjs` ("uses generic reviewed
  persistence without auto-governing family or compatibility") — prior
  engineering work already steered away from this table.
- Its only two consumers were both read-only GET endpoints in
  `worker/product-price-library-api.mjs` (`/api/products/:id` detail, and the
  generic `/api/products/:id/compatibility` sub-resource route), which — with
  zero rows — always returned an empty list. Displaying that as a permanent
  "Compatibility: 0" next to a real, populated "Accessories" count in the
  Product Library UI misrepresented product state: **real** compatibility
  exists for many products, but it lives in `engineering_relationships` (14
  real rows), which is what `technical-requirement-api.mjs`'s `loadInputs`
  and `product-matching-api.mjs`'s `loadProducts` actually query for
  compatibility during real matching. A permanent, meaningless zero in a
  governed product record is exactly the kind of correctness risk the
  original audit flagged.

## What changed

- Removed the "Compatibility" count from the Product Library product detail
  panel in `app/page.tsx` (the evidence-count grid and the "Technical
  evidence" summary sentence). Attributes, Certifications, and Accessories —
  all real, populated fields — are untouched.
- Added deprecation notices to `db/schema.ts` (`productCompatibility` table)
  and to both read sites in `worker/product-price-library-api.mjs`.
- No schema, migration, route, or data deletion. The `/api/products/:id`
  detail response and the `/api/products/:id/compatibility` sub-resource
  route still work exactly as before — nothing was removed from the backend
  contract, only from what the UI chooses to surface.

## Constraint for future work

Do not write to `product_compatibility` without a new, explicitly authorized
architecture decision. If `product_compatibility`'s more granular schema
(`targetFamilyId`, `requiredFirmware`, `requiredProtocol`, versioned rows)
is ever genuinely needed beyond what `engineering_relationships` expresses,
that is itself an architecture decision to make deliberately — not to back
into by resuming silent writes to an already-abandoned table.
