import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NOT_STATED_IN_SOURCE,
  NOT_STATED_IN_SOURCE_LABEL,
  DOCUMENT_ISSUE_FIELD_STATES,
  DOCUMENT_ISSUE_PURPOSES,
  REQUIRED_DOCUMENT_ISSUE_FIELDS,
  validateDocumentIssueConfirmation,
  documentIssueFieldState,
  documentIssueAllowsScope,
  documentIssueScopeBlocker,
  buildDocumentIssueAuthorityKey,
  resolveDocumentIssueAuthorityFromExtraction,
  describeDocumentIssueConfirmation,
  DOCUMENT_ISSUE_PURPOSE_LABELS,
  NON_ACTOR_ROLE_VALUES,
} from "../app/domain/document-issue-metadata.mjs";

const ui = await readFile("app/page.tsx", "utf8");
const TODAY = "2026-10-04";

const blank = (over = {}) => ({
  revision: "",
  issueDate: "",
  status: "Tender",
  transmittal: "",
  ...over,
});

// Satisfies the actor + document-authority requirements, so a field-level test
// fails for a FIELD reason rather than an attribution reason.
const bound = (over = {}) => blank({ ...ACTOR, authorityKey: KEY, ...over });

const ACTOR = { confirmedByUserId: "omair", confirmedByDisplayName: "Omair" };
const KEY = buildDocumentIssueAuthorityKey({
  projectId: "proj-1",
  documentId: "doc-1",
  documentVersionId: "ver-1",
});
const absentAll = (over = {}) => blank({
  revisionNotStated: true,
  issueDateNotStated: true,
  transmittalNotStated: true,
  ...ACTOR,
  authorityKey: KEY,
  ...over,
});

// ---------------------------------------------------------------------------
// 1. Blank required metadata with no absence confirmation is STILL BLOCKED.
// ---------------------------------------------------------------------------
test("1. blank required metadata with no absence confirmation remains blocked", () => {
  const r = validateDocumentIssueConfirmation(bound(), { today: TODAY });
  assert.equal(r.ok, false);
  assert.equal(r.code, "MISSING_REQUIRED_INPUT");
  // every required field is unresolved, and none may silently pass
  assert.equal(r.fieldStates.length, REQUIRED_DOCUMENT_ISSUE_FIELDS.length);
  for (const f of r.fieldStates) {
    assert.equal(f.state, DOCUMENT_ISSUE_FIELD_STATES.MISSING_REQUIRED_INPUT);
  }
});

test("1b. blank alone is never a confirmation: each field blocks independently", () => {
  const realValue = (key) => (key === "issueDate" ? TODAY : "SOURCE-VALUE");
  for (const field of REQUIRED_DOCUMENT_ISSUE_FIELDS) {
    // baseline: all three resolved by a real source value
    const resolved = blank({
      revision: realValue("revision"),
      issueDate: realValue("issueDate"),
      transmittal: realValue("transmittal"),
      ...ACTOR,
      authorityKey: KEY,
    });
    assert.equal(validateDocumentIssueConfirmation(resolved, { today: TODAY }).ok, true, `${field.key} baseline`);

    // now blank exactly this one field, with no absence confirmation
    const blanked = { ...resolved, [field.valueKey]: "" };
    const r = validateDocumentIssueConfirmation(blanked, { today: TODAY });
    assert.equal(r.ok, false, `${field.key} must block when blank and unconfirmed`);
    assert.equal(r.code, "MISSING_REQUIRED_INPUT");
    assert.match(r.reason, new RegExp(field.label.replace(/[/]/g, "\\/")));
  }
});

// ---------------------------------------------------------------------------
// 2. Explicit NOT_STATED_IN_SOURCE is allowed.
// ---------------------------------------------------------------------------
test("2. explicit NOT_STATED_IN_SOURCE on all three fields is allowed", () => {
  const r = validateDocumentIssueConfirmation(absentAll(), { today: TODAY });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.code, "READY_TO_CONFIRM");
  assert.deepEqual(r.notStatedFields, ["revision", "issueDate", "transmittal"]);
  assert.deepEqual(r.sourceValueFields, []);
});

test("2b. each field supports absence independently, alongside source values", () => {
  for (const field of REQUIRED_DOCUMENT_ISSUE_FIELDS) {
    // this field: explicit absence. the other two: real source values.
    const control = blank({
      revision: field.key === "revision" ? "" : "A",
      issueDate: field.key === "issueDate" ? "" : "2026-04-01",
      transmittal: field.key === "transmittal" ? "" : "RFQ-001",
      revisionNotStated: field.key === "revision",
      issueDateNotStated: field.key === "issueDate",
      transmittalNotStated: field.key === "transmittal",
      ...ACTOR,
      authorityKey: KEY,
    });
    const r = validateDocumentIssueConfirmation(control, { today: TODAY });
    assert.equal(r.ok, true, `${field.key} absence must be sufficient on its own: ${r.reason}`);
    assert.deepEqual(r.notStatedFields, [field.key]);
    assert.equal(r.sourceValueFields.length, 2);
  }
});

test("2c. absence resolves to the governed token and label, never to a value", () => {
  const state = documentIssueFieldState(absentAll(), REQUIRED_DOCUMENT_ISSUE_FIELDS[0]);
  assert.equal(state.state, NOT_STATED_IN_SOURCE);
  assert.equal(state.value, null, "absence must never carry a value");
  const described = describeDocumentIssueConfirmation(
    validateDocumentIssueConfirmation(absentAll(), { today: TODAY }).fieldStates,
    "Tender",
  );
  assert.match(described, /Revision \/ issue: Not stated in source/);
  assert.match(described, /Document issue date: Not stated in source/);
  assert.match(described, /Transmittal \/ source reference: Not stated in source/);
});

// ---------------------------------------------------------------------------
// 3. Typed source-backed values are allowed.
// ---------------------------------------------------------------------------
test("3. typed source values are allowed and reported as source-backed", () => {
  const r = validateDocumentIssueConfirmation(
    blank({ revision: "A", issueDate: "2026-04-01", transmittal: "PACE-RFQ-001", ...ACTOR, authorityKey: KEY }),
    { today: TODAY },
  );
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.sourceValueFields, ["revision", "issueDate", "transmittal"]);
  assert.deepEqual(r.notStatedFields, []);
});

test("3b. mixed source value and explicit absence is allowed", () => {
  const r = validateDocumentIssueConfirmation(
    blank({ issueDate: "2026-04-01", transmittalNotStated: true, revision: "A", ...ACTOR, authorityKey: KEY }),
    { today: TODAY },
  );
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.sourceValueFields, ["revision", "issueDate"]);
  assert.deepEqual(r.notStatedFields, ["transmittal"]);
});

// ---------------------------------------------------------------------------
// 4. Source absence cannot silently become a fabricated value.
// ---------------------------------------------------------------------------
test("4. absence conflicting with a value is refused, never silently resolved", () => {
  for (const field of REQUIRED_DOCUMENT_ISSUE_FIELDS) {
    const control = absentAll({ [field.valueKey]: "Rev 0" });
    const r = validateDocumentIssueConfirmation(control, { today: TODAY });
    assert.equal(r.ok, false, `${field.key} must refuse absence+value`);
    assert.equal(r.code, "SOURCE_ABSENCE_CONFLICTS_WITH_VALUE");
    const state = r.fieldStates.find((f) => f.key === field.key);
    assert.equal(state.state, "SOURCE_ABSENCE_CONFLICTS_WITH_VALUE");
  }
});

test("4b. no invented defaults: blank stays empty when absence is confirmed", () => {
  const control = absentAll();
  assert.equal(control.revision, "");
  assert.equal(control.issueDate, "", "no default date may be synthesised");
  assert.equal(control.transmittal, "");
  // and the validator must not require, mutate or invent any of them
  const before = JSON.stringify(control);
  validateDocumentIssueConfirmation(control, { today: TODAY });
  assert.equal(JSON.stringify(control), before, "validation must be pure");
});

test("4c. no fabricated date can ride in on an absent issue date", () => {
  const r = validateDocumentIssueConfirmation(absentAll(), { today: TODAY });
  assert.equal(r.ok, true);
  const dateState = r.fieldStates.find((f) => f.key === "issueDate");
  assert.equal(dateState.state, NOT_STATED_IN_SOURCE);
  assert.equal(dateState.value, null);
});

// ---------------------------------------------------------------------------
// 5. Actor / audit attribution is populated.
// ---------------------------------------------------------------------------
test("5. confirmation records actor, timestamp and an audit event", () => {
  assert.match(ui, /confirmedAt[,:]/, "confirmation timestamp must be recorded");
  assert.match(ui, /confirmedBy:\s*workingRole/, "human actor must be recorded on the confirmation");
  assert.match(ui, /recordAudit\(\s*"Document issue metadata confirmed"/, "an audit event must be written");
  // the audit detail must carry the governed absence label, not an empty string
  assert.match(ui, /describeDocumentIssueConfirmation/);
});

test("5b. absent issue date is not date-validated, but a real one still is", () => {
  // absence -> no date check at all
  assert.equal(validateDocumentIssueConfirmation(absentAll(), { today: TODAY }).ok, true);
  // present future date -> still refused
  const future = blank({ revision: "A", issueDate: "2099-01-01", transmittal: "X", ...ACTOR, authorityKey: KEY });
  const r = validateDocumentIssueConfirmation(future, { today: TODAY });
  assert.equal(r.ok, false);
  assert.equal(r.code, "ISSUE_DATE_IN_FUTURE");
  // present malformed date -> refused
  const bad = blank({ revision: "A", issueDate: "not-a-date", transmittal: "X", ...ACTOR, authorityKey: KEY });
  assert.equal(validateDocumentIssueConfirmation(bad, { today: TODAY }).code, "ISSUE_DATE_INVALID");
});

// ---------------------------------------------------------------------------
// Gate preservation: the scope gate is NOT weakened.
// ---------------------------------------------------------------------------
test("gate: confirming source absence does not bypass the active-issue scope gate", () => {
  assert.equal(documentIssueAllowsScope(absentAll({ confirmed: true, status: "Tender" }), { currentAuthorityKey: KEY }), true);
  assert.equal(documentIssueAllowsScope(absentAll({ confirmed: false, status: "Tender" }), { currentAuthorityKey: KEY }), false, "still requires confirmation");
  assert.equal(documentIssueAllowsScope(absentAll({ confirmed: true, status: "RFQ" }), { currentAuthorityKey: KEY }), true, "RFQ is an active scope purpose");
  for (const purpose of ["For Information", "Superseded"]) {
    assert.equal(documentIssueAllowsScope(absentAll({ confirmed: true, status: purpose }), { currentAuthorityKey: KEY }), false, `${purpose} stays reference-only`);
  }
  assert.equal(documentIssueAllowsScope(undefined, { currentAuthorityKey: KEY }), false);
  // an unresolvable current authority must never open the gate
  assert.equal(documentIssueAllowsScope(absentAll({ confirmed: true, status: "Tender" }), { currentAuthorityKey: null }), false);
});

test("1. RFQ is a controlled, valid issue purpose", () => {
  assert.ok(DOCUMENT_ISSUE_PURPOSES.includes("RFQ"), "RFQ must be a real controlled value, not free text");
  assert.equal(DOCUMENT_ISSUE_PURPOSE_LABELS.RFQ, "Request for Quotation (RFQ)");
  assert.equal(validateDocumentIssueConfirmation(absentAll({ status: "RFQ" }), { today: TODAY }).ok, true);
});

test("2. RFQ unblocks the same active-source gate as Tender/Addendum", () => {
  for (const purpose of ["Tender", "Addendum", "RFQ"]) {
    assert.equal(documentIssueAllowsScope(absentAll({ confirmed: true, status: purpose }), { currentAuthorityKey: KEY }), true, purpose);
  }
});

test("3. RFQ is NOT silently mapped to Tender", () => {
  const control = absentAll({ confirmed: true, status: "RFQ" });
  assert.equal(control.status, "RFQ", "stored value stays RFQ");
  assert.notEqual(DOCUMENT_ISSUE_PURPOSE_LABELS.RFQ, DOCUMENT_ISSUE_PURPOSE_LABELS.Tender);
  // the taxonomy stays closed: the display label is not an accepted value
  assert.equal(validateDocumentIssueConfirmation(absentAll({ status: "Request for Quotation (RFQ)" }), { today: TODAY }).code, "MISSING_ISSUE_PURPOSE");
});

test("4. named human actor is required and persisted; role-only is refused", () => {
  assert.equal(validateDocumentIssueConfirmation(absentAll(), { today: TODAY }).ok, true);
  assert.equal(absentAll().confirmedByUserId, "omair");
  for (const role of NON_ACTOR_ROLE_VALUES) {
    const r = validateDocumentIssueConfirmation(
      absentAll({ confirmedByUserId: role, confirmedByDisplayName: role }),
      { today: TODAY },
    );
    assert.equal(r.ok, false, `${role} must not be accepted as a human actor`);
    assert.equal(r.code, "ROLE_IS_NOT_A_HUMAN_ACTOR");
  }
  assert.equal(
    validateDocumentIssueConfirmation(blank({ authorityKey: KEY, revisionNotStated: true, issueDateNotStated: true, transmittalNotStated: true }), { today: TODAY }).code,
    "HUMAN_ACTOR_REQUIRED",
  );
  assert.equal(validateDocumentIssueConfirmation({ ...absentAll(), confirmedByDisplayName: "" }, { today: TODAY }).code, "HUMAN_ACTOR_REQUIRED");
  assert.equal(documentIssueAllowsScope(absentAll({ confirmed: true, status: "RFQ", confirmedByUserId: "Estimator" }), { currentAuthorityKey: KEY }), false);
});

test("5. authority key is bound to exact document/version, never a filename", () => {
  assert.equal(buildDocumentIssueAuthorityKey({ projectId: "p", documentId: "d", documentVersionId: "v" }), "p|d|v");
  assert.equal(buildDocumentIssueAuthorityKey({ projectId: "p", documentId: "d" }), null);
  assert.equal(
    buildDocumentIssueAuthorityKey({ projectId: "p", documentId: "d", documentVersionId: "v", fileName: "BOQ (1).xlsx", sha256: "x" }),
    "p|d|v",
    "filename and hash must not affect the key",
  );
});

test("6. confirmation does not inherit across document, version or project", () => {
  const confirmed = absentAll({ confirmed: true, status: "RFQ" });
  assert.equal(documentIssueAllowsScope(confirmed, { currentAuthorityKey: "proj-1|doc-2|ver-1" }), false, "other document");
  assert.equal(documentIssueAllowsScope(confirmed, { currentAuthorityKey: "proj-1|doc-1|ver-2" }), false, "other version");
  assert.equal(documentIssueAllowsScope(confirmed, { currentAuthorityKey: "proj-2|doc-1|ver-1" }), false, "other project");
  assert.equal(documentIssueAllowsScope(confirmed, { currentAuthorityKey: KEY }), true);
  assert.equal(documentIssueScopeBlocker(confirmed, { currentAuthorityKey: "proj-2|doc-1|ver-1" }), "DOCUMENT_AUTHORITY_CHANGED");
  assert.equal(documentIssueAllowsScope(absentAll({ confirmed: true, status: "RFQ", authorityKey: undefined }), { currentAuthorityKey: KEY }), false);
});

test("7. ambiguous extraction provenance fails closed and names both candidates", () => {
  const r = resolveDocumentIssueAuthorityFromExtraction({
    projectId: "project_29b4c399",
    extractions: [
      { extractionVersionId: "bx-1", documentId: "doc_ab3f6980", documentVersionId: "ver_e84be315" },
      { extractionVersionId: "bx-2", documentId: "doc_4b8aa325", documentVersionId: "ver_d5b0252d" },
    ],
  });
  assert.equal(r.ok, false, "two sources must never auto-resolve");
  assert.equal(r.code, "AMBIGUOUS_EXTRACTION_PROVENANCE");
  assert.deepEqual(r.candidates.map((c) => c.documentId).sort(), ["doc_4b8aa325", "doc_ab3f6980"]);
  assert.equal(r.authorityKey, undefined, "no authority key while ambiguous");
});

test("8. exactly one extraction source binds authority to that source only", () => {
  const r = resolveDocumentIssueAuthorityFromExtraction({
    projectId: "project_29b4c399",
    extractions: [{ extractionVersionId: "bx-1", documentId: "doc_ab3f6980", documentVersionId: "ver_e84be315" }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.authorityKey, "project_29b4c399|doc_ab3f6980|ver_e84be315");
  assert.equal(resolveDocumentIssueAuthorityFromExtraction({ projectId: "p", extractions: [] }).code, "NO_EXTRACTION_PROVENANCE");
});

test("9. NOT_STATED_IN_SOURCE behaviour is unchanged by the governance additions", () => {
  const r = validateDocumentIssueConfirmation(absentAll({ status: "RFQ" }), { today: TODAY });
  assert.equal(r.ok, true);
  assert.deepEqual(r.notStatedFields, ["revision", "issueDate", "transmittal"]);
  assert.equal(documentIssueFieldState(absentAll(), REQUIRED_DOCUMENT_ISSUE_FIELDS[1]).value, null, "no default date");
  assert.equal(validateDocumentIssueConfirmation(absentAll({ status: "RFQ", revision: "Rev 0" }), { today: TODAY }).code, "SOURCE_ABSENCE_CONFLICTS_WITH_VALUE");
});

// ---------------------------------------------------------------------------
// Wiring: page.tsx must consume this module as the single authority.
// ---------------------------------------------------------------------------
test("wiring: page.tsx delegates the BOQ scope gate to the governed module", () => {
  assert.match(ui, /document-issue-metadata\.mjs/);
  assert.match(ui, /validateDocumentIssueConfirmation/);

  // The BOQ scope gate (the documentControlEditor panel) must no longer use the
  // old blank-only truthiness rule. Scoped to that panel, because the separate
  // REVISION INBOX gate is a different flow and is deliberately left unchanged.
  const panelStart = ui.indexOf("const documentControlEditor");
  assert.ok(panelStart > 0, "documentControlEditor panel must exist");
  const panel = ui.slice(panelStart, ui.indexOf("const documentIssueAllowsScope", panelStart));
  assert.ok(panel.length > 0, "panel body must be locatable");
  assert.doesNotMatch(
    panel,
    /control\.revision\.trim\(\) &&/,
    "the blank-only canConfirm gate must be replaced inside the issue-control panel",
  );
  assert.match(panel, /const canConfirm = issueVerdict\.ok;/);
  // the panel renders the governed label constant, not a hardcoded string
  assert.match(panel, /NOT_STATED_IN_SOURCE_LABEL/);
  assert.match(panel, /absenceControl\("revision"\)/);
  assert.match(panel, /absenceControl\("issueDate"\)/);
  assert.match(panel, /absenceControl\("transmittal"\)/);
});

test("wiring: the separate REVISION INBOX gate is unchanged (out of scope, by design)", () => {
  // Recorded explicitly so a future reader knows this is a known remaining
  // inconsistency, not an oversight: a revised same-name file still requires
  // real values. Expanding it is a separate governed decision.
  const inbox = ui.slice(ui.indexOf("revision-candidate-register"));
  assert.match(inbox, /control\.revision\.trim\(\) &&/);
});

test("wiring: UI exposes a per-field absence control for exactly the three fields", () => {
  for (const key of ["revisionNotStated", "issueDateNotStated", "transmittalNotStated"]) {
    assert.match(ui, new RegExp(key), `${key} must be wired into the panel`);
  }
});

test("wiring: visible state distinguishes absence from not-reviewed", () => {
  // the three states must be separately representable in the rendered panel
  assert.match(ui, /MISSING_REQUIRED_INPUT|Not reviewed/);
  assert.match(ui, /NOT_STATED_IN_SOURCE|Not stated in source/);
});

// ---------------------------------------------------------------------------
// 6. BOQ candidates / source anchors are untouched by a metadata confirmation.
// ---------------------------------------------------------------------------
test("6. metadata confirmation cannot mutate BOQ candidates or source anchors", () => {
  // The only page.tsx behaviour gated by the issue metadata is the BOQ apply /
  // index entry gate. Confirming metadata must not write BOQ rows or anchors.
  const applyFn = ui.slice(ui.indexOf("const applyKnownBoqExtraction"), ui.indexOf("const applyKnownBoqExtraction") + 4000);
  assert.match(applyFn, /documentIssueAllowsScope\(fileName\)/, "gate still consulted before apply");
  // no BOQ/anchor mutation may appear inside the metadata confirmation path
  const confirmFn = ui.slice(ui.indexOf("const confirmDocumentControl"), ui.indexOf("const confirmDocumentControl") + 2000);
  for (const forbidden of [/setItems\(/, /sourceAnchor/, /anchoredRequirements/, /setInitialItems\(/, /insertInto/]) {
    assert.doesNotMatch(confirmFn, forbidden, `confirmation path must not touch ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Regression: the pre-confirm button must not be permanently disabled.
// ---------------------------------------------------------------------------
test("10. pre-confirm enablement ignores attribution, but the decision never does", () => {
  const inProgress = blank({
    revisionNotStated: true,
    issueDateNotStated: true,
    transmittalNotStated: true,
    status: "RFQ",
  });
  // No actor / authority yet: the button may be enabled on field grounds alone.
  assert.equal(
    validateDocumentIssueConfirmation(inProgress, { today: TODAY, requireAttribution: false }).ok,
    true,
  );
  // Recording the decision still requires attribution.
  assert.equal(
    validateDocumentIssueConfirmation(inProgress, { today: TODAY }).code,
    "HUMAN_ACTOR_REQUIRED",
  );
  assert.equal(
    validateDocumentIssueConfirmation({ ...inProgress, ...ACTOR }, { today: TODAY }).code,
    "DOCUMENT_AUTHORITY_REQUIRED",
  );
  // and with both supplied it passes
  assert.equal(validateDocumentIssueConfirmation({ ...inProgress, ...ACTOR, authorityKey: KEY }, { today: TODAY }).ok, true);
});

test("11. unresolved authority disables confirmation and names the candidates", () => {
  assert.equal(resolveDocumentIssueAuthorityFromExtraction({ projectId: "p", extractions: [] }).ok, false);
  assert.equal(documentIssueScopeBlocker(absentAll({ confirmed: true, status: "RFQ" }), { currentAuthorityKey: null }), "DOCUMENT_AUTHORITY_UNRESOLVED");
  // page.tsx must bind the confirm button to authority resolution too
  assert.match(ui, /disabled=\{!canConfirm \|\| control\.confirmed \|\| !authorityVerdict\.ok\}/);
});

test("12. synthetic development identities are refused via the CANONICAL policy", async () => {
  // The synthetic-id list must come from app/domain/human-authority.mjs, never be
  // redefined here: worker/human-actor.mjs enforces the same rule.
  for (const synthetic of ["local-development-user", "system", "administrator", "admin", "unknown", "anonymous"]) {
    const r = validateDocumentIssueConfirmation(
      absentAll({ confirmedByUserId: synthetic, confirmedByDisplayName: synthetic }),
      { today: TODAY },
    );
    assert.equal(r.ok, false, `${synthetic} must not record a governed confirmation`);
    assert.equal(r.code, "SYNTHETIC_ACTOR_NOT_A_HUMAN");
    assert.equal(
      documentIssueAllowsScope(absentAll({ confirmed: true, status: "RFQ", confirmedByUserId: synthetic }), { currentAuthorityKey: KEY }),
      false,
    );
  }
  // and the module genuinely imports the canonical policy rather than copying it
  const domainSrc = await readFile("app/domain/document-issue-metadata.mjs", "utf8");
  assert.match(domainSrc, /from "\.\/human-authority\.mjs"/);
  assert.doesNotMatch(domainSrc, /new Set\(\[\s*"local-development-user"/);
});
