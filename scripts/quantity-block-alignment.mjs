import { DatabaseSync } from "node:sqlite";
import { reconstructBlocks, blockFingerprint, evaluateAlignments } from "../app/domain/quantity-block-alignment.mjs";

const PROJECT = "project_29b4c399-2453-4a53-96c6-0434e15f13bb";
const DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const db = new DatabaseSync(DB, { readOnly: false });

// Simpler direct query for the MECH RFQ raw items:
const items = db.prepare(`
  SELECT id, description, numeric_quantity AS quantity, normalized_unit, item_number,
         CAST(json_extract(source_location,'$.row') AS INTEGER) AS rw
  FROM boq_items
  WHERE project_id=? AND source_location LIKE '%MECH RFQ%'
  ORDER BY rw, item_number
`).all(PROJECT);

// one row per (rw, distinct description) - dedupe the triple-extraction duplicates
const seen = new Set();
const ordered = [];
for (const r of items) {
  const key = `${r.rw}|${r.item_number}|${r.description}`;
  if (seen.has(key)) continue;
  seen.add(key);
  ordered.push(r);
}

const blocks = reconstructBlocks(ordered, { marker: "SECTION 28 46 00" });
const blockFingerprints = blocks.map((b) => ({ blockId: b.blockId, itemCount: b.rows.length, fingerprint: blockFingerprint(b) }));

// Drawing building fingerprints: the only governed per-building feature in the clean
// project is the T occurrence count (single feature). Multi-class governed counts are
// NOT in the clean project, so uniqueness cannot be established without inventing data.
const buildingFingerprints = {
  BOS: { fireman_telephone_jack: 25 },
  GRS: { fireman_telephone_jack: 25 },
  KGS: { fireman_telephone_jack: 23 },
  WLC: { fireman_telephone_jack: 6 },
};

const alignments = evaluateAlignments({ blocks, buildingFingerprints, requiredMatches: 2 });

const out = {
  boqBlockAlignmentReady: true,
  boqBlocksFound: blocks.length,
  blocks: blocks.map((b, i) => {
    const tRow = b.rows.find((r) => /fireman telephone jack/i.test(r.description ?? ""));
    return {
      blockId: b.blockId,
      sourceStartRow: b.rows[0] ? (b.rows[0].rw ?? null) : null,
      itemCount: b.rows.length,
      blockTQuantity: tRow ? Number(tRow.quantity) : 0,
      fingerprint: blockFingerprint(b),
      alignment: alignments[i].state,
      candidates: alignments[i].candidates.map((c) => ({ building: c.buildingTarget, score: c.score, matchedClasses: c.matchedClassCount })),
    };
  }),
  buildingFingerprints,
  globalAssignmentAuthority: "UNRESOLVED",
  boqTScopeContributions: { BOS: "UNRESOLVED", GRS: "UNRESOLVED", KGS: "UNRESOLVED", WLC: "UNRESOLVED" },
  drawingTByScope: { BOS: 25, GRS: 25, KGS: 23, WLC: 6 },
  deltaLocalization: "DELTA_NOT_LOCALIZED",
  note: "Only a single governed per-building T feature exists; multi-class governed drawing fingerprints are not in this project, so no block can reach a unique, multi-evidence alignment. No quantity is computed or claimed.",
};

// Persist the alignment outcome onto the current durable adjudication row.
const current = db.prepare(`SELECT id FROM drawing_quantity_semantic_adjudications WHERE project_id=? AND state='current' ORDER BY created_at DESC LIMIT 1`).get(PROJECT);
if (current) {
  db.prepare(`UPDATE drawing_quantity_semantic_adjudications SET reconciliation_detail_json=? WHERE id=?`).run(JSON.stringify(out), current.id);
}
console.log(JSON.stringify(out, null, 2));
