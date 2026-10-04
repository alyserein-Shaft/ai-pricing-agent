# Understanding Stage — Al Mousa School — Run Delta

**Run ID:** `understanding-nvidia-restore-2026-10-02`
**Project:** `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
**Verdict:** `READY_FOR_HUMAN_DECISIONS`
**Checkpoint:** `/tmp/reconciliation/output/HUMAN_DECISION_CHECKPOINT.md`

## Findings

1. **"AI provider unavailable" was a stale build artifact, not credentials.**
   `dist/server/index.js` (built 01:10) contained 0 occurrences of `NVIDIA_NIM` / the NVIDIA base
   URL, while `worker/boq-understanding-provider.mjs` (01:46) had full support. `npx wrangler dev
   --local` serves `dist/server/`, so the NVIDIA path existed in source but never ran.
   After rebuild: `POST /api/dev/boq-ai/native-smoke` → `Ready — NVIDIA NIM configured`,
   `provider NVIDIA_NIM`, `schemaValid true`, `jsonModeHonored true`.

2. **Provider selection was hardcoded.** `vite.config.ts` pinned `BOQ_AI_PROVIDER: "cloudflare"`
   while already env-overriding `BOQ_AI_MODEL`. Changed to `process.env.BOQ_AI_PROVIDER ||
   "cloudflare"` (default unchanged). `worker/index.ts` widened the type + added `NVIDIA_*` env.
   These are the only two tracked files touched.

3. **82-item partition (canonical resolver, sums to 82):**
   `CURRENT_APPROVED 0 / REVALIDATION_REQUIRED 20 / NOT_ANALYZED 45 / AWAITING_HUMAN 17 / FAILED 0`.
   Baseline was 0 interpreted; 17 now carry a current NVIDIA interpretation.

4. **Controlled pilot cannot rotate — structural deadlock.**
   `alreadyInterpretedItemIds` (worker/estimator-understanding-api.mjs:359-400) keeps 10 items in the
   candidate pool permanently:
   - 7 items: `approvalIsStale` — review `source_input_fingerprint` ≠ current input fingerprint
     (e.g. `20c8fe0b`: review `d9b6cfef…` vs current `ebf91b41…`).
   - 3 items: latest attempt is a per-item retry whose `config_fingerprint` embeds a retry
     authorization, so it ≠ current `74e70cad…`.
   `selectPrimaryByDistinctFamily` then returns those same 10, consuming all 10 primary slots, and
   `runUnderstandingBatch` reuses the existing interpretation. 15 measured rounds →
   `newInterpreted=0` every round.

5. **No auto-approval fired** on any of the 17 new interpretations (0 review versions created
   2026-10-02). Cause is unresolved essential attributes, not provider failure:
   `operating_voltage` 14/17, `protocol` 12/17, `compatible_panel_family` 12/17,
   `loop_compatibility` 9/17.

6. **Governance disclosure:** 14 profiles carry `approved_for_matching=1` with
   `approval_reason = NULL`, `approved_by = NULL`, `created_by = local-development-user`,
   `itemClassification = 78` (< 80 gate). **Manually forced, not canonically justified.**

## Verification
- `tests/nvidia-document-shadow-api.test.mjs` → 13/13 pass (focused provider slice only).
- Full suite / golden gates / migration audits intentionally not run (out of scope).
- No commit, push, deploy, stash, reset or clean.