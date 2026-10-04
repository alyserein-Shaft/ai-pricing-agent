// REGRESSION COVERAGE -- profile applicability source authority (migration 0008).
//
// Defect: Drawing-sourced requirement entries minted in the
// `drawing-requirement:` namespace were written into
// profile_requirement_applicability.requirement_id, which is NOT NULL and
// foreign-keyed to technical_requirements(id). The insert aborted the entire
// requirement-profile save batch, so profile regeneration was impossible for any
// item that had BOTH an APPROVED AI understanding review AND governed drawing
// evidence.
//
// These tests pin the repaired contract on the CANONICAL migration chain
// (tests/fixtures/active-chain-fixture.mjs) with foreign keys ENFORCED, exactly
// as D1 enforces them. Note: the `sqlite3` CLI defaults to foreign_keys=OFF,
// which silently accepts violations -- that is why every negative case here runs
// through node:sqlite with foreign_keys explicitly ON.
import assert from "node:assert/strict";
import test from "node:test";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import {
  isDrawingRequirementId,
  isBoqDeviceIdentityRequirementId,
  requirementAuthorityClass,
  DRAWING_REQUIREMENT_ID_PREFIX,
  BOQ_REQUIREMENT_ID_PREFIX,
} from "../app/domain/drawing-requirement-evidence-engine.mjs";

const OWNER = "local-development-user";
const seed = () => {
  const raw = activeChainDatabase({ foreignKeys: true });
  raw.exec("PRAGMA foreign_keys = ON");
  raw.prepare("INSERT INTO organizations (id,name) VALUES ('org1','Org')").run();
  raw
    .prepare("INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('p1','P',?,'org1')")
    .run(OWNER);

  // specification side
  raw
    .prepare("INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('d1','p1','Spec',?)")
    .run(OWNER);
  raw
    .prepare(
      "INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from) VALUES ('dv1','d1',1,'s.pdf','s.pdf','pdf','application/pdf',4,'sha1','o',?,'2020-01-01')",
    )
    .run(OWNER);
  raw
    .prepare(
      "INSERT INTO specification_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by) VALUES ('se1','d1','dv1',1,'Completed','p','r','m','pr','o',?)",
    )
    .run(OWNER);
  raw
    .prepare(
      "INSERT INTO technical_requirements (id,project_id,extraction_version_id,source_document_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,requirement_type,requirement_category,confidence,confidence_state,extraction_method,parser_version,model_version,source_location,original_values,current_values,review_status,approved_for_downstream) VALUES ('req-1','p1','se1','d1',1,'clause','clause','Fire Detection','Specification','Mandatory','Documentation',90,'High','Deterministic','p','m','{}','{}','{}','Approved',1)",
    )
    .run();

  // BOQ side (referentially complete, so the profile FK chain is satisfiable)
  raw
    .prepare("INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('boqdoc','p1','BOQ',?)")
    .run(OWNER);
  raw
    .prepare(
      "INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from) VALUES ('bodv','boqdoc',1,'b.xlsx','b.xlsx','xlsx','application/vnd.ms-excel',4,'sha2','o',?,'2020-01-01')",
    )
    .run(OWNER);
  raw
    .prepare(
      "INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by) VALUES ('bex','boqdoc','bodv',1,'Completed','p','r','o',?)",
    )
    .run(OWNER);
  raw
    .prepare(
      "INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,section_path,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,current_values,source_location,review_status,approved_for_downstream,extraction_confidence,confidence_state,original_raw_values) VALUES ('bi1','p1','BOQ Item','bex','boqdoc',1,'[]','1','Heat detector','1','1','Each','Each','{}','{}','Approved',1,90,'High','{}')",
    )
    .run();

  raw
    .prepare(
      "INSERT INTO requirement_profile_versions (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,created_by) VALUES ('rp1','p1','bi1',1,'Completed','e','r','m','fp1','{}','x','Needs Technical Review','{}',?)",
    )
    .run(OWNER);
  return { raw, db: d1(raw) };
};

const ins = (raw, { id, profile, source, reqId, drawRef }) =>
  raw
    .prepare(
      "INSERT INTO profile_requirement_applicability (id,profile_version_id,requirement_source,requirement_id,device_identity_ref,status,method,confidence,evidence,priority,review_status) VALUES (?,?,?,?,?,'Confirmed Applicable','m',100,'[]','High','Needs Review')",
    )
    .run(id, profile, source, reqId, drawRef);

const DRAW = `${DRAWING_REQUIREMENT_ID_PREFIX}v1:def_1:bi1`;

// ---------------------------------------------------------------- namespace

test("the drawing id namespace is the single authority for source classification", () => {
  assert.equal(isDrawingRequirementId(DRAW), true);
  assert.equal(isDrawingRequirementId("req-1"), false);
  assert.equal(isDrawingRequirementId(null), false);
  assert.equal(isDrawingRequirementId(undefined), false);
  // a requirement id that merely CONTAINS the word must not be classified as drawing
  assert.equal(isDrawingRequirementId("spec-drawing-requirement-ish"), false);
});

// ------------------------------------------------- 1 + 2 specification + FK

test("1. specification applicability persists against a real requirement, FK enforced", () => {
  const { raw } = seed();
  try {
    ins(raw, { id: "a1", profile: "rp1", source: "Specification", reqId: "req-1", drawRef: null });
    const row = raw.prepare("SELECT requirement_source,requirement_id,device_identity_ref FROM profile_requirement_applicability WHERE id='a1'").get();
    assert.equal(row.requirement_source, "Specification");
    assert.equal(row.requirement_id, "req-1");
    assert.equal(row.device_identity_ref, null);
  } finally {
    raw.close();
  }
});

test("2. an invalid fake specification requirement_id is still rejected by the FK", () => {
  const { raw } = seed();
  try {
    assert.throws(
      () => ins(raw, { id: "a2", profile: "rp1", source: "Specification", reqId: "req-DOES-NOT-EXIST", drawRef: null }),
      /FOREIGN KEY constraint failed/,
    );
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM profile_requirement_applicability").get().n, 0);
  } finally {
    raw.close();
  }
});

// ------------------------------------------------------------ 3 + 4 drawing

test("3. drawing-derived applicability persists through the drawing reference", () => {
  const { raw } = seed();
  try {
    ins(raw, { id: "a3", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    const row = raw.prepare("SELECT requirement_source,requirement_id,device_identity_ref FROM profile_requirement_applicability WHERE id='a3'").get();
    assert.equal(row.requirement_source, "DrawingDeviceIdentity");
    assert.equal(row.requirement_id, null, "a drawing entry must never occupy the technical requirement reference");
    assert.equal(row.device_identity_ref, DRAW);
  } finally {
    raw.close();
  }
});

test("4. drawing evidence does NOT create a technical_requirements row", () => {
  const { raw } = seed();
  try {
    const before = raw.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n;
    ins(raw, { id: "a4", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    const after = raw.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n;
    assert.equal(after, before, "persisting drawing applicability must not fabricate a specification requirement");
  } finally {
    raw.close();
  }
});

test("3b. the BOQ device-identity namespace is classified separately, not as Drawing", () => {
  const boqRef = `${BOQ_REQUIREMENT_ID_PREFIX}device-identity:bi1`;
  assert.equal(requirementAuthorityClass(boqRef), "BOQDeviceIdentity");
  assert.equal(requirementAuthorityClass(DRAW), "DrawingDeviceIdentity");
  assert.equal(requirementAuthorityClass("req-1"), null, "a real specification id classifies as null so the caller keeps it FK-governed");
  assert.equal(isDrawingRequirementId(boqRef), false);
  assert.equal(isBoqDeviceIdentityRequirementId(boqRef), true);
});

test("3c. a BOQ device-identity row persists without a technical_requirements row", () => {
  const { raw } = seed();
  try {
    const before = raw.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n;
    ins(raw, { id: "a3c", profile: "rp1", source: "BOQDeviceIdentity", reqId: null, drawRef: `${BOQ_REQUIREMENT_ID_PREFIX}device-identity:bi1` });
    const row = raw.prepare("SELECT requirement_source,requirement_id,device_identity_ref FROM profile_requirement_applicability WHERE id='a3c'").get();
    assert.equal(row.requirement_source, "BOQDeviceIdentity");
    assert.equal(row.requirement_id, null);
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n, before);
  } finally { raw.close(); }
});

// ------------------------------------------------- 5 mutual exclusivity (CK)

test("5. a row cannot bind both source identities, nor neither", () => {
  const { raw } = seed();
  try {
    assert.throws(
      () => ins(raw, { id: "b1", profile: "rp1", source: "Specification", reqId: "req-1", drawRef: DRAW }),
      /CHECK constraint failed/,
    );
    assert.throws(
      () => ins(raw, { id: "b2", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: null }),
      /CHECK constraint failed/,
    );
    // and a Drawing row may not smuggle itself in through requirement_id
    assert.throws(
      () => ins(raw, { id: "b3", profile: "rp1", source: "DrawingDeviceIdentity", reqId: "req-1", drawRef: null }),
      /CHECK constraint failed/,
    );
    // an unknown authority class is rejected too, on a row that really exists
    ins(raw, { id: "b4", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    assert.throws(
      () => raw.prepare("UPDATE profile_requirement_applicability SET requirement_source='Bogus' WHERE id='b4'").run(),
      /CHECK constraint failed/,
    );
    // and a valid row cannot be flipped into claiming the other authority
    assert.throws(
      () => raw.prepare("UPDATE profile_requirement_applicability SET requirement_id='req-1' WHERE id='b4'").run(),
      /CHECK constraint failed/,
    );
  } finally {
    raw.close();
  }
});

// ------------------------------------------------ 6 + 7 duplicate admission

test("6. duplicate specification applicability is still prevented", () => {
  const { raw } = seed();
  try {
    ins(raw, { id: "c1", profile: "rp1", source: "Specification", reqId: "req-1", drawRef: null });
    assert.throws(
      () => ins(raw, { id: "c2", profile: "rp1", source: "Specification", reqId: "req-1", drawRef: null }),
      /UNIQUE constraint failed/,
    );
  } finally {
    raw.close();
  }
});

test("7. duplicate DRAWING applicability is prevented (partial unique index)", () => {
  const { raw } = seed();
  try {
    ins(raw, { id: "d1", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    assert.throws(
      () => ins(raw, { id: "d2", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW }),
      /UNIQUE constraint failed/,
      "SQLite permits unlimited NULLs in a unique index, so this hole is only closed by the partial index on device_identity_ref",
    );
  } finally {
    raw.close();
  }
});

test("7b. the same drawing reference IS allowed under a different profile version", () => {
  const { raw } = seed();
  try {
    ins(raw, { id: "e1", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    raw
      .prepare(
        "INSERT INTO requirement_profile_versions (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,created_by) VALUES ('rp2','p1','bi1',2,'Completed','e','r','m','fp2','{}','x','Needs Technical Review','{}',?)",
      )
      .run(OWNER);
    ins(raw, { id: "e2", profile: "rp2", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM profile_requirement_applicability WHERE device_identity_ref=?").get(DRAW).n, 2);
  } finally {
    raw.close();
  }
});

// ------------------------------------------- 10 supersession / currentness

test("10. superseding a recognition version yields a NEW drawing reference, not a collision", () => {
  const { raw } = seed();
  try {
    ins(raw, { id: "f1", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    // the reference embeds recognitionVersionId, so a new version is a new identity
    const next = `${DRAWING_REQUIREMENT_ID_PREFIX}v2:def_1:bi1`;
    assert.notEqual(next, DRAW);
    ins(raw, { id: "f2", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: next });
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM profile_requirement_applicability").get().n, 2);
  } finally {
    raw.close();
  }
});

// ------------------------------------------- 11 retry idempotency + reader

test("11. re-running the same applicability insert is rejected, so retry is idempotent", () => {
  const { raw } = seed();
  try {
    ins(raw, { id: "g1", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    assert.throws(
      () => ins(raw, { id: "g1", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW }),
      /UNIQUE constraint failed/,
    );
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM profile_requirement_applicability").get().n, 1);
  } finally {
    raw.close();
  }
});

test("the applicability read exposes provenance without joining technical_requirements", async () => {
  const { raw, db } = seed();
  try {
    ins(raw, { id: "h1", profile: "rp1", source: "Specification", reqId: "req-1", drawRef: null });
    ins(raw, { id: "h2", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    const rows = await db
      .prepare("SELECT * FROM profile_requirement_applicability WHERE profile_version_id=? ORDER BY id")
      .bind("rp1")
      .all();
    assert.equal(rows.results.length, 2);
    const byId = Object.fromEntries(rows.results.map((r) => [r.id, r]));
    assert.equal(byId.h1.requirement_source, "Specification");
    assert.equal(byId.h2.requirement_source, "DrawingDeviceIdentity");
    assert.equal(byId.h2.requirement_id, null);
  } finally {
    raw.close();
  }
});

// ============================================================================
// requirement_intelligence_facts carries the SAME authority split (0010).
// The two tables must never drift: both classify with requirementAuthorityClass.
// ============================================================================

const insFact = (raw, { id, profile, source, reqId, devRef, key = "fk1" }) =>
  raw
    .prepare(
      "INSERT INTO requirement_intelligence_facts (id, profile_version_id, requirement_source, requirement_id, device_identity_ref, fact_key, fact_type, original_value, current_value, modality, confidence, evidence_snippet, extraction_basis, engine_version, review_status) VALUES (?,?,?,?,?,?,'Derived','\"v\"','\"v\"','Asserted',90,'evidence','basis','e','Needs Review')",
    )
    .run(id, profile, source, reqId, devRef, key);

test("intelligence facts: a specification fact stays FK-governed against a real requirement", () => {
  const { raw } = seed();
  try {
    insFact(raw, { id: "f1", profile: "rp1", source: "Specification", reqId: "req-1", devRef: null });
    const row = raw.prepare("SELECT requirement_source,requirement_id,device_identity_ref FROM requirement_intelligence_facts WHERE id='f1'").get();
    assert.equal(row.requirement_source, "Specification");
    assert.equal(row.requirement_id, "req-1");
    assert.equal(row.device_identity_ref, null);
  } finally { raw.close(); }
});

test("intelligence facts: a fake specification requirement_id is still FK-rejected", () => {
  const { raw } = seed();
  try {
    assert.throws(
      () => insFact(raw, { id: "f2", profile: "rp1", source: "Specification", reqId: "req-NOPE", devRef: null }),
      /FOREIGN KEY constraint failed/,
    );
  } finally { raw.close(); }
});

test("intelligence facts: a device-identity fact persists with its own reference and fabricates no requirement", () => {
  const { raw } = seed();
  try {
    const before = raw.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n;
    insFact(raw, { id: "f3", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, devRef: DRAW, key: "fk3" });
    const row = raw.prepare("SELECT requirement_source,requirement_id,device_identity_ref FROM requirement_intelligence_facts WHERE id='f3'").get();
    assert.equal(row.requirement_source, "DrawingDeviceIdentity");
    assert.equal(row.requirement_id, null, "a device-identity fact must never occupy the technical requirement reference");
    assert.equal(row.device_identity_ref, DRAW);
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n, before);
  } finally { raw.close(); }
});

test("intelligence facts: cannot bind both identities nor neither", () => {
  const { raw } = seed();
  try {
    assert.throws(
      () => insFact(raw, { id: "f4", profile: "rp1", source: "Specification", reqId: "req-1", devRef: DRAW, key: "fk4" }),
      /CHECK constraint failed/,
    );
    assert.throws(
      () => insFact(raw, { id: "f5", profile: "rp1", source: "BOQDeviceIdentity", reqId: null, devRef: null, key: "fk5" }),
      /CHECK constraint failed/,
    );
  } finally { raw.close(); }
});

test("intelligence facts: duplicate fact_key per profile stays prevented (index excludes requirement_id)", () => {
  const { raw } = seed();
  try {
    insFact(raw, { id: "f6", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, devRef: DRAW, key: "dup" });
    assert.throws(
      () => insFact(raw, { id: "f7", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, devRef: DRAW, key: "dup" }),
      /UNIQUE constraint failed/,
    );
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM requirement_intelligence_facts").get().n, 1);
  } finally { raw.close(); }
});

test("no fake processing/requirement rows are created by a device-identity write", () => {
  const { raw } = seed();
  try {
    const before = {
      req: raw.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n,
      runs: raw.prepare("SELECT COUNT(*) n FROM document_processing_runs").get().n,
    };
    insFact(raw, { id: "f8", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, devRef: DRAW, key: "fk8" });
    ins(raw, { id: "f9", profile: "rp1", source: "DrawingDeviceIdentity", reqId: null, drawRef: DRAW });
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM technical_requirements").get().n, before.req);
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM document_processing_runs").get().n, before.runs);
  } finally { raw.close(); }
});
