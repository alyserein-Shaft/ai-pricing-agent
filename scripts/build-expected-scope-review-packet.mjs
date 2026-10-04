#!/usr/bin/env node
/**
 * Build the READ-ONLY expected-scope review packet for the Golden project.
 *
 * Creates NOTHING in the database. It reads governed project evidence and emits
 * a markdown packet a human can act on.
 *
 * WHAT IT DELIBERATELY EXCLUDES: no quantity value of any kind. Physical
 * quantity history does not define expected-scope authority, and printing 25 /
 * 25 / 23 / 12 / 85 here would invite exactly the confusion this packet exists
 * to prevent. The decision is WHICH SHEET, never HOW MANY.
 *
 * Usage: node scripts/build-expected-scope-review-packet.mjs <db> <projectId> <out.md>
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { classifyLegendClass } from "../app/domain/fire-alarm-legend-class-semantics.mjs";

const [dbPath, projectId, outPath] = process.argv.slice(2);
if (!dbPath || !projectId || !outPath) throw new Error("Usage: <db> <projectId> <out.md>");

const db = new DatabaseSync(dbPath, { readOnly: true });
const one = (s, ...a) => db.prepare(s).get(...a);
const all = (s, ...a) => db.prepare(s).all(...a);

const CLASS = "T";
const meaning = classifyLegendClass(CLASS);
const project = one("SELECT id,name,owner_user_id,organization_id FROM projects WHERE id=?", projectId);
if (!project) throw new Error(`project ${projectId} not found`);

const LOCATIONS = ["BOS", "GRS", "KGS", "WLC"];
const lines = [];
const push = (s = "") => lines.push(s);

push("# Expected-Quantity Scope Review Packet");
push();
push("**READ-ONLY.** No row was created, no scope was approved, and no quantity is asserted.");
push();
push(`- Project: **${project.name}** (\`${project.id}\`)`);
push(`- Governed device class: **\`${CLASS}\`** -- \`${meaning.state}\`, "${meaning.description}"`);
push(`  (authority: \`classifyLegendClass\`, semantics \`${meaning.semanticsVersion}\`)`);
push(`- Class grain: project + device class + canonical location. The class is \`${CLASS}\` only.`);
push(`- Provenance requirement: every candidate below is a **CURRENT** document version.`);
push();
push("## The one question per location");
push();
push("> Which exact current drawing/sheet defines the governed quantity-location identity");
push("> for Fireman Telephone class `T` at this location?");
push();
push("This is **not** a quantity decision. Nothing in this packet asks how many devices exist.");
push();

const membership = all("SELECT user_id,role,status,revoked_at FROM project_members WHERE project_id=?", projectId);

for (const loc of LOCATIONS) {
  push(`---`);
  push();
  push(`## ${loc}`);
  push();
  const docs = all(
    `SELECT id, logical_name, document_type, classification_source, notes, current_version_id, created_by, created_at
       FROM documents
      WHERE project_id=? AND logical_name LIKE '%-'||?||'-%'
        AND archived_at IS NULL AND deleted_at IS NULL
      ORDER BY logical_name`,
    projectId, loc,
  );

  push(`**Candidates: ${docs.length}.** All are current, non-archived, non-deleted.`);
  push();

  for (const d of docs) {
    const ver = one(
      "SELECT id,version_number,original_filename,extension,byte_size,effective_from FROM document_versions WHERE id=?",
      d.current_version_id,
    );
    const intake = one(
      "SELECT id,version_number,status,parser_version,created_at FROM drawing_intake_versions WHERE document_id=? ORDER BY created_at DESC LIMIT 1",
      d.id,
    );
    const props = all(
      "SELECT raw_label, json_extract(evidence,'$.sourceSheet') sheet, json_extract(evidence,'$.sourceDrawingNumber') dno FROM drawing_extraction_proposals WHERE document_id=? AND evidence LIKE '%sourceSheet%' LIMIT 1",
      d.id,
    )[0];
    const counts = {
      archApprovedRows: one("SELECT count(*) c FROM drawing_architecture_approved_rows WHERE document_id=?", d.id).c,
      extractionProposals: one("SELECT count(*) c FROM drawing_extraction_proposals WHERE document_id=?", d.id).c,
      reviewEvents: one(
        "SELECT count(*) c FROM drawing_extraction_review_events e JOIN drawing_extraction_proposals p ON p.id=e.proposal_id WHERE p.document_id=?",
        d.id,
      ).c,
      recognitionVersions: one("SELECT count(*) c FROM drawing_symbol_recognition_versions WHERE document_id=?", d.id).c,
      // NOTE: drawing_symbol_definitions binds its drawing via
      // `source_document_id`, NOT `document_id` -- the prior slice recorded this.
      symbolDefinitions: one("SELECT count(*) c FROM drawing_symbol_definitions WHERE source_document_id=?", d.id).c,
    };
    // floor_or_area is a 0020 CLAIM concept and lives on drawing_quantity_claims,
      // which is empty for this project. The only governed area/room statements
      // that exist today are approved architecture facts, so that is what is shown.
      const floorAreas = all(
        `SELECT DISTINCT object AS area FROM drawing_architecture_approved_rows
          WHERE document_id=? AND object IS NOT NULL
            AND fact_type IN ('PANEL_SERVES_AREA','PANEL_EXISTS')`,
        d.id,
      ).map((r) => r.area);

    push(`### \`${d.logical_name}\``);
    push();
    push(`| Field | Value |`);
    push(`| --- | --- |`);
    push(`| Location label | ${loc} |`);
    push(`| Device class | \`${CLASS}\` (\`${meaning.state}\`) |`);
    push(`| document_id | \`${d.id}\` |`);
    push(`| current_version_id | \`${d.current_version_id}\` |`);
    push(`| version | v${ver?.version_number ?? "?"} -- \`${ver?.original_filename ?? "?"}\` |`);
    push(`| effective_from | ${ver?.effective_from ?? "?"} |`);
    push(`| document_type | ${d.document_type} |`);
    push(`| classification_source | ${d.classification_source} |`);
    push(`| notes | ${d.notes || "(none recorded)"} |`);
    push(`| floor/area identities | ${floorAreas.length ? floorAreas.join(", ") : "(none recorded for this drawing)"} |`);
    push(`| sheet title in extraction evidence | ${props?.sheet ? `"${props.sheet}"` : "(no extraction evidence yet)"} |`);
    push(`| drawing number in evidence | ${props?.dno ? `"${props.dno}"` : "(none)"} |`);
    push(`| provenance: uploaded/created_by | ${d.created_by} at ${d.created_at} |`);
    push();
    push(`**Available governed project evidence**`);
    push();
    push(`- Approved architecture rows: **${counts.archApprovedRows}**`);
    push(`- Extraction proposals: **${counts.extractionProposals}** (review events: ${counts.reviewEvents})`);
    push(`- Symbol recognition versions: **${counts.recognitionVersions}**`);
    push(`- Symbol definitions: **${counts.symbolDefinitions}**`);
    push(`- Drawing intake: ${intake ? `\`${intake.id}\` (v${intake.version_number}, status \`${intake.status}\`)` : "**none**"}`);
    push();
  }

  push(`**Cross-sheet / project-set evidence for ${loc}:** `);
  const xref = all(
    "SELECT subject,object,source_drawing_number,authority_class FROM drawing_architecture_approved_rows WHERE subject LIKE ? OR source_drawing_number LIKE ?",
    `%-${loc}-%`, `%-${loc}-%`,
  );
  push();
  if (xref.length === 0) {
    push("- **None in the live database.** No governed cross-sheet fact currently places this location in the project's drawing set. This is a genuine absence, not a negative finding.");
  } else {
    for (const x of xref.slice(0, 5)) push(`- \`${x.subject}\` -> \`${x.object}\` (\`${x.authority_class}\`, from \`${x.source_drawing_number}\`)`);
  }
  push();
  push(`**Reviewer must decide:** approve exactly ONE of the candidate sheets above as the`);
  push(`canonical quantity-location identity for class \`${CLASS}\` at ${loc}, or reject the location.`);
  push(`Do NOT record a quantity.`);
  push();
}

push(`---`);
push();
push("## Access note (blocks acting on this packet today)");
push();
push(`- Project \`owner_user_id\`: \`${project.owner_user_id}\``);
push(`- Configured real operator (\`APP_HUMAN_ID\`): \`omair-primary\``);
push(`- \`project_members\` rows for this project: **${membership.length}**`);
push();
push("Consequence: the governed scope route refuses BOTH identities --");
push("the synthetic owner with `HUMAN_ACTOR_ID_INVALID`, and the real operator with");
push("`PROJECT_FORBIDDEN` because it is neither owner nor an Active member. Resolving");
push("project access is a prerequisite to recording any decision, and is not an");
push("engineering decision this packet may make.");
push();
push("## Approval semantics (for whoever records the decision)");
push();
push("- `Needs Review` = a proposal. Confers NO authority.");
push("- `Approved` = the ONLY state that satisfies expected scope.");
push("- `Rejected` = a refusal; also excluded.");
push("- Scope rows are append-only: approving supersedes the proposal and inserts a new version.");
push("- Expected location != quantity. Approving WLC never states how many devices exist.");
push();

writeFileSync(outPath, `${lines.join("\n")}\n`);
console.log(`wrote ${outPath} (${lines.length} lines)`);
db.close();
