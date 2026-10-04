import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCompatibilityAutoConfirmation,
  autoConfirmCompatibility,
  COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION,
  COMPATIBILITY_AUTO_CONFIRM_ACTOR,
  EVIDENCE_CLASSIFICATION,
} from "../compatibility-auto-confirm.mjs";

const createMockDb = () => {
  const calls = [];
  const mockFirst = { value: null };
  return {
    calls,
    prepare(sql) {
      calls.push({ sql });
      return {
        bind(...args) {
          calls.push({ args });
          return {
            first: () => Promise.resolve(mockFirst.value),
            all: () => Promise.resolve({ results: [] }),
            run: () => Promise.resolve({}),
          };
        },
      };
    },
    _setMock(value) { mockFirst.value = value; },
    _setMocks(values) {
      let idx = 0;
      const origFirst = mockFirst;
      mockFirst._values = values;
      mockFirst._idx = 0;
      // Override
      const db = this;
      const origPrepare = db.prepare.bind(db);
      db.prepare = function(sql) {
        calls.push({ sql });
        return {
          bind(...args) {
            calls.push({ args });
            const val = values[idx++];
            return {
              first: () => Promise.resolve(val),
              all: () => Promise.resolve({ results: Array.isArray(val) ? val : [] }),
              run: () => Promise.resolve({}),
            };
          },
        };
      };
    },
  };
};

describe("Compatibility Auto-Confirm Governance", () => {
  describe("evaluateCompatibilityAutoConfirmation", () => {
    it("should reject when source product not found", async () => {
      const db = createMockDb();
      db._setMocks([null]);

      const result = await evaluateCompatibilityAutoConfirmation(db, {
        sourceProductId: "product_nonexistent",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
      });

      assert.equal(result.eligible, false);
      assert.equal(result.gates[0].pass, false);
      assert.ok(result.gates[0].reason.includes("Source product not found"));
    });

    it("should reject when source product is superseded", async () => {
      const db = createMockDb();
      db._setMocks([{
        id: "product_source",
        part_number: "TEST-001",
        identity_status: "Active",
        superseded_by_product_id: "product_replacement",
        review_status: "Needs Review",
      }]);

      const result = await evaluateCompatibilityAutoConfirmation(db, {
        sourceProductId: "product_source",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
      });

      assert.equal(result.eligible, false);
      assert.ok(result.gates[0].reason.includes("superseded"));
    });

    it("should reject when target product not found", async () => {
      const db = createMockDb();
      db._setMocks([
        { id: "product_source", part_number: "TEST-001", identity_status: "Active", superseded_by_product_id: null },
        null, // Target not found
      ]);

      const result = await evaluateCompatibilityAutoConfirmation(db, {
        sourceProductId: "product_source",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
      });

      assert.equal(result.eligible, false);
      assert.ok(result.gates[1].reason.includes("Target product not found"));
    });

    it("should reject when evidence classification not eligible", async () => {
      const db = createMockDb();
      db._setMocks([
        { id: "product_source", part_number: "TEST-001", identity_status: "Active", superseded_by_product_id: null },
        { id: "product_target", part_number: "BASE-001", identity_status: "Active", superseded_by_product_id: null },
        null, // No existing relationship
      ]);

      const result = await evaluateCompatibilityAutoConfirmation(db, {
        sourceProductId: "product_source",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
        evidenceClassification: EVIDENCE_CLASSIFICATION.INFERRED_ONLY,
      });

      assert.equal(result.eligible, false);
      assert.ok(result.gates[3].reason.includes("not eligible"));
    });

    it("should reject when source document evidence missing", async () => {
      const db = createMockDb();
      db._setMocks([
        { id: "product_source", part_number: "TEST-001", identity_status: "Active", superseded_by_product_id: null },
        { id: "product_target", part_number: "BASE-001", identity_status: "Active", superseded_by_product_id: null },
        null,
      ]);

      const result = await evaluateCompatibilityAutoConfirmation(db, {
        sourceProductId: "product_source",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
        evidenceClassification: EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
      });

      assert.equal(result.eligible, false);
      assert.ok(result.gates[4].reason.includes("Source document number and revision are required"));
    });

    it("should pass all gates with valid parameters", async () => {
      const db = createMockDb();
      db._setMocks([
        { id: "product_source", part_number: "IDP-HEAT-IV", identity_status: "Active", superseded_by_product_id: null },
        { id: "product_target", part_number: "B501-IV", identity_status: "Active", superseded_by_product_id: null },
        null,
        null,
        { id: "src_350285", source_type: "Product Datasheet", authority: "Official Manufacturer", validity_state: "Current Document — Applicability Review Required", review_status: "Needs Review", file_name: "IDP-HEAT-350285.pdf" },
        { id: "ev_1" },
      ]);

      const result = await evaluateCompatibilityAutoConfirmation(db, {
        sourceProductId: "product_source",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
        evidenceClassification: EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
        sourceDocumentNumber: "350285",
        sourceDocumentRevision: "Rev H",
        sourceDocumentDate: "12/2017",
        sourceDocumentUrl: "https://example.com/datasheet.pdf",
        sourceDocumentPage: "1",
        sourceDocumentSection: "Product Description",
      });

      assert.equal(result.eligible, true);
      assert.equal(result.gates.every((g) => g.pass), true);
      assert.equal(result.policyVersion, COMPATIBILITY_AUTO_CONFIRM_POLICY_VERSION);
      assert.equal(result.actor, COMPATIBILITY_AUTO_CONFIRM_ACTOR);
    });
  });

  describe("autoConfirmCompatibility", () => {
    it("should create relationship when all gates pass", async () => {
      const db = createMockDb();
      db._setMocks([
        { id: "product_source", part_number: "IDP-HEAT-IV", identity_status: "Active", superseded_by_product_id: null },
        { id: "product_target", part_number: "B501-IV", identity_status: "Active", superseded_by_product_id: null },
        null,
        null,
        { id: "src_350285", source_type: "Product Datasheet", authority: "Official Manufacturer", validity_state: "Current Document — Applicability Review Required", review_status: "Needs Review", file_name: "IDP-HEAT-350285.pdf" },
        { id: "ev_1" },
      ]);

      const result = await autoConfirmCompatibility(db, {
        sourceProductId: "product_source",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
        evidenceClassification: EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
        sourceDocumentNumber: "350285",
        sourceDocumentRevision: "Rev H",
        sourceDocumentPage: "2",
        sourceDocumentSection: "Compatible Bases",
      });

      assert.equal(result.success, true);
      assert.ok(result.relationshipId);
    });

    it("should not create relationship when gates fail", async () => {
      const db = createMockDb();
      db._setMocks([null]);

      const result = await autoConfirmCompatibility(db, {
        sourceProductId: "product_nonexistent",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
      });

      assert.equal(result.success, false);
    });

    it("should write to canonical engineering_relationships, never deprecated product_compatibility", async () => {
      const statements = [];
      const db = {
        prepare(sql) {
          statements.push(sql);
          return {
            bind(...args) {
              return {
                first: () => {
                  // Gate 1 source product, Gate 2 target product, Gate 3 no
                  // duplicate/conflict, Gate 7 governed source + evidence binding
                  const call = statements.filter((s) => s.startsWith("SELECT")).length;
                  if (call <= 2) {
                    return Promise.resolve({
                      id: call === 1 ? "product_source" : "product_target",
                      part_number: call === 1 ? "SRC-1" : "TGT-1",
                      identity_status: "Active",
                      superseded_by_product_id: null,
                    });
                  }
                  if (call === 5) {
                    return Promise.resolve({
                      id: "src_350285",
                      source_type: "Product Datasheet",
                      authority: "Official Manufacturer",
                      validity_state: "Current Document — Applicability Review Required",
                      review_status: "Needs Review",
                      file_name: "IDP-HEAT-350285.pdf",
                    });
                  }
                  if (call === 6) {
                    return Promise.resolve({ id: "ev_1" });
                  }
                  return Promise.resolve(null);
                },
                all: () => Promise.resolve({ results: [] }),
                run: () => Promise.resolve({}),
              };
            },
          };
        },
      };

      const result = await autoConfirmCompatibility(db, {
        sourceProductId: "product_source",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
        evidenceClassification: EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
        sourceDocumentNumber: "350285",
        sourceDocumentRevision: "Rev H",
        sourceDocumentPage: "2",
        sourceDocumentSection: "Compatible Bases",
      });

      assert.equal(result.success, true);
      assert.ok(
        statements.some((sql) => sql.includes("INSERT INTO engineering_relationships")),
        "must insert into engineering_relationships",
      );
      assert.ok(
        !statements.some((sql) => /INSERT INTO product_compatibility/i.test(sql)),
        "must never insert into deprecated product_compatibility",
      );
      assert.ok(
        !statements.some((sql) => /FROM product_compatibility/i.test(sql)),
        "must never read the deprecated table for duplicate checks",
      );
    });
  });
    it("should refuse when a conflicting Approved relationship exists for the same pair", async () => {
      // UNRESOLVED-SEMANTICS: no duplicate of the SAME triple exists, but the
      // pair already carries a governed statement under a DIFFERENT
      // relationship type. Absence of a duplicate is not absence of a
      // conflict; auto-confirming over disputed evidence is refused.
      const statements = [];
      const db = {
        prepare(sql) {
          statements.push(sql);
          return {
            bind(...args) {
              return {
                first: () => {
                  const call = statements.filter((s) => s.startsWith("SELECT")).length;
                  if (call <= 2) {
                    return Promise.resolve({
                      id: call === 1 ? "product_source" : "product_target",
                      part_number: call === 1 ? "SRC-1" : "TGT-1",
                      identity_status: "Active",
                      superseded_by_product_id: null,
                    });
                  }
                  if (call === 3) return Promise.resolve(null);
                  return Promise.resolve({
                    id: "rel-conflict",
                    relationship_type: "INCOMPATIBLE_WITH",
                    status: "Approved",
                  });
                },
                all: () => Promise.resolve({ results: [] }),
                run: () => Promise.resolve({}),
              };
            },
          };
        },
      };

      const result = await autoConfirmCompatibility(db, {
        sourceProductId: "product_source",
        targetProductId: "product_target",
        relationshipType: "COMPATIBLE_WITH_BASE",
        evidenceClassification: EVIDENCE_CLASSIFICATION.EXPLICIT_EXACT,
        sourceDocumentNumber: "350285",
        sourceDocumentRevision: "Rev H",
      });

      assert.equal(result.success, false);
      assert.match(result.reason || "", /Conflicting relationship/);
      assert.ok(
        !statements.some((sql) => sql.includes("INSERT INTO engineering_relationships")),
        "must not write an approval over disputed evidence",
      );
    });
});
