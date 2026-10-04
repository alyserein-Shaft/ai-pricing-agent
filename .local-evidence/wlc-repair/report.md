# WLC coverage and rerun-consistency repair

## Outcome

The local application now preserves raw analysis attempts and historical findings separately from human review status. Two completed real runs verified the core WLC facts together; the second superseded the first without accumulating active duplicates. Browser reopening reproduced the same summary. This is an engineering-review candidate result, not engineering approval, compliance certification, complete connection understanding, or project closure.

Project: `project_c0123d91-c30b-4956-87cb-e473ef53f89d`  
Document: `doc_3f857096-3152-408f-9c86-9296e4142ced`  
File: `2401232-PC-WLC-DR-T-93-ZZZ-005.pdf`  
Final run: `drawingVisualRun_0bc482a7-5137-4407-9263-dcb1f27a9ade`

## Before / after with evidence

| Area | Verified before | Verified after | Source evidence |
|---|---|---|---|
| Sheet identity | Title and revision 1 were already persisted | Same title/revision appear alongside the engineering summary | [Title block](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/title-detail.png) |
| FACP location | Exact room survived in all 3 intake versions, but current AI location repeated the panel name | AT GROUND FLOOR SECURITY ROOM (00-026), with matching source text and saved image links | [Panel detail](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/panel-detail.png) |
| Circuits | AI reported LOOP-1/2/3 and NAC Unknown; LOOP-4 Spare | LOOP-1/2/3 Unknown; LOOP-4 Spare with adjacent SPARE source; NAC remains visible from deterministic evidence as Unknown | [Actual circuit image submitted to AI](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/actual-circuit-input.png) |
| Cable specifications | An AI row claimed unsupported 120V/15A cable detail; repeated source mentions were mixed into findings | 2×1.5 and 2×2.5 mm²; 2 distinct PDF text mentions each. Counts come from source records, not model estimates; no cable quantity or length inferred | [Panel detail](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/panel-detail.png) |
| Explicit reference | Present in source and proposals | 2401232-PC-AMS-T-00-ZZZ-002 remains in combined summary | [Reference note](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/reference-detail.png) |
| Rerun omission | 4 legacy Not Found records, no transition audit | Original statuses retained in history with reconstruction warnings. New omissions supersede outputs without asserting drawing absence | [Untouched baseline](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/before.json), [final persisted state](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/after.json) |
| Counting | “264 findings” mixed raw fragments and overlapping interpretations | 16 distinct current engineering candidates; 220 source fragments and 57 historical AI outputs excluded | [Exact displayed summary](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/application-summary.txt) |
| Traceability | No durable raw AI run history in the existing contract | Saved per-run inputs, PDF/version/hash, page/rotation, crop geometry, exact images, requests, raw model responses, output and model identifiers | [Final persisted run data](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/after.json), [image hash checks](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/image-persistence-check.json) |

## What 264 meant

The old `buildDrawingUnderstandingSummary` counted page overlay items with `Needs Review`, excluding identity/notes/ambiguity categories. `DrawingVisualReviewPanel` concatenated raw overlays, deterministic proposal families and AI rows.

**264 = 208 Text overlays + 1 Structure overlay + 11 DeviceCode groups + 44 other unreviewed candidate records.** The 44 included bare quantity annotations and overlapping AI/deterministic sources. Five deterministic loop tags were excluded because the system had labeled them Verified; no human reviewer was recorded. The Text overlays included a title-block representation; the intake itself had 207 Text assets, one Title Block and one composite Legend. The composite Legend repeats text and is not a second independent source.

Final storage: **28 deterministic + 17 current AI proposals**, plus **57 historical AI rows** (40 pre-repair + 17 first successful-run outputs). After excluding raw fragments, identity/notes/gaps, unsupported bare quantities and grouping overlapping sources, the application reports **16 distinct current engineering candidates**. This is a count of review candidates, not confirmed devices or engineering decisions.

## History and human decisions

Three intake versions exist; v3 remains current. No old intake was deleted. The original AI path upserted positional keys, so timestamps cannot recover overwritten run contents. The original FACP AI location and original raw model outputs cannot be reconstructed reliably from those records.

The four legacy Not Found rows share the old omission-retirement timestamp and have no reviewer or review event. This strongly matches the inspected old code path, but the database has no transition audit proving prior statuses. Their original status and evidence were retained, and they carry an explicit history warning; no guessed restoration occurred.

No human review decisions existed on the 68 original extraction proposals. A before/after comparison found **zero changes to their original fields** (including labels, evidence, statuses, timestamps and review fields). Only additive supersession/provenance columns were set on historical AI rows. Extraction review events remain zero. Human-review mutation tests used isolated in-memory fixtures only.

## Repairs

- Added complementary crop selection for equipment/location, circuit/status and notes/reference regions before filling remaining slots by text density. Same rotation-correct PDF renderer; page-specific text only.
- Added migration `0074_drawing_visual_runs.sql`, applied locally. Immutable run outputs use the existing proposal/review contract, with separate supersession fields. Failed attempts do not replace active findings.
- Added durable source images under the existing protected FILES binding; run inputs/requests/responses and output are stored in D1. Protected endpoints expose saved images and run data through existing ownership checks.
- Switched drawing synthesis to the stronger model already configured in this project: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Vision remains `@cf/llava-hf/llava-1.5-7b-hf`. Other workflows' provider settings were not changed.
- Added full response-contract validation, source-text references, source-based cable mention counting and conservative circuit-status association checks. Raw model claims remain available even when the application restricts a displayed interpretation.
- Reworked the readable summary to group overlapping engineering candidates and separate historical outputs/raw fragments. Added a history disclosure, saved image/response links, source quotes, and explicit “No human review recorded” wording.

## Verification actually performed

- Read-only SQL and protected API inspection of this WLC document before repairs; [inspection notes](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/inspection.md).
- Downloaded and rendered the source PDF; visually checked title, revision, FACP room, SPARE bracket, cable specs and explicit reference.
- Four real AI attempts: two 8B synthesis attempts failed with truncated JSON, followed by two completed 70B synthesis attempts. All four attempts' available raw outputs remain durable; failed attempts did not replace findings.
- **70 focused automated tests passed**, including rerun supersession, isolated human decision preservation, failed output retention, ownership, page scope, legacy-history flags, source counting, circuit status, crop selection and coordinate mapping. [Test output](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/tests.txt).
- Whole-project TypeScript checking ran. It still reports **7 errors in pre-existing `app/page.tsx` code outside the edited files**; no errors were reported in the changed drawing files. A clean whole-project type check/build is not claimed. [Type-check output](/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.local-evidence/wlc-repair/types.txt).
- Browser: final summary visible; full reload/reopening produced identical text; FACP inspector showed source quotes, saved image/response links and Needs Review / No human review recorded.
- All eight final-run images retrieved through the protected API and SHA-256 checked against the saved input manifest. Proposal records were unchanged after reopening.

## Remaining limits

The vision model can still misread drawing text; raw responses make this visible. The stronger synthesis did not reproduce NAC or every named interface, so the combined summary deliberately retains their deterministic source evidence. Unknown is insufficient evidence, not established connection understanding. Bare `2 Nos` remains a flagged model proposal, excluded from the engineering count. Cross-sheet text is verified, but the referenced document is not asserted to be resolved. No quantities, cable lengths, compliance or engineering acceptance were approved.

No commit, push, deploy, subagents or changes to the older demo workspace were performed. Work stayed in the confirmed active checkout.

## One manual review step

Open the FACP finding in the WLC Visual Review and use its **circuit / status** saved image to compare the room (00-026) and LOOP-4 SPARE bracket. Leave engineering approval pending until you are satisfied with the source evidence.

## Exact readable summary displayed by the application

FIRE DETECTION & ALARM SCHEMATIC — revision 1 (2401232- PC- WLC- DR- T-93-ZZZ-005). Engineering review is pending.

MAIN FINDINGS
Cable specifications: 2 X 1.5 sq.mm CWZ CABLE (2 source text mentions; Unspecified); 2 X 2.5 sq.mm CWZ FIRE RESISTANT CABLE (2 source text mentions; Unspecified).
Circuits: LOOP-1 (Fire alarm loop) — Unknown; LOOP-2 (Fire alarm loop) — Unknown; LOOP-3 (Fire alarm loop) — Unknown; LOOP-4 (Fire alarm loop) — Spare / Unpopulated; NAC LOOP — Unknown (tag found; status not established).
Drawing references: → 2401232-PC-AMS-T-00-ZZZ-002.
Equipment and locations: Fire alarm control panel — AT GROUND FLOOR SECURITY ROOM (00-026).
Interfaces: Video surveillance system; INTERFACE TO IBMS SYSTEM; INTERFACE TO ACS SYSTEM; INTERFACE TO ELEVATORS; INTERFACE TO PUBLIC ADDRESS & VOICE ALARM SYSTEM; INTERFACE TO EMERGENCY LIGHTING SYSTEM.
Possible connections: TO MFACP @ FCC ROOM KGS BUILDING.
Notes: The drawing is not to scale (N.T.S).
NEEDS CLARIFICATION
Cable lengths
Device models
Connection details between devices
Power supply details for each device
Specific fire alarm system standards or codes compliance
Unknown circuit status means insufficient evidence; connections and device assignments are not established.
16 distinct current engineering candidates; 10 overlapping source interpretations grouped. 220 source fragments and 57 historical AI outputs are not additional engineering findings.
1 additional model proposals need source clarification and are excluded from the engineering count.
Drawing is not to scale. Cable specification mentions are not lengths or additional quantities.
Human engineering approval remains pending.
