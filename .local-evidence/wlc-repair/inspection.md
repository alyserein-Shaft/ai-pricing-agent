# WLC read-only inspection (before repairs)

Scope: project_c0123d91-c30b-4956-87cb-e473ef53f89d / doc_3f857096-3152-408f-9c86-9296e4142ced. The source was downloaded through the protected document endpoint and rendered for direct visual inspection.

## Persisted state

- Three drawing intake versions; v3 is current. Each contains 209 assets (207 Text, one Title Block, one composite Legend). The composite repeats source text and is not an independent source.
- All 68 extraction proposals belong to v3: 28 deterministic, 40 AI. AI: 36 Needs Review, four legacy Not Found.
- No human reviewer on any of the 68 proposals; no extraction, symbol or structure review events, and no title-block field reviews for this document. Five deterministic loop tags carry system-generated Verified, not human approval.
- The three intake audit events establish intake completion, not individual AI runs. Existing AI rows were positionally upserted. Created/updated timestamps show changes, but do not reconstruct overwritten responses or run membership.
- Exact FACP location survives in source text in all three intakes: AT GROUND FLOOR SECURITY ROOM (00-026). Current AI equipment row has the panel name as its location, not the room. Prior AI location output cannot be recovered from these tables.

## Four legacy Not Found rows

All have reviewed_by NULL, no review events, and updated_at 2026-09-15T13:25:19.756Z, immediately preceding the current AI updates. The inspected omission-retirement code writes precisely these statuses. This is strong evidence of the rerun path, but there is no transition audit proving their prior status. Do not restore by guessing.

- c830e73e: 2 X 2.5 sq.mm CWZ FIRE RESISTANT CABLE (NAC LOOP).
- ebcaf837: 1 PAIR TELEPHONE CABLE FOR EACH FIREMAN TELEPHONE JACK.
- 574400a1: Image 5 interface/reference text illegible.
- 15dbab69: Image 5 component/connection details unclear.

Full identifiers and untouched original values are in before.json.

## Trace of displayed 264

Browser Visual Review displayed “264 findings still need engineer review”. The value comes from buildDrawingUnderstandingSummary -> active items with reviewStatus Needs Review, excluding drawingIdentity, notes and missingOrAmbiguous. Input pageItems concatenates base overlays, deterministic general extraction, deterministic drawing intelligence and AI proposals in DrawingVisualReviewPanel.

264 = 208 Text overlays + 1 Structure overlay + 11 DeviceCode groups + 44 remaining unreviewed candidate records. The 44 include 15 AI quantity annotations, overlapping AI/deterministic interpretations, and an unsupported AI cable description. Five deterministic loop tags are excluded from 264 because their system status is Verified. Total rows in the old main-findings grouping: 269, not 264 independent decisions.

## Direct source evidence

Rendered panel-detail.png shows FACP and room (00-026), LOOP-1 through LOOP-4, NAC LOOP, SPARE bracket specifically below LOOP-4, 2 X 1.5 sq.mm CWZ CABLE and 2 X 2.5 sq.mm CWZ FIRE RESISTANT CABLE. Source title/revision and explicit cross-reference agree with the persisted PDF text. No lengths inferred; the drawing is N.T.S.

No original raw AI response was found in the existing drawing persistence contract. No previous approval was inferred. No unrelated project records were inspected.
