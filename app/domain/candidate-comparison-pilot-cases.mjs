// Limited in-app candidate-legend comparison pilot -- an EXPLICIT, bounded
// list of 6 real comparison cases, not a generic "auto-discover symbols"
// feature. Every region below is a STORED region already persisted by this
// application's own extraction:
//   - WLC regions are the canonical bounding boxes of real individual PDF
//     text items (drawing_assets, asset_type "Text") Drawing Intake already
//     extracted for doc_3f857096-3152-408f-9c86-9296e4142ced -- found by
//     querying for the exact letters/qualifiers each case needs, then
//     confirming their clustering by mapping them through this app's own
//     rotation-aware coordinate transform (drawing-coordinate-mapper.mjs).
//   - Legend regions are the stored symbolBoundingBox already persisted on
//     the real LegendDefinition proposals for
//     doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0 (candidate ELV legend),
//     produced by the earlier candidate-comparison run.
// This module proves those regions were used to render real crops through
// this app's own PDF.js/rotation pipeline -- it is NOT a claim that the
// application automatically discovers which text belongs to which symbol;
// that grouping was done once, by hand, against real queried data, for
// exactly these 6 cases.
//
// 3 provisional agreements (M) + 3 deliberately different pairs (D),
// covering the C/M qualifier distinction, the D/H qualifier distinction,
// and a square-vs-circle outline distinction, per the frozen selection
// from the external-tooling benchmark this pilot is verifying in-app.

const WLC_DOCUMENT_ID = "doc_3f857096-3152-408f-9c86-9296e4142ced";
const CANDIDATE_DOCUMENT_ID = "doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0";

// Union of the real stored text-asset canonical boxes for each WLC symbol
// occurrence, padded uniformly (+12 canonical units each side) to include
// the surrounding circle/square outline and any external qualifier mark --
// verified by direct visual inspection before use (see the pilot's own
// run report), not assumed.
const union = (boxes, pad) => {
  const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
  const y0 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

const WLC_H = union([{ x: 1336.7994652800002, y: 1088.6398874237482, width: 4.3675234159395355, height: 8.110316755871999 }], 12);
const WLC_S_PLUS_D = union(
  [
    { x: 1213.9195144320001, y: 1060.4399880038352, width: 4.034817338548019, height: 8.110316755871999 },
    { x: 1221.59951136, y: 1069.5593644930832, width: 4.360072738042606, height: 8.05739677704 },
  ],
  12,
);
const WLC_CE_PLUS_M_A = union(
  [
    { x: 1213.9195144320001, y: 929.5202141256159, width: 8.474821075907343, height: 8.110316755871999 },
    { x: 1218.959512416, y: 940.5596425814924, width: 5.035079865479969, height: 8.110316755871999 },
  ],
  12,
);
const WLC_CE_PLUS_M_C = union(
  [
    { x: 1583.0393667839999, y: 1014.4801705616196, width: 8.47476239865374, height: 8.110316755871999 },
    { x: 1587.959364816, y: 1025.6378809846838, width: 5.025283819386389, height: 8.110316755871999 },
  ],
  12,
);
const WLC_F = union([{ x: 1218.5995125600002, y: 1099.200040608808, width: 3.696062059749385, height: 8.110316755871999 }], 12);

// Legend symbolBoundingBox values are the REAL, already-persisted values
// from drawing_extraction_proposals.evidence for the candidate document's
// LegendDefinition rows (sequence numbers below) -- padded asymmetrically:
// a small margin on the row-spacing axis (+3, since consecutive legend
// rows sit only ~19.8 canonical units apart on that axis and a larger pad
// would bleed into the next row) and a larger margin on the along-row axis
// (+0 before, +26 after, since qualifier marks and the row divider sit
// further along that same axis, not before the symbol).
const legendPad = (box) => ({ x: box.x - 3, y: box.y, width: box.width + 6, height: box.height + 26 });
const LEGEND_ROW = {
  1: legendPad({ x: 556.0500000000001, y: 943.6, width: 19.096666666666668, height: 41.18888888888889 }), // S -- SMOKE DETECTOR
  2: legendPad({ x: 575.8955555555556, y: 943.6, width: 19.096666666666668, height: 41.18888888888889 }), // H -- HEAT DETECTOR
  3: legendPad({ x: 595.7411111111112, y: 943.6, width: 19.096666666666668, height: 41.18888888888889 }), // S + D -- DUCT DETECTOR
  4: legendPad({ x: 615.5866666666667, y: 943.6, width: 19.096666666666668, height: 41.18888888888889 }), // S + H -- SMOKE AND HEAT COMBINED DETECTOR
  18: legendPad({ x: 915.8911111111112, y: 943.6, width: 19.096666666666668, height: 41.18888888888889 }), // CE + C -- INTERFACE MODULE CONTROL
  19: legendPad({ x: 935.7366666666667, y: 943.6, width: 19.096666666666668, height: 41.18888888888889 }), // CE + M -- INTERFACE MODULE MONITORING
};

const CANDIDATE_ENTRY = (sequence, id, label, description) => ({
  id,
  sequence,
  entry_type: "Symbol",
  label,
  description,
  qualifiers: "",
  section: "FIRE ALARM SYSTEM",
  boundingBox: LEGEND_ROW[sequence],
  symbolBoundingBox: LEGEND_ROW[sequence],
});

// The 6 frozen pilot cases. category/expectation are provenance/reporting
// metadata only -- never sent to the model (the neutral prompt carries no
// hints), used only to compare the app-generated result against the
// already-recorded reference observation from the external-tooling
// benchmark this pilot verifies.
export const CANDIDATE_COMPARISON_PILOT_CASES = [
  {
    caseId: "M-H",
    category: "provisional agreement",
    note: "H vs H",
    wlcRect: WLC_H,
    legendEntry: CANDIDATE_ENTRY(2, "fa-row-02", "H", "HEAT DETECTOR"),
    priorExternalObservation: "circle/circle, H/H, no qualifier either side -- agreement, correct on the external-tooling recovery run",
  },
  {
    caseId: "M-SD",
    category: "provisional agreement",
    note: "S+D vs S+D",
    wlcRect: WLC_S_PLUS_D,
    legendEntry: CANDIDATE_ENTRY(3, "fa-row-03", "S + D", "DUCT DETECTOR"),
    priorExternalObservation: "circle/circle, S/S, external D/D detected and transcribed correctly both sides -- agreement, correct on the external-tooling recovery run",
  },
  {
    caseId: "M-CEM",
    category: "provisional agreement",
    note: "CE+M vs CE+M",
    wlcRect: WLC_CE_PLUS_M_A,
    legendEntry: CANDIDATE_ENTRY(19, "fa-row-19", "CE + M", "INTERFACE MODULE MONITORING"),
    priorExternalObservation: "circle/circle, CE/CE, external M/M detected -- agreement, correct on the external-tooling recovery run (case read as lowercase 'm' there, flagged not penalized)",
  },
  {
    caseId: "D-CM",
    category: "deliberately different",
    note: "WLC CE+M vs Legend CE+C -- C/M qualifier distinction",
    wlcRect: WLC_CE_PLUS_M_C,
    legendEntry: CANDIDATE_ENTRY(18, "fa-row-18", "CE + C", "INTERFACE MODULE CONTROL"),
    priorExternalObservation: "circle/circle, CE/CE, external M vs external C correctly distinguished -- correctly flagged different, correct on the external-tooling recovery run",
  },
  {
    caseId: "D-DH",
    category: "deliberately different",
    note: "WLC S+D vs Legend S+H -- D/H qualifier distinction",
    wlcRect: WLC_S_PLUS_D,
    legendEntry: CANDIDATE_ENTRY(4, "fa-row-04", "S + H", "SMOKE AND HEAT COMBINED DETECTOR"),
    priorExternalObservation: "circle/circle, S/S, external D vs external H correctly distinguished -- correctly flagged different, correct on the external-tooling recovery run",
  },
  {
    caseId: "D-SQ",
    category: "deliberately different",
    note: "WLC F (square) vs Legend S (circle) -- outline distinction",
    wlcRect: WLC_F,
    legendEntry: CANDIDATE_ENTRY(1, "fa-row-01", "S", "SMOKE DETECTOR"),
    priorExternalObservation: "square vs circle and F vs S both explicitly and correctly distinguished -- correctly flagged different, correct on the external-tooling recovery run",
  },
];

export const CANDIDATE_COMPARISON_PILOT_DOCUMENT_IDS = {
  wlc: WLC_DOCUMENT_ID,
  candidate: CANDIDATE_DOCUMENT_ID,
  projectId: "project_c0123d91-c30b-4956-87cb-e473ef53f89d",
};
