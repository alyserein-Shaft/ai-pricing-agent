// Governed drawing-number confirmation for the clean project's current drawings.
//
// Reads validated title-block vision evidence (crop + transcription digest) and
// confirms each number through the canonical governed route. No filename is ever
// sent: the value comes from the crop transcription, and the route refuses
// evidence-free writes. Omair's authorisation covers this metadata repair.

import { readFileSync } from "node:fs";

const BASE = "http://localhost:4183";
const PROJECT_ID = "project_29b4c399-2453-4a53-96c6-0434e15f13bb";
const union = JSON.parse(readFileSync("out/titleblock-vision/union.json", "utf8"));

const documents = (await (await fetch(`${BASE}/api/projects/${PROJECT_ID}/documents`)).json()).documents
  .filter((doc) => doc.document_type === "Drawing");

// The vision evidence was captured per PDF artefact; match it to the document by
// its CURRENT VERSION's stored object key, never by parsing the filename.
const keyFor = (logicalName) => logicalName.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.pdf$/, "");

const results = [];
for (const doc of documents) {
  const evidence = union.find((entry) => entry.key === keyFor(doc.logical_name));
  if (!evidence?.drawingNumber) {
    results.push({ drawing: doc.logical_name, status: "SKIPPED_NO_EVIDENCE", reason: evidence?.reason ?? "NO_CAPTURE" });
    continue;
  }
  const response = await fetch(`${BASE}/api/documents/${doc.id}/drawing-metadata/drawing-number`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      drawingNumber: evidence.drawingNumber,
      documentVersionId: doc.current_version_id,
      pageNumber: 1,
      cropRect: { band: "title-block bottom band", cropArtifact: evidence.cropArtifact },
      cropArtifact: evidence.cropArtifact,
      transcriptionDigest: evidence.transcriptionDigest,
      sourceAssetIds: [],
      extractionMethod: "TITLE_BLOCK_CROP_VISION_TRANSCRIPTION",
      confidence: 90,
      reason: `Omair-authorised drawing metadata repair: drawing number read from this drawing's own title block (crop + transcription digest), not from its filename.`,
    }),
  });
  const body = await response.json();
  results.push({ drawing: doc.logical_name, status: response.status, drawingNumber: body.drawingNumber ?? null, decidedBy: body.decidedBy ?? null, error: body.error?.code ?? null });
  console.log(`${response.status} ${doc.logical_name.padEnd(46)} -> ${body.drawingNumber ?? body.error?.code ?? "?"}${body.decidedBy ? ` (by ${body.decidedBy})` : ""}`);
}

const governed = results.filter((entry) => entry.status === 200 || entry.status === 201);
console.log(`\nDRAWING_NUMBERS_GOVERNED = ${governed.length} / ${documents.length}`);
const unresolved = results.filter((entry) => entry.status !== 200 && entry.status !== 201);
console.log(`GENUINELY_UNRESOLVED = ${unresolved.length}: ${unresolved.map((entry) => `${entry.drawing} (${entry.error || entry.reason})`).join(", ") || "none"}`);
