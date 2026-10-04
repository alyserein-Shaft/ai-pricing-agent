# Lore conflict packet — runs `lore-recovery-2026-10-02` + `lore-gap-closure-2026-10-02`

Status: **U1 RECORDED AS AN EXPLICIT HISTORICAL GAP · U2 RECORDED AS
`UNRESOLVED_HISTORICAL_REFERENCE`.** Neither was resolved by guessing.

Produced by the 2026-10-02 `.lore` continuity repair. Nothing below was
auto-resolved, and no shared ledger was ever overwritten from a backup.

---

## U1 — 2 historical evidence records unrecoverable. CONTENT UNKNOWN.

**`2 HISTORICAL EVIDENCE RECORDS UNRECOVERABLE — CONTENT UNKNOWN`**

No placeholder `EV-...` IDs were minted and no content was reconstructed. The
gap is recorded as metadata in `.lore/EVIDENCE.md` under
`EV-20261002-HISTORICAL-GAP-EVIDENCE-2-UNRECOVERABLE`, which is a record *about*
the missing history, not a stand-in for either lost record.

### Count discrepancy, preserved

| Quantity | Value | Source |
|---|---|---|
| Pre-clobber record count, asserted | **65** | `.lore/SUMMARY.md:4` (`EVIDENCE 65`), written 2026-10-02 01:09:06 |
| Historical records recovered verbatim | **61** | git dangling blob `73365a53` (46) + codex rollout transcript lines 80–108 of the pre-collision file (15) |
| Known 2026-10-02 records present live | **2** | `EV-20261002-PRODUCT-FAMILY-CONTRACT-CLOSURE-T2`, `EV-20261002-BATCH-3C-DEMAND-WEIGHTED` |
| **Unrecoverable** | **2** | 65 − 61 − 2 |
| Recovered records altered during restore | **0** | byte-identical to source, verified |

### Why the asserted 65 is the pre-clobber file, not the shipped one

`SUMMARY.md` and `EVIDENCE.md` were both last written at 2026-10-02 01:09:06.
At that moment `EVIDENCE.md` contained **2** records, while `SUMMARY.md` asserted
**65**. The same `SUMMARY.md` measured `ARCHITECTURE 28`, `DECISIONS 46` and
`CONVENTIONS 33` exactly — all three matched the live files. So 65 was not
measured from the file that shipped; it describes the file the agent read
before the whole-file replacement. This is itself an instance of the
assert-from-memory failure the shard rules now prevent.

### Honest bound on the figure

61 is the record count in the last recoverable snapshot (the pre-collision file
ended at line 108 = 61 records). The gap of 2 holds only if no further
pre-2026-10-01 record was appended between that snapshot and the clobber.
Nothing in the surviving corpus records that window. **True unrecoverable count
is therefore bounded at 0–4, with 2 the only value consistent with the asserted
65.** No source can narrow it further.

### Recovery sources searched (all exhausted)

- git unreachable/dangling blobs, all 540 (`73365a53` = 46-record pre-collision
  index; `b11371773` = 37-record subset, strict subset of the 46)
- git stash-index snapshot `93b327a0` (2026-10-01 19:39) — 18-line post-revert file
- codex rollout transcripts (`~/.codex/sessions/**`) — last bounded read
  `nl -ba .lore/EVIDENCE.md | sed -n '80,115p'`, file ended at line 108
- `~/.claude/**` session stores
- repository working tree, tracked history (`git log --all -S`)

No source mentions any `EV-...` ID outside the 61 recovered + 2 known-current set.

### Date/context of the collision

2026-10-02, between 01:08:34 and 01:09:06 EEST. Concurrent agents replaced
`.lore/EVIDENCE.md`, `.lore/SUMMARY.md` and the `_global` ledgers from in-memory
snapshots. Only `EVIDENCE.md` actually lost records; the `_global` ledgers and
`SUMMARY.md` are provably complete (see U2 test 1). Root cause and rule:
`DEC-2026-10-02-8c07` and workflow §21.4.1.

---

## U2 — `SUMMARY.md:82 -> DEC-2026-10-02-4f27`

**`UNRESOLVED_HISTORICAL_REFERENCE`**

### The reference

```
.lore/SUMMARY.md:82
#- **Batch 3C: 15 address models promoted from ONE source; BOQ sizing coverage 92.3% -> 98.7%** — [_global/DECISIONS.md#DEC-2026-10-02-4f27]
```

### A (typo) — not provable

At least three defensible repairs, not separable by surviving evidence:

1. re-anchor to `DEC-2026-10-02-c4e1` — the Batch 3C decision, cited by the
   **very next line** (83) of the same SUMMARY block;
2. re-anchor to `EV-20261002-BATCH-3C-DEMAND-WEIGHTED` — the line's text is a
   near-verbatim restatement of that evidence record's scope/assertion field;
3. drop the line as a duplicate of line 83.

Content matching does not separate them. The line states "15 address models" and
"92.3% -> 98.7%"; **no** `DEC-`/`CONV-`/`ARCH-` entry anywhere contains either
string. The only surviving `4f27` ID is `CONV-2026-10-02-4f27` ("attribute a test
failure only after proving the test cannot see your change"), whose content is
unrelated to the line — so the matching suffix does not identify an intended
target either. Choosing one would be a guess.

### B (genuinely lost decision) — REFUTED

`SUMMARY.md:4` asserts `DECISIONS 46`. Live `.lore/_global/DECISIONS.md` holds
exactly **46 entries, 46 unique**. A destroyed decision would leave 45. The
same identity holds for `ARCHITECTURE` (asserted 28 = live 28). `DECISIONS.md`
is therefore provably complete against its own measured digest, and no decision
is missing. `DEC-2026-10-02-4f27` also appears in no git object, no backup, and
no pre-collision transcript.

### C — `UNRESOLVED_HISTORICAL_REFERENCE`

Not repaired. Correction requires continuity-owner intent, which no surviving
source records.

### Supporting anomaly

Line 82 is the **only** line in all 115 lines of `SUMMARY.md` with a stray
leading `#`, which makes it a Markdown H1 rather than a list item. Every other
digest line is `- **Title** — [anchor]`. This is consistent with a hand-editing
artefact but does not identify the intended target, so it supports C rather than
any specific repair.

### Scope check

`DEC-2026-10-02-4f27` is the **only** dangling anchor in `SUMMARY.md`
(100 anchors, 99 unique, 1 dangling). No other reference is affected.

---

## Closure status (2026-10-02)

- **Mechanism:** safe for concurrent agents using shards. Verified by the
  focused 30/30 simulation and, in production use, by
  `.lore/runs/loop-powered-av-2026-10-02/` consolidating cleanly alongside
  `.lore/runs/lore-concurrency-2026-10-02/` with no loss.
- **Historical completeness:** incomplete by exactly the U1 gap, bounded 0–4,
  plus the U2 unresolved reference. Neither blocks future concurrency.
