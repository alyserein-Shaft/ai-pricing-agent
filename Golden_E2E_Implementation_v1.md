# Golden E2E Implementation v1

## Status

**READY FOR LOCAL GOLDEN E2E EXECUTION**

The Golden harness contains two independent tests:

- `@golden-smoke`: verified previously in the normal Mac terminal.
- `@golden-full`: governed upload-to-issued-export journey with three deterministic cases.

The full test creates project state only through supported APIs/UI. Its only prerequisite seed is one reviewed global catalogue product and evidence source; it creates no project, BOQ, matching, pricing, approval, quotation, or export records.

## Deterministic cases

1. `GOLDEN-FA-001`, EA, quantity 2 — complete exact-model case.
2. Addressable interface module, EA, quantity 1 — incomplete and non-approvable.
3. `GOLDEN-NOMATCH-001`, EA, quantity 1 — explicit no-match case.

## Validation completed in the agent environment

- Playwright discovery: 2 tests in 2 files.
- Focused workflow/API/security/database tests: 38 passed, 0 failed.
- Current authoritative suite: 234 passed, 0 failed.
- Production build: passed.
- DOCX fixture: rendered and visually verified as one clean page.

## Execution environment

The coding-agent sandbox denied Wrangler/Miniflare loopback binding with `EPERM 127.0.0.1`. This is **SANDBOX EXECUTION UNAVAILABLE**, not a Golden product failure. The same smoke harness has already passed from the normal Mac terminal.
