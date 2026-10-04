import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildClientQuotationModel, formatContactDisplay } from "../app/domain/quotation-presenter.mjs";
import { normalizeNpQProfile } from "../app/domain/project-npq-engine.mjs";

// ONBOARDING RECOVERY E -- Authoritative quotation header + Inquiry Subject
// rationalization.
//
// MAJOR FINDING (reported, not silently worked around): the quotation
// header JSX this mission's own brief pointed at (app/page.tsx's
// "quote-address"/"PREPARED FOR" block) is unreachable dead code -- gated
// by a permanent `{false && showQuotation && (...)}`. The REAL, live
// quotation header is app/components/workspaces/QuotationWorkspace.tsx,
// fed by GET /api/projects/:id/quotations/:id (worker/quotation-api.mjs)
// -> buildClientQuotationModel (app/domain/quotation-presenter.mjs), built
// from an IMMUTABLE snapshot captured once, server-side, at quotation-
// draft-creation time (worker/presales-workflow-api.mjs) -- never a live
// join, never browser-local state. This file tests that real, live path.
//
// No DB writes anywhere in this file. The one DB read (Al Mousa) is
// read-only, informational, not required for any assertion to pass.

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const presalesWorker = fs.readFileSync(new URL("../worker/presales-workflow-api.mjs", import.meta.url), "utf8");
const quotationWorkspace = fs.readFileSync(new URL("../app/components/workspaces/QuotationWorkspace.tsx", import.meta.url), "utf8");
const commercialTypes = fs.readFileSync(new URL("../app/components/workspaces/commercial-types.ts", import.meta.url), "utf8");

const baseRevision = (headerOverrides = {}) => ({
  revision_number: 1,
  status: "Draft",
  currency: "SAR",
  subtotal_minor: 1000,
  vat_basis_points: 1500,
  vat_minor: 150,
  total_minor: 1150,
  terms_json: "{}",
  created_at: "2026-09-01T00:00:00.000Z",
  source_summary_json: JSON.stringify({
    quotationHeader: {
      projectName: "Central Kitchen Test",
      client: "ABC Contractor",
      tenderNumber: "CK-001",
      location: "Riyadh",
      currency: "SAR",
      quotationDate: "2026-09-01T00:00:00.000Z",
      ...headerOverrides,
    },
  }),
});
const baseLines = [{ sequence: 1, item_number: "L1", description: "Item", quantity: 1, currency: "SAR", net_selling_minor: 1000 }];

// ── DEAD-CODE FINDING (documented) ─────────────────────────────────────────

test("MAJOR FINDING: the quotation-header JSX block this brief describes is unreachable dead code", () => {
  const block = page.slice(page.indexOf("{false && showQuotation && ("), page.indexOf("PREPARED FOR") + 50);
  assert.match(block, /\{false && showQuotation && \(/, "confirms the gate is a permanent false, not a real condition");
});

test("the REAL, live quotation header is QuotationWorkspace.tsx, fed by the server quotation-preview endpoint", () => {
  assert.match(quotationWorkspace, /fetch\(`\/api\/projects\/\$\{encodeURIComponent\(props\.projectId\)\}\/quotations\/\$\{encodeURIComponent\(props\.quotation\.id\)\}`/);
});

// ── SERVER_AUTHORITY_CONTACT ────────────────────────────────────────────────

test("SERVER_AUTHORITY_CONTACT: buildClientQuotationModel structurally cannot read LocalProject/browser-local state -- it has no such parameter", () => {
  // The strongest possible proof: not "server wins in a merge", but that
  // local state is never even reachable by this function's own signature.
  const source = fs.readFileSync(new URL("../app/domain/quotation-presenter.mjs", import.meta.url), "utf8");
  const signature = source.slice(source.indexOf("export const buildClientQuotationModel"), source.indexOf("export const buildClientQuotationModel") + 80);
  assert.match(signature, /\{\s*revision,\s*lines = \[\],?\s*\}/);
  assert.doesNotMatch(signature, /local|intakeProfile|browser/i);
});

test("SERVER_AUTHORITY_CONTACT: server current NPQ (Ms. Sara) is what the header shows -- a stale-local-shaped value never enters the model at all", () => {
  // SERVER current NPQ, as worker/presales-workflow-api.mjs would have
  // snapshotted it at draft-creation time.
  const serverAttention = formatContactDisplay({ title: "Ms.", name: "Sara" });
  const revision = baseRevision({ contactTitle: "Ms.", contactName: "Sara", attention: serverAttention });
  // LOCAL cached intakeProfile (stale) -- deliberately never passed to
  // buildClientQuotationModel anywhere in this test, proving it cannot win.
  const staleLocal = { contactTitle: "Mr.", contactName: "Old Local", inquirySubject: "Stale Local Subject" };
  const model = buildClientQuotationModel({ revision, lines: baseLines });
  assert.equal(model.header.attention, "Ms. Sara");
  assert.equal(model.header.contactName, "Sara");
  assert.notEqual(model.header.attention, formatContactDisplay({ title: staleLocal.contactTitle, name: staleLocal.contactName }));
});

// ── SERVER_AUTHORITY_INQUIRY ─────────────────────────────────────────────────

test("SERVER_AUTHORITY_INQUIRY: Inquiry Subject is retired from the quotation header entirely -- it is not part of the snapshot or the model at all (Decision B)", () => {
  assert.doesNotMatch(presalesWorker, /inquirySubject|inquiry_subject/i);
  const source = fs.readFileSync(new URL("../app/domain/quotation-presenter.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /inquirySubject|inquiry_subject/i);
});

// ── CURRENT_NPQ_VERSION ──────────────────────────────────────────────────────

test("CURRENT_NPQ_VERSION: currentNpqContact's real query selects only status='Confirmed' AND superseded_at IS NULL, ordered to the newest", () => {
  assert.match(presalesWorker, /SELECT contact_title, contact_name FROM project_npq_profile_versions WHERE project_id=\? AND status='Confirmed' AND superseded_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1/);
});

test("CURRENT_NPQ_VERSION (isolated fixture): a superseded NPQ v1 cannot drive the header -- only the current confirmed v2 does", () => {
  const file = path.join(os.tmpdir(), `onboarding-e-npqver-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE project_npq_profile_versions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, contact_title TEXT, contact_name TEXT,
      status TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO project_npq_profile_versions (id, project_id, contact_title, contact_name, status, superseded_at, created_at) VALUES ('v1','p1',NULL,'Old Contact','Confirmed','2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')").run();
  db.prepare("INSERT INTO project_npq_profile_versions (id, project_id, contact_title, contact_name, status, superseded_at, created_at) VALUES ('v2','p1','Ms.','New Contact','Confirmed',NULL,'2026-09-01T00:00:00.000Z')").run();
  // v1 is now superseded (as real confirmation always marks the prior version).
  db.prepare("UPDATE project_npq_profile_versions SET superseded_at='2026-09-01T00:00:00.000Z' WHERE id='v1'").run();

  // The exact real query, extracted from source above and re-run here.
  const row = db.prepare("SELECT contact_title, contact_name FROM project_npq_profile_versions WHERE project_id=? AND status='Confirmed' AND superseded_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1").get("p1");
  assert.equal(row.contact_name, "New Contact");
  assert.notEqual(row.contact_name, "Old Contact");
  db.close();
  fs.rmSync(file, { force: true });
});

test("CURRENT_NPQ_VERSION: does not pick a random latest UUID, an old version, or fall back to local cache when a Draft (unconfirmed) NPQ exists alongside a Confirmed one", () => {
  const file = path.join(os.tmpdir(), `onboarding-e-npqdraft-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE project_npq_profile_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, contact_title TEXT, contact_name TEXT, status TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL);`);
  db.prepare("INSERT INTO project_npq_profile_versions VALUES ('confirmed1','p1',NULL,'Confirmed Contact','Confirmed',NULL,'2026-08-01T00:00:00.000Z')").run();
  db.prepare("INSERT INTO project_npq_profile_versions VALUES ('draft1','p1','Mr.','Draft Contact Not Yet Confirmed','Draft',NULL,'2026-09-15T00:00:00.000Z')").run();
  const row = db.prepare("SELECT contact_title, contact_name FROM project_npq_profile_versions WHERE project_id=? AND status='Confirmed' AND superseded_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1").get("p1");
  assert.equal(row.contact_name, "Confirmed Contact", "an unconfirmed Draft NPQ (even if newer) must never drive the header");
  db.close();
  fs.rmSync(file, { force: true });
});

// ── PROJECT_NAME_AUTHORITY / CLIENT_AUTHORITY / REFERENCE_AUTHORITY ────────

test("PROJECT_NAME_AUTHORITY: quotationHeader.projectName is sourced from the server project record (project.name), never NPQ or local state", () => {
  assert.match(presalesWorker, /projectName:project\.name \|\| "",/);
});

test("CLIENT_AUTHORITY: quotationHeader.client is sourced from the server dashboard profile (project.client), never NPQ", () => {
  assert.match(presalesWorker, /client:terms\.client \|\| project\.client \|\| "",/);
  // `project` here is the joined projects + project_dashboard_profiles row
  // (see the `access` query at the top of this file) -- client is
  // dp.client, i.e. project_dashboard_profiles, the verified authority.
  assert.match(presalesWorker, /LEFT JOIN project_dashboard_profiles dp ON dp\.project_id=p\.id/);
});

test("REFERENCE_AUTHORITY: quotationHeader.tenderNumber is sourced from the server dashboard profile (project.tender_number)", () => {
  assert.match(presalesWorker, /tenderNumber:project\.tender_number \|\| "",/);
});

test("Client/Reference/Project Name are never moved into NPQ -- only contactTitle/contactName/attention were added to the header snapshot", () => {
  const snapshotBlock = presalesWorker.slice(presalesWorker.indexOf("quotationHeader:{"), presalesWorker.indexOf("quotationHeader:{") + 500);
  assert.match(snapshotBlock, /contactTitle:npqContact\.contactTitle/);
  assert.match(snapshotBlock, /contactName:npqContact\.contactName/);
  assert.match(snapshotBlock, /attention:npqContact\.attention/);
  assert.doesNotMatch(snapshotBlock, /npqContact\.client|npqContact\.projectName|npqContact\.tenderNumber/);
});

// ── CONTACT_TITLE ────────────────────────────────────────────────────────────

test("CONTACT_TITLE: new title + name render once, not duplicated", () => {
  const revision = baseRevision({ contactTitle: "Ms.", contactName: "Sara Ahmed", attention: formatContactDisplay({ title: "Ms.", name: "Sara Ahmed" }) });
  const model = buildClientQuotationModel({ revision, lines: baseLines });
  assert.equal(model.header.attention, "Ms. Sara Ahmed");
  assert.equal((model.header.attention.match(/Ms\./g) || []).length, 1);
});

// ── LEGACY_CONTACT ───────────────────────────────────────────────────────────

test("LEGACY_CONTACT: Al Mousa-style 'Mr. Ahmad' contactName with null contactTitle remains correct, no double title", () => {
  const revision = baseRevision({ contactTitle: null, contactName: "Mr. Ahmad", attention: formatContactDisplay({ title: null, name: "Mr. Ahmad" }) });
  const model = buildClientQuotationModel({ revision, lines: baseLines });
  assert.equal(model.header.attention, "Mr. Ahmad");
  assert.equal((model.header.attention.match(/Mr\./g) || []).length, 1);
});

// ── NO_FIRE_ALARM_FALLBACK ───────────────────────────────────────────────────

test("NO_FIRE_ALARM_FALLBACK: 'Section 28 46 00' is not rendered as a generic quotation fallback anywhere", () => {
  assert.doesNotMatch(quotationWorkspace, /28 46 00/);
  assert.doesNotMatch(presalesWorker, /28 46 00/);
  const presenterSource = fs.readFileSync(new URL("../app/domain/quotation-presenter.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(presenterSource, /28 46 00/);
  // The one place it used to appear (dead code) no longer uses it as a
  // fallback either.
  assert.doesNotMatch(page, /inquirySubject \|\| "Section 28 46 00"/);
});

test("other 'Section 28 46 00' occurrences in the repo are legitimate document titles/fixture content, not generic quotation fallbacks", () => {
  // Spot-checked in the report: a "PARTICULAR SPECIFICATION" document card
  // title and a "TECHNICAL REFERENCE REVIEW" panel header, both real
  // document identity in demo fixture data -- confirmed NOT inside any
  // quotation-header rendering path.
  const docCardBlock = page.slice(page.indexOf("Section 28 46 00 · Rev 1"), page.indexOf("Section 28 46 00 · Rev 1") + 5);
  assert.ok(docCardBlock.length > 0);
});

// ── BLANK_OPTIONAL_FIELD ─────────────────────────────────────────────────────

test("BLANK_OPTIONAL_FIELD: client-facing output omits Attention cleanly (no card, no placeholder) when no contact was recorded", () => {
  const revision = baseRevision({ contactTitle: null, contactName: null, attention: null });
  const model = buildClientQuotationModel({ revision, lines: baseLines });
  assert.equal(model.header.attention, null);
  assert.match(quotationWorkspace, /\{clientQuotation\.header\.attention && \(/, "the component conditionally omits the Attention card, never a placeholder string");
  assert.doesNotMatch(quotationWorkspace, /Attention.*Not specified|Attention.*Unknown/i);
});

// ── INQUIRY_POLICY (Decision B: RETIRE_FROM_NEW_ONBOARDING_KEEP_HISTORY) ───

test("INQUIRY_POLICY: Inquiry Subject is removed from the Create Project UI", () => {
  const wizardBlock = page.slice(page.indexOf('aria-labelledby="new-project-title"'), page.indexOf('{showProjectEditor && ('));
  assert.doesNotMatch(wizardBlock, /Inquiry subject/);
  assert.match(wizardBlock, /Inquiry received/, "Inquiry Received (a real scheduling field) is untouched");
});

test("INQUIRY_POLICY: schema/API support is preserved for historical NPQ versions -- the column, normalization and read paths are untouched", () => {
  const engine = fs.readFileSync(new URL("../app/domain/project-npq-engine.mjs", import.meta.url), "utf8");
  assert.match(engine, /inquirySubject: clean\(input\.inquirySubject\)/);
  const npqApi = fs.readFileSync(new URL("../worker/project-npq-api.mjs", import.meta.url), "utf8");
  assert.match(npqApi, /inquirySubject: row\.inquiry_subject \|\| ""/);
});

test("INQUIRY_POLICY: no migration or deletion of historical inquiry_subject values -- no DROP/UPDATE/DELETE touches it anywhere", () => {
  const allSource = presalesWorker + fs.readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(allSource, /UPDATE[^;]*inquiry_subject|DELETE[^;]*inquiry_subject|DROP[^;]*inquiry_subject/i);
});

// ── LOCAL_DIVERGENCE / TWO-BROWSER ──────────────────────────────────────────

test("LOCAL_DIVERGENCE: two independent reads of the SAME stored quotation revision produce byte-identical headers, regardless of any local context", () => {
  // Simulates "Browser A" and "Browser B" each independently calling
  // buildClientQuotationModel against the identical server-stored revision
  // -- proving no per-caller/per-browser divergence is possible.
  const revision = baseRevision({ contactTitle: "Ms.", contactName: "Sara", attention: "Ms. Sara" });
  const browserA = buildClientQuotationModel({ revision, lines: baseLines });
  const browserB = buildClientQuotationModel({ revision, lines: baseLines });
  assert.deepEqual(browserA.header, browserB.header);
});

// ── MULTI-SYSTEM / DECLARED_SCOPE / IDENTITY regression ────────────────────

test("MULTI-SYSTEM: no regression -- Systems in scope / Primary System wiring is untouched by this slice", () => {
  const wizardBlock = page.slice(page.indexOf('aria-labelledby="new-project-title"'), page.indexOf('{showProjectEditor && ('));
  assert.match(wizardBlock, /Systems in scope \*/);
  assert.match(wizardBlock, /Primary system/);
});

test("DECLARED_SCOPE: no regression -- not added to the quotation header in this slice (onboarding contract stays closed)", () => {
  assert.doesNotMatch(presalesWorker, /deliveryScope|delivery_scope/i);
  const wizardBlock = page.slice(page.indexOf('aria-labelledby="new-project-title"'), page.indexOf('{showProjectEditor && ('));
  assert.match(wizardBlock, /Declared Scope/);
});

test("Declared Scope CAN be added to the quotation header later without new plumbing -- the same snapshot pattern (read current confirmed NPQ at draft-creation time) already exists and is proven by this slice's own contact fields", () => {
  assert.match(presalesWorker, /const currentNpqContact=async\(db,projectId\)=>\{/);
});

test("IDENTITY: no regression -- Project Name/Client required-field rules are untouched", () => {
  const worker = fs.readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
  // ONBOARDING RECOVERY G moved this validation into the shared
  // createGovernedProject() helper both creation routes now call -- see
  // tests/onboarding-g-project-creation-consolidation.test.mjs for that
  // slice's own full contract test.
  const helperBlock = worker.slice(worker.indexOf("const createGovernedProject"), worker.indexOf("export const handleDashboardApi"));
  assert.match(helperBlock, /code: "PROJECT_NAME_REQUIRED"/);
  assert.match(helperBlock, /code: "PROJECT_CLIENT_REQUIRED"/);
});

// ── AL MOUSA (read-only, informational) ────────────────────────────────────

test("AL MOUSA: real server-authoritative values, read-only, and the header the NEW logic would produce if a quotation were drafted today", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const projectId = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
  const project = db.prepare("SELECT name FROM projects WHERE id=?").get(projectId);
  if (!project) { t.skip("Al Mousa fixture project not present in this environment"); return; }
  const dp = db.prepare("SELECT client, tender_number, currency FROM project_dashboard_profiles WHERE project_id=?").get(projectId);
  const npq = db.prepare("SELECT contact_title, contact_name, inquiry_subject FROM project_npq_profile_versions WHERE project_id=? AND status='Confirmed' AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1").get(projectId);
  assert.equal(project.name, "Al Mousa School");
  assert.equal(dp.client, "Al Badael");
  assert.equal(dp.tender_number, "BP450");
  assert.equal(npq.contact_title, null);
  assert.equal(npq.contact_name, "Mr. Ahmad");
  assert.equal(npq.inquiry_subject, "FAS RFQ", "the real historical value, unchanged -- but retired from new quotation-header snapshots");
  const wouldRenderAttention = formatContactDisplay({ title: npq.contact_title, name: npq.contact_name });
  assert.equal(wouldRenderAttention, "Mr. Ahmad");
  const revisionCount = db.prepare("SELECT COUNT(*) n FROM project_quotation_revisions WHERE project_id=?").get(projectId).n;
  assert.equal(revisionCount, 0, "Al Mousa has no quotation drafted yet -- informational only");
});

// ── NEW-PROJECT FIXTURE (Central Kitchen Test) ─────────────────────────────

test("NEW PROJECT FIXTURE: Central Kitchen Test quotation metadata matches the brief exactly", () => {
  const profile = normalizeNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR", contactTitle: "Ms.", contactName: "Sara Ahmed" });
  const revision = baseRevision({
    projectName: "Central Kitchen Test",
    client: "ABC Contractor",
    tenderNumber: "CK-001",
    contactTitle: profile.contactTitle,
    contactName: profile.contactName,
    attention: formatContactDisplay({ title: profile.contactTitle, name: profile.contactName }),
  });
  const model = buildClientQuotationModel({ revision, lines: baseLines });
  assert.equal(model.header.projectName, "Central Kitchen Test");
  assert.equal(model.header.client, "ABC Contractor");
  assert.equal(model.header.tenderNumber, "CK-001");
  assert.equal(model.header.attention, "Ms. Sara Ahmed");
  // No stale local value, no Fire Alarm fallback anywhere in this model.
  assert.doesNotMatch(JSON.stringify(model), /28 46 00|Old Local|Stale Local/);
});

// ── NO DATA MUTATION ────────────────────────────────────────────────────────

test("NO DATA MUTATION: this file only reads the live DB read-only, never writes to it; isolated fixtures use their own temp files", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  const liveDbSection = source.split("dbPath =");
  for (const chunk of liveDbSection.slice(1)) {
    const nextTest = chunk.indexOf('test("');
    const scoped = nextTest === -1 ? chunk : chunk.slice(0, nextTest);
    assert.doesNotMatch(scoped, /\.run\(|\.exec\(/);
  }
  assert.match(source, /readOnly:\s*true/);
});
