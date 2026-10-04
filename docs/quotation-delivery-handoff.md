# Quotation / export — final delivery handoff

**Canonical project:** `project_ae501b85-9c12-4332-bf8e-787c90f2d388` (Al Mousa School — Clean Golden Run, Fire Alarm)
**Canonical local D1:** `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98973748742cdd2cb05fb.sqlite`

This is the execution handoff for the moment the upstream lanes finish. **Nothing here has been
executed against the live database.** Every step is written to be run once, in order, by a human
operator during a maintenance window.

## The gate you must run first, always

```bash
node scripts/delivery-readiness-gate.mjs <sqlite> project_ae501b85-9c12-4332-bf8e-787c90f2d388
```

Read-only, exit `0` only when every gate passes, `1` while any gate is blocked. It prints seven
independent gates — `LIVE_RECONCILIATION_READY`, `REQUIREMENT_INTELLIGENCE_READY`,
`TECHNICAL_SELECTION_READY`, `PANEL_SIZING_READY`, `COMMERCIAL_PRICING_READY`,
`CANONICAL_QUOTATION_READY`, `EXPORT_READY` — each with a status, an affected count, explicit blocker
codes and the owning lane. It never repairs anything, and it deliberately has no generic
`NOT_READY`: distinct blockers stay distinct so an operator can see which lane owes what.

`--json` gives the same payload for automation.

## Execution order

| # | Step | Command / action | Gate to pass before continuing |
|---|------|------------------|-------------------------------|
| 1 | Establish the maintenance window | Stop `wrangler dev` / any worker holding the D1; confirm no writer | — |
| 2 | Verify canonical DB identity | `stat -f '%i %z %Sm' <sqlite>` and confirm the path is the canonical one | path and inode match what was recorded |
| 3 | Back up | `sqlite3 <sqlite> ".backup '<sqlite>.pre-delivery-$(date +%Y%m%d-%H%M%S)"` | backup exists, non-zero, `PRAGMA integrity_check` = `ok` |
| 4 | Reconciliation preconditions | `node scripts/check-live-reconciliation-preconditions.mjs <sqlite>` | exit 0 (`NULL_REQUIREMENT_ID_ROWS` = 0) |
| 5 | Reconcile to active head | `scripts/live-reconciliation-runbook.sh <sqlite>` — it re-verifies identity, re-proves on a copy, then applies the delta `0014_specification_clause_candidate_mechanism.sql,0019_fixed_angel.sql` | runbook exit 0 |
| 6 | Verify data invariants | Runbook steps 8–9: structural diff, then the project/BOQ/pricing/quotation row counts | counts unchanged |
| 7 | **Re-run the readiness gate** | `node scripts/delivery-readiness-gate.mjs <sqlite> <project>` | `LIVE_RECONCILIATION_READY` PASS |
| 8 | Create the quotation draft | `POST /api/projects/<project>/presales-workflow/quotation/draft` | `CANONICAL_QUOTATION_READY` PASS; record `quotationRevisionId` + `quotationFingerprint` |
| 9 | Commercial Approver decision | The governed approval decision. **Do not impersonate it.** If no human decision has been authorised, stop here and leave the draft in place | recorded decision with reason |
| 10 | Approve the quotation | `POST …/quotation/approve` with `{quotationRevisionId, quotationFingerprint, reason}` | 200, revision `Approved` |
| 11 | Approved Cost Sheet export | `POST /api/excel-exports/projects/<project>/exports` `{mode:"Approved Cost Sheet"}` | 201, job `Completed`, bound to the revision + both fingerprints |
| 12 | Client-Safe export | same route, `{mode:"Client-Safe Export"}` | 201, job `Completed` |
| 13 | Verify export currentness | Re-run the gate; confirm both jobs are governed, current, unsuperseded, uncancelled, and that their `evidence_fingerprint` still equals the current one | `EXPORT_READY` PASS |
| 14 | Issue the quotation | `POST …/quotation/issue` `{quotationRevisionId, exportJobId, reason}` | 200, revision `Issued`, one issue row |
| 15 | Final smoke | `node scripts/live-quotation-smoke.mjs <sqlite> <project>` | `QUOTATION_SMOKE = PASS` |
| 16 | Archive and report | Record the revision id, both export job ids, the issue id, both fingerprints, and the backup path | all ids recorded |

## Abort / rollback rules

Abort immediately, and restore the backup, on **any** of these:

| Trigger | Where it is caught | Rollback |
|---------|--------------------|----------|
| Canonical DB identity changes (path or inode) | runbook step 2 and the proof copy | abort before any write; nothing to restore |
| `NULL_REQUIREMENT_ID_ROWS > 0` returns | runbook step 5b, and the proof tool (exit 4) | abort before any write; nothing to restore |
| Project / BOQ / item counts change unexpectedly | runbook step 9 | restore the step-3 backup; stop |
| Structural verification shows a lost governed table | runbook step 8 | restore the step-3 backup; stop |
| Quotation authority becomes stale | `QUOTATION_FINGERPRINT_MISMATCH` / `QUOTATION_SNAPSHOT_METADATA_MISMATCH` on the next draft or export | discard the draft, do not retry blind; the evidence changed underneath |
| The pricing run is superseded, or a Commercial Price approval is stale/missing | `COMMERCIAL_PRICING_READY` blockers `PRICING_RUNS_ALL_SUPERSEDED` / `NO_COMMERCIAL_PRICE_APPROVAL` | no DB change to undo; re-run the gate after the pricing lane reissues |
| Panel-sizing authority becomes stale or missing | `PANEL_SIZING_READY` blocker `PANEL_SIZING_EVIDENCE_STALE` / `PANEL_SIZING_SNAPSHOT_REQUIRED` | no DB change to undo; the export freshness gate refuses issue |
| `quotationFingerprint` or `evidenceFingerprint` changes after the draft | any `QUOTATION_STALE` / `QUOTATION_EVIDENCE_STALE` response | the draft is void; supersede it by drafting again from current evidence |
| The export job is not governed or not current | `GOVERNED_EXPORT_REQUIRED` with `EXPORT_NOT_COMPLETED` / `EXPORT_MODE_NOT_GOVERNED` / `EXPORT_EVIDENCE_STALE` / `EXPORT_QUOTATION_MISMATCH` | do not issue; regenerate the export |
| The Client-Safe boundary test fails | `node --test tests/excel-export-client-safe.test.mjs tests/quotation-client-safe-boundary.test.mjs` | do not release any client-safe artefact; treat as a release blocker |

**Rollback point for each destructive step.** Steps 1–4 and 6–7 are read-only and have nothing to
undo. The only destructive maintenance step is **step 5**; its exact rollback point is the step-3
backup — restore with `cp <backup> <sqlite>` after stopping writers, then re-verify identity and
counts. No later step mutates schema; steps 8–14 write governed business rows (a quotation revision,
export jobs, an issue), which are the deliverable itself and are never rolled back by restore — they
are superseded through the governed path instead.

## Owning lanes for each blocker

The checker prints the lane with every blocker. Summary of who owes what:

- **requirement-intelligence** — the 520 legacy `requirement_id IS NULL` rows and unapproved
  requirement profiles. This is the only blocker on the live reconciliation itself.
- **technical-review** — open BOQ review, open safety blocks, open technical reviews.
- **fire-alarm-sizing** — the panel-sizing snapshot that a Fire Alarm project requires.
- **commercial-pricing** — selected scenario, pricing run, `approval_ready` lines, money fields, and
  the Approved `Commercial Price` approval.
- **quotation-approval** — the Commercial Approver decision on the quotation itself.
- **export-infrastructure** — already PASS; it only blocks again if the boundary or the snapshot
  authority regresses.