# Architecture Delta — Al Mousa Red Panel Selection (own shard, not consolidated)

Run: `panel-red-selection-2026-10-02`
Scope: governed-path authority + AMS-001/AMS-002 panel identity. No sizing.

---

## A-1. Human authority IS configured and IS correctly wired (corrects prior stale evidence)

- `.dev.vars` (gitignored, mtime 2026-10-02 03:14) configures
  `APP_HUMAN_ID=omair-primary`, `APP_HUMAN_NAME=Omair`, `APP_HUMAN_EMAIL=Omair@almespar.com`.
- `resolveHumanActor(env)` returns
  `{ id: "omair-primary", name: "Omair", email: "Omair@almespar.com", source: "server-configured-human-operator", synthetic: false }`.
  `isSyntheticActorId("omair-primary") === false`.
- `requireHumanActor` IS wired into **three** production mutation routes, each of which
  attributes the decision to `human.actor.id` and NOT to the synthetic `user.id`:
  - `worker/confidence-safety-api.mjs:64` — safety `approve` (Technical/Price)
  - `worker/technical-requirement-api.mjs:279` — `requirement-profile/approve-readiness`
  - `worker/estimator-understanding-review-api.mjs:302` — understanding review
- **This corrects** `EV-20261002-AL-MOUSA-TECH-APPROVAL-CHAIN-BLOCKED`, which asserted
  "no APP_HUMAN_ID/NAME/EMAIL in env or config". `.dev.vars` (03:14) predates that entry
  (13:25), so the claim was already false when written. The prior conclusion was reached
  through a broken `grep -r --include=…` on macOS (BSD grep), which silently returned no
  production callers.
- `.dev.vars` also sets `APP_USER_ID=local-development-user`, so `resolveApplicationContext`
  ownership remains the synthetic R1 account. Ownership and attribution are intentionally
  separate: mutations gated by `requireHumanActor` record the human; everything else
  records the operating account.
- **KNOWN GAP (disclosed, not changed):** `warnings/acknowledge`
  (`worker/confidence-safety-api.mjs:63`) records `acknowledged_by = user.id`, i.e. the
  synthetic account, with no `requireHumanActor` gate — even though acknowledgment is a
  precondition of the Technical approval.

## A-2. There is NO governed writer for a product model or cabinet-colour selection

- `finalModelSelection` occurs **exactly once** in all tracked source:
  `app/domain/fire-alarm-ecosystem-decision.mjs:167` → the hardcoded literal
  `"PENDING_LATER_ENGINEERING_DECISION"`.
- `worker/fire-alarm-ecosystem-decision-api.mjs` contains **no** model / variant /
  colour / cabinet concept at all — it records the ecosystem basis only (FARENHYT, IDP/SK).
- No table, column, or route persists a selected model or colour. The design intent is that
  the effective selection is *derived*, never stored, by
  `worker/primary-selection-authority.mjs` from: current match candidate + current
  `safety_decisions` + `safety_approval_requests(approval_type='Technical', status='Approved',
  entity_version == safety_decisions.version_number)`.
- ⇒ A Red-cabinet decision can only become machine-visible by completing that approval
  chain. There is no side-channel and none was fabricated.

## A-3. AMS-001 / AMS-002 panel identity — BLOCKED ON EVIDENCE (corrects prior characterisation)

Prior lore described these as two *outstanding `GENERIC_FACP_IDENTITY` adjudications to
govern*. That was wrong. Verified against approved architecture version 2
(`approvedArchitecture_65cb96aa-f897-4811-95dc-9d6aaddbcf0b`, 73 facts) and the live Stage-4
bridge:

- `PANEL_EXISTS` EXPLICIT rows sit on **4** sheets: AMS-001, AMS-002, BOS-005, WLC-005.
- `drawing_architecture_exception_adjudications` holds exactly **4** ACTIVE rows:
  2 `CROSS_SHEET_REFERENCE` (BOS, WLC) + 2 `GENERIC_FACP_IDENTITY` (**BOS, WLC only**).
  The 2 `GENERIC_FACP_IDENTITY` rows carry `building_code = BOS / WLC` and resolved
  `canonical_panel_identity = "FACP @BOS BUILDING" / "FACP @WLC BUILDING"`.
  `generic_facp_count = 2`, `unique_exception_count = 4`, `real_architecture_conflict_remaining = 0`.
- **No `GENERIC_FACP_IDENTITY` exception is emitted for AMS-001 or AMS-002 at all.** The
  exception inventory derives from pending review cases, and the AMS `PANEL_EXISTS` cases are
  already `Approved`. The 2 remaining `Needs Review` cases are `ARCHITECTURE_DISCREPANCY`
  (cross-sheet), not panel identities.
- Bridge per-row identity resolution (`adjudicationForRow`, sheet-level fallback to a
  `GENERIC_FACP_IDENTITY` on the same `source_drawing_number`):
  - BOS-005 → `FACP @BOS BUILDING` (adjudicated)
  - WLC-005 → `FACP @WLC BUILDING` (adjudicated)
  - **AMS-001 → `canonicalPanelIdentity = undefined`, adjudication = NONE**
  - **AMS-002 → `canonicalPanelIdentity = undefined`, adjudication = NONE**
- `adjudicateGenericFacp` cannot help: `CONFIRMED_SAME_PANEL` requires ≥3 strong anchors AND a
  non-empty `buildingCode`; with an empty code the identity token degenerates to the
  meaningless `"FACP @ BUILDING"`. Neither AMS sheet carries a building asset code (their
  served areas are GIRLS SCHOOL, BOYS SCHOOL, WELCOME CENTER, SUB STATION-1/2, DG STATION).
- **Structural cardinality conflict (new, material):** AMS-001 carries **1** `PANEL_EXISTS`
  FACP row but **6** DERIVED `PANEL_SERVES_AREA` facts (DG STATION, SUB STATION-1,
  BOYS SCHOOL, WELCOME CENTER, SUB STATION-2, GIRLS SCHOOL). AMS-002 carries **1**
  `PANEL_EXISTS` FACP row and **0** served areas. One drawn panel block cannot be resolved to
  six distinct served-area instances without new evidence.
- **Exact evidence gap to close AMS-001:** a building asset code on sheet
  `2401232- PC- AMS- DR- T-93-ZZZ-001`, plus panel-to-area cardinality evidence establishing
  how many distinct FACP instances the single drawn block represents.
- **Exact evidence gap to close AMS-002:** a building asset code on sheet
  `2401232- PC- AMS- DR- T-93-ZZZ-002`, plus the served-area facts that would anchor its
  single FACP block to an area.
- Neither gap is closable from current approved drawing evidence, so neither was forced.

## A-4. Database integrity hazard observed in the canonical D1 directory

`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` contains **two directory entries with a
byte-identical 71-byte ASCII name**: a **0-byte decoy** (inode 80324710) and the real
482 MB database (inode 66055287, actively growing). Name-based open is therefore ambiguous
and intermittently returned `SQLITE_CANTOPEN (14)`. Mitigation used: **all governed writes
went through the live `wrangler dev` runtime on `http://localhost:8787`** (which owns the
file), and all direct access used read-only `node:sqlite` (`{ readOnly: true }`) with retry.
Flagged for continuity; the decoy must not be used and the directory should be cleaned by
its owner.
