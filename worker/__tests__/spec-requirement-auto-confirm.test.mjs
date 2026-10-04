import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSpecRequirementAutoConfirmation,
  autoConfirmSpecRequirement,
  SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION,
  SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR,
} from "../spec-requirement-auto-confirm.mjs";

// Mock DB with a FIFO queue of first() values and write tracking.
const createMockDb = (firstQueue = []) => {
  const state = { queue: [...firstQueue], writes: 0 };
  return {
    _state: state,
    prepare() {
      return {
        bind() {
          return {
            first: () => Promise.resolve(state.queue.length ? state.queue.shift() : null),
            all: () => Promise.resolve({ results: [] }),
            run: () => { state.writes += 1; return Promise.resolve({}); },
          };
        },
      };
    },
  };
};

const baseRequirement = (overrides = {}) => ({
  id: "req_1",
  review_status: "Needs Review",
  requirement_type: "Mandatory",
  original_text: "The fire detection and alarm system shall be addressable.",
  extraction_version_id: "extract_active",
  condition: null,
  exception: null,
  system: "Fire Alarm",
  category: "Other",
  ...overrides,
});

// Queue: [requirement, ambiguity(null), conflict(null)]
const cleanQueue = (req) => [req, null, null];

describe("Spec Requirement Auto-Confirm Governance", () => {
  describe("evaluateSpecRequirementAutoConfirmation", () => {
    it("should approve an explicit source-backed normative requirement (happy path)", async () => {
      const db = createMockDb(cleanQueue(baseRequirement()));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, true);
      assert.equal(result.gates.length, 12);
      assert.ok(result.gates.every((g) => g.pass));
      assert.equal(result.policyVersion, SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION);
      assert.equal(result.actor, SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR);
    });

    it("should reject when requirement not found", async () => {
      const db = createMockDb([null]);
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_missing",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
    });

    it("should reject already-approved requirements", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({ review_status: "Approved" })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.ok(result.gates[0].reason.includes("Approved"));
    });

    it("should reject non-mandatory types", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({ requirement_type: "Informational" })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "Requirement type is Informational");
    });

    it("should reject text without a normative modal", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({
        original_text: "Thermal detectors employ an advanced thermistor sensing circuit.",
      })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "No normative modal found");
    });

    it("should reject weak phrasing even with a modal", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({
        original_text: "Detectors shall be suitable as required by the engineer.",
      })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "Weak phrasing detected");
    });

    it("should reject stale extraction requirements", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({ extraction_version_id: "extract_old" })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "Stale extraction version");
    });

    it("should reject requirements with conditions or exceptions", async () => {
      const withCondition = createMockDb([baseRequirement({ condition: "where applicable" }), null, null]);
      const r1 = await evaluateSpecRequirementAutoConfirmation(withCondition, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(r1.eligible, false);

      const withException = createMockDb([baseRequirement({ exception: "except kitchens" }), null, null]);
      const r2 = await evaluateSpecRequirementAutoConfirmation(withException, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(r2.eligible, false);
    });

    it("should reject requirements with open ambiguity or conflict", async () => {
      const withAmbiguity = createMockDb([baseRequirement(), { id: "amb_1" }]);
      const r1 = await evaluateSpecRequirementAutoConfirmation(withAmbiguity, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(r1.eligible, false);
      assert.equal(r1.reason, "Open ambiguity exists");

      const withConflict = createMockDb([baseRequirement(), null, { id: "conf_1" }]);
      const r2 = await evaluateSpecRequirementAutoConfirmation(withConflict, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(r2.eligible, false);
      assert.equal(r2.reason, "Open conflict exists");
    });

    it("should reject unknown system attribution", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({ system: "Unknown" })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "System unknown");
    });

    it("should reject commercial qualification boilerplate", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({
        original_text: "The contractor shall have 10 years of experience and ISO 9001 certification.",
        system: "Fire Alarm",
      })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "Commercial boilerplate");
    });

    it("should reject apostrophe-form experience qualifications (live false-positive req 17)", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({
        original_text: "The manufacturer must have at least 10 years' experience in designing, engineering, manufacturing, and servicing fire detection and alarm system equipment.",
      })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "Commercial boilerplate");
    });

    it("should reject personnel expertise qualifications (live false-positive req 435)", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({
        original_text: "Installation personnel must be overseen by supervisors with proven expertise in installing, inspecting, and testing fire alarm systems.",
      })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "Commercial boilerplate");
    });

    it("should reject delegated design choices", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({
        original_text: "Detector locations shall be as directed by the engineer.",
      })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, "Delegated design choice");
    });

    it("should reject excluded technical categories", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({
        original_text: "Personnel shall receive training in alarm acknowledgement.",
        category: "Training",
      })));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, false);
      assert.ok(result.reason.includes("Excluded category"));
    });

    it("should accept snake_case raw SQLite rows (adapter compatibility)", async () => {
      const db = createMockDb(cleanQueue(baseRequirement()));
      const result = await evaluateSpecRequirementAutoConfirmation(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.eligible, true);
    });
  });

  describe("autoConfirmSpecRequirement", () => {
    it("should write approval + audit trail when eligible", async () => {
      const db = createMockDb(cleanQueue(baseRequirement()));
      const result = await autoConfirmSpecRequirement(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.success, true);
      assert.equal(result.requirementId, "req_1");
      // 1 UPDATE + 1 INSERT
      assert.equal(db._state.writes, 2);
    });

    it("should not write anything when ineligible", async () => {
      const db = createMockDb(cleanQueue(baseRequirement({ requirement_type: "Preferred" })));
      const result = await autoConfirmSpecRequirement(db, {
        requirementId: "req_1",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.success, false);
      assert.equal(db._state.writes, 0);
    });

    it("should never auto-confirm descriptive fragments without normative force", async () => {
      // Mirrors live requirement_192: descriptive heat-detector text, Mandatory
      // type, but no shall/must modal in the extracted fragment.
      const db = createMockDb(cleanQueue(baseRequirement({
        original_text: "Thermal detectors employ an advanced thermistor sensing circuit to deliver fixed-temperature detection at 135°F (57°C) and rate-of-rise thermal detection.",
      })));
      const result = await autoConfirmSpecRequirement(db, {
        requirementId: "req_192",
        activeExtractionVersionId: "extract_active",
      });
      assert.equal(result.success, false);
      assert.equal(db._state.writes, 0);
    });
  });
});