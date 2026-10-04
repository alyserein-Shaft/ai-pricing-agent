// FARENHYT ECOSYSTEM VOCABULARY CLOSURE -- focused tests.
//
// WHY THIS FILE EXISTS
// --------------------
// `PRELIMINARY_PANEL_FAMILIES` contained only `INSPIRE_N16`, a NOTIFIER platform,
// while `validateProjectFireAlarmEcosystemDecision` correctly enforces
// `family.manufacturer === ecosystem`. The consequence was structural: a project
// whose governed Brand Strategy resolves to an IN-HOUSE Farenhyt basis could not
// record a governed Fire Alarm ecosystem decision at all. `compatibilityTarget`
// therefore never resolved, the Requirement Profile stayed "Missing Critical
// Information", and no candidate could ever leave Discovery.
//
// These tests pin BOTH directions of the fix and, just as importantly, pin that the
// fix did NOT weaken validation: the manufacturer equality check, the mandatory
// family requirement, the fail-closed path, and the refusal to let one manufacturer's
// panel satisfy another manufacturer's ecosystem all still hold.
//
// Nothing here reads or writes a project database. Every case is a pure domain call.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ECOSYSTEM_PROTOCOLS,
  PANEL_FAMILY_ELIGIBILITY,
  PRELIMINARY_PANEL_FAMILIES,
  PRELIMINARY_PANEL_FAMILY_KEYS,
  PROJECT_ECOSYSTEM_KEYS,
  PROJECT_ECOSYSTEM_VOCABULARY,
  validateProjectFireAlarmEcosystemDecision,
} from "../app/domain/fire-alarm-ecosystem-decision.mjs";

// ---------------------------------------------------------------------------
// A complete, valid governed input. Tests override only what they are proving.
// ---------------------------------------------------------------------------
const base = (over = {}) => ({
  ecosystem: "FARENHYT",
  primaryProtocol: ECOSYSTEM_PROTOCOLS.IDP_SK, // "IDP/SK"
  allowedLegacyProtocols: [],
  preliminaryPanelFamily: {
    key: "FARENHYT_IFP_2100",
    isSelected: false,
    isConsultantApproved: false,
  },
  complianceBasisState: "PARTIALLY_RESOLVED",
  contractualManufacturerAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
  substitutionAuthority: "HUMAN_APPROVAL_REQUIRED",
  directMatchPolicy: "Only the decided ecosystem is a direct match.",
  notDirectMatchEcosystems: ["NOTIFIER", "SIMPLEX", "GENT", "GAMEWELL_FCI"],
  appliesWhile: "This project's Fire Alarm system under its current specification version.",
  evidence: ["Central Kitchen electrical-specs.pdf Section 28 30 00"],
  reason: "Governed Brand Strategy resolved to FARENHYT; record the technical design basis.",
  decidedBy: "benchmark-operator",
  decidedRole: "Technical Manager",
  specificationVersion: "ver_bench_spec_v1",
  ...over,
});

const rejects = (input, code) => {
  assert.throws(
    () => validateProjectFireAlarmEcosystemDecision(input),
    (error) => {
      assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
      return true;
    },
  );
};

// ===========================================================================
// 1. The governed Farenhyt family exists and is correctly attributed.
// ===========================================================================
test("FARENHYT_IFP_2100 is a governed preliminary panel family attributed to FARENHYT", () => {
  assert.ok(PRELIMINARY_PANEL_FAMILY_KEYS.includes("FARENHYT_IFP_2100"));
  const family = PRELIMINARY_PANEL_FAMILIES.FARENHYT_IFP_2100;

  // The manufacturer field MUST equal the FARENHYT ecosystem key, otherwise the
  // validator could never accept it. This is the field the whole gap turned on.
  assert.equal(family.manufacturer, "FARENHYT");
  assert.ok(PROJECT_ECOSYSTEM_KEYS.includes(family.manufacturer));

  // A series-level family with real candidate models, not one accidental SKU.
  assert.ok(Array.isArray(family.candidates) && family.candidates.length >= 2);
  assert.deepEqual(family.candidates, ["IFP-2100HV", "IFP-2100HVB", "IFP-2100ECSHV", "IFP-2100ECSHVB"]);
  for (const model of family.candidates) {
    assert.equal(family.candidateKinds[model], "MODEL", `${model} must be a purchasable MODEL`);
  }

  // Technical eligibility only. Never a selection, never Consultant approval.
  assert.equal(family.eligibility, PANEL_FAMILY_ELIGIBILITY.TECHNICALLY_ACCEPTABLE_CANDIDATE);
  assert.equal(family.isSelected, false);
  assert.equal(family.isConsultantApproved, false);
  assert.equal(family.finalModelSelection, "PENDING_LATER_ENGINEERING_DECISION");
});

// ===========================================================================
// 2. Sizing honesty -- a nameplate is not a sizing ceiling.
// ===========================================================================
test("the Farenhyt family records 2100 as a NAMEPLATE and refuses to treat it as sizing authority", () => {
  const family = PRELIMINARY_PANEL_FAMILIES.FARENHYT_IFP_2100;
  assert.equal(family.nameplateSystemPoints, 2100);
  assert.equal(family.nameplateIsSizingAuthority, false);
  assert.equal(family.sizingAuthority, null, "no net sizing authority may be asserted in this record");
  assert.equal(family.sizingReadiness, "PARTIALLY");

  // The governed capability evidence behind the nameplate.
  assert.equal(family.governedCapabilityEvidence.nativeSlcLoops, 1);
  assert.equal(family.governedCapabilityEvidence.maxDetectorsPerLoop, 159);
  assert.equal(family.governedCapabilityEvidence.maxModulesPerLoop, 159);
  assert.deepEqual(family.governedCapabilityEvidence.expansionComponents, ["5815RMK", "6815"]);

  // 1 x (159 + 159) is NOT 2100. The entry must not let the nameplate close that gap.
  const evidence = family.governedCapabilityEvidence;
  assert.notEqual(
    evidence.nativeSlcLoops * (evidence.maxDetectorsPerLoop + evidence.maxModulesPerLoop),
    family.nameplateSystemPoints,
    "a single loop's detector+module limit must not equal the nameplate system points",
  );
});

// ===========================================================================
// 3. Deliberate exclusions -- non-panels and the wrong-size family stay out.
// ===========================================================================
test("cabinets, software, the FFT panel, the remote RFP series and the IFP-75 family are not candidates", () => {
  const family = PRELIMINARY_PANEL_FAMILIES.FARENHYT_IFP_2100;
  for (const excluded of [
    "IFP-75",
    "IFP-75B",
    "IFP-75HV",
    "IFP-75HVB",
    "RFP-2100HV",
    "RFP-2100HVB",
    "IFP-2100BCB",
    "IFP-2100ECSCB",
    "IFP-NET-3",
    "IFP-FFT",
  ]) {
    assert.ok(!family.candidates.includes(excluded), `${excluded} must not be an IFP-2100 family candidate`);
  }
  // Each exclusion is documented, so the omission is a recorded decision.
  assert.ok(family.exclusions["IFP-75 / IFP-75B / IFP-75HV / IFP-75HVB"]);
  assert.ok(family.exclusions["RFP-2100HV / RFP-2100HVB"]);
  assert.ok(family.exclusions["IFP-2100BCB / IFP-2100ECSCB"]);
});

// ===========================================================================
// 4. TEST 1 -- a FARENHYT decision validates and persists its compatibility target.
// ===========================================================================
test("a FARENHYT project ecosystem decision validates and yields the Farenhyt compatibility target", () => {
  const decision = validateProjectFireAlarmEcosystemDecision(base());

  assert.equal(decision.ecosystem, "FARENHYT");
  assert.equal(decision.preliminaryPanelFamily.key, "FARENHYT_IFP_2100");
  assert.equal(decision.preliminaryPanelFamily.manufacturer, "FARENHYT");
  assert.equal(decision.preliminaryPanelFamily.family, "Honeywell Farenhyt IFP-2100 Series");
  assert.deepEqual(decision.preliminaryPanelFamily.candidates, [
    "IFP-2100HV",
    "IFP-2100HVB",
    "IFP-2100ECSHV",
    "IFP-2100ECSHVB",
  ]);

  // The whole point of the fix: the compatibility target now resolves.
  assert.equal(decision.compatibilityTarget, PROJECT_ECOSYSTEM_VOCABULARY.FARENHYT.compatibilityTarget);
  assert.match(decision.compatibilityTarget, /Farenhyt/);

  // The decision is still a technical basis, never a selection or an approval.
  assert.equal(decision.preliminaryPanelFamily.isSelected, false);
  assert.equal(decision.preliminaryPanelFamily.isConsultantApproved, false);
  assert.equal(decision.contractualManufacturerAcceptance, "CONSULTANT_APPROVAL_REQUIRED");
});

// ===========================================================================
// 5. TEST 4 -- NOTIFIER's family may NOT satisfy a FARENHYT ecosystem.
//    This is the exact failure the benchmark hit, pinned as a regression.
// ===========================================================================
test("INSPIRE_N16 cannot satisfy a FARENHYT ecosystem decision", () => {
  rejects(
    base({ preliminaryPanelFamily: { key: "INSPIRE_N16", isSelected: false, isConsultantApproved: false } }),
    "ECOSYSTEM_PANEL_FAMILY_MANUFACTURER_MISMATCH",
  );
});

// ===========================================================================
// 6. TEST 5 -- FARENHYT's family may NOT satisfy a NOTIFIER ecosystem.
// ===========================================================================
test("FARENHYT_IFP_2100 cannot satisfy a NOTIFIER ecosystem decision", () => {
  rejects(
    base({
      ecosystem: "NOTIFIER",
      primaryProtocol: ECOSYSTEM_PROTOCOLS.FLASHSCAN,
      preliminaryPanelFamily: { key: "FARENHYT_IFP_2100", isSelected: false, isConsultantApproved: false },
    }),
    "ECOSYSTEM_PANEL_FAMILY_MANUFACTURER_MISMATCH",
  );
});

// ===========================================================================
// 7. TEST 1 (NOTIFIER half) -- the pre-existing NOTIFIER path is untouched.
// ===========================================================================
test("NOTIFIER INSPIRE_N16 still validates only for NOTIFIER and keeps its licensed-persona distinction", () => {
  const decision = validateProjectFireAlarmEcosystemDecision(
    base({
      ecosystem: "NOTIFIER",
      primaryProtocol: ECOSYSTEM_PROTOCOLS.FLASHSCAN,
      allowedLegacyProtocols: [ECOSYSTEM_PROTOCOLS.CLIP],
      preliminaryPanelFamily: { key: "INSPIRE_N16", isSelected: false, isConsultantApproved: false },
      notDirectMatchEcosystems: ["SIMPLEX", "FARENHYT", "GENT", "GAMEWELL_FCI"],
    }),
  );

  assert.equal(decision.ecosystem, "NOTIFIER");
  assert.equal(decision.preliminaryPanelFamily.key, "INSPIRE_N16");
  assert.equal(decision.preliminaryPanelFamily.manufacturer, "NOTIFIER");
  // The N16x is a licensed persona on N16e hardware, not a purchasable model.
  assert.equal(decision.preliminaryPanelFamily.candidateKinds.N16e, "MODEL");
  assert.equal(decision.preliminaryPanelFamily.candidateKinds.N16x, "LICENSED_PERSONA_ON_N16E");
  assert.equal(decision.preliminaryPanelFamily.personaUpgrade.licence, "N16-XUPG");
  assert.equal(decision.compatibilityTarget, PROJECT_ECOSYSTEM_VOCABULARY.NOTIFIER.compatibilityTarget);
});

// ===========================================================================
// 8. TEST 2 -- FARENHYT family rejects a NOTIFIER protocol and vice versa.
//    The vocabulary and the protocol model must agree.
// ===========================================================================
test("the Farenhyt family accepts only the IDP/SK protocol its ecosystem declares", () => {
  // Correct protocol for FARENHYT validates.
  assert.equal(validateProjectFireAlarmEcosystemDecision(base()).primaryProtocol, "IDP/SK");

  // A NOTIFIER protocol is refused.
  rejects(base({ primaryProtocol: ECOSYSTEM_PROTOCOLS.FLASHSCAN }), "ECOSYSTEM_PROTOCOL_NOT_SUPPORTED");
  rejects(base({ primaryProtocol: ECOSYSTEM_PROTOCOLS.VELOCITI }), "ECOSYSTEM_PROTOCOL_NOT_SUPPORTED");

  // Declared in the vocabulary too, so the family can never drift from the ecosystem.
  assert.deepEqual(PROJECT_ECOSYSTEM_VOCABULARY.FARENHYT.protocols, [ECOSYSTEM_PROTOCOLS.IDP_SK]);
  assert.equal(PRELIMINARY_PANEL_FAMILIES.FARENHYT_IFP_2100.protocolBasis, ECOSYSTEM_PROTOCOLS.IDP_SK);
});

// ===========================================================================
// 9. TEST 6 -- a missing / unknown family stays fail-closed.
// ===========================================================================
test("an absent or unknown preliminary panel family remains fail-closed", () => {
  // Absent entirely.
  rejects(base({ preliminaryPanelFamily: undefined }), "ECOSYSTEM_PANEL_FAMILY_REQUIRED");
  rejects(base({ preliminaryPanelFamily: {} }), "ECOSYSTEM_PANEL_FAMILY_REQUIRED");
  // Present but not in the governed vocabulary.
  rejects(base({ preliminaryPanelFamily: { key: "ANY_IN_HOUSE_PANEL" } }), "ECOSYSTEM_PANEL_FAMILY_NOT_SUPPORTED");
  rejects(base({ preliminaryPanelFamily: { key: "IFP_2100" } }), "ECOSYSTEM_PANEL_FAMILY_NOT_SUPPORTED");
  // A generic manufacturer-agnostic key must never exist in the vocabulary.
  assert.ok(!PRELIMINARY_PANEL_FAMILY_KEYS.includes("ANY_IN_HOUSE_PANEL"));
  assert.ok(!PRELIMINARY_PANEL_FAMILY_KEYS.includes("ANY_PANEL"));
});

// ===========================================================================
// 10. The panel family stays a TECHNICAL BASIS -- it may never record a
//     selection or a Consultant approval, for any ecosystem.
// ===========================================================================
test("a panel family may never record a final selection or Consultant approval", () => {
  rejects(
    base({ preliminaryPanelFamily: { key: "FARENHYT_IFP_2100", isSelected: true } }),
    "ECOSYSTEM_PANEL_SELECTION_NOT_PERMITTED",
  );
  rejects(
    base({ preliminaryPanelFamily: { key: "FARENHYT_IFP_2100", isConsultantApproved: true } }),
    "ECOSYSTEM_PANEL_SELECTION_NOT_PERMITTED",
  );
  rejects(
    base({
      preliminaryPanelFamily: {
        key: "FARENHYT_IFP_2100",
        eligibility: "CONSULTANT_APPROVED",
      },
    }),
    "ECOSYSTEM_PANEL_ELIGIBILITY_NOT_PERMITTED",
  );
});

// ===========================================================================
// 11. EVIDENCE_REQUIRED ecosystems stay refused -- symmetry is not a reason to add.
// ===========================================================================
test("GAMEWELL_FCI and GENT have no governed panel family and are refused fail-closed", () => {
  for (const ecosystem of ["GAMEWELL_FCI", "GENT", "SIMPLEX"]) {
    assert.ok(
      !PRELIMINARY_PANEL_FAMILY_KEYS.some(
        (key) => PRELIMINARY_PANEL_FAMILIES[key].manufacturer === ecosystem,
      ),
      `${ecosystem} must have no governed panel family until product evidence exists`,
    );
  }

  // GAMEWELL_FCI: no family of its own, so the family is missing/unsupported.
  rejects(
    base({
      ecosystem: "GAMEWELL_FCI",
      primaryProtocol: ECOSYSTEM_PROTOCOLS.VELOCITI,
      preliminaryPanelFamily: { key: "FARENHYT_IFP_2100" },
      notDirectMatchEcosystems: ["NOTIFIER", "SIMPLEX", "GENT", "FARENHYT"],
    }),
    "ECOSYSTEM_PANEL_FAMILY_MANUFACTURER_MISMATCH",
  );

  // GENT shares the IDP/SK protocol with FARENHYT. The protocol alone must never be
  // enough to let a Farenhyt panel stand in for a Gent project.
  rejects(
    base({
      ecosystem: "GENT",
      primaryProtocol: ECOSYSTEM_PROTOCOLS.IDP_SK,
      preliminaryPanelFamily: { key: "FARENHYT_IFP_2100" },
      notDirectMatchEcosystems: ["NOTIFIER", "SIMPLEX", "FARENHYT", "GAMEWELL_FCI"],
    }),
    "ECOSYSTEM_PANEL_FAMILY_MANUFACTURER_MISMATCH",
  );
  rejects(
    base({
      ecosystem: "GENT",
      primaryProtocol: ECOSYSTEM_PROTOCOLS.IDP_SK,
      preliminaryPanelFamily: { key: "INSPIRE_N16" },
      notDirectMatchEcosystems: ["NOTIFIER", "SIMPLEX", "FARENHYT", "GAMEWELL_FCI"],
    }),
    "ECOSYSTEM_PANEL_FAMILY_MANUFACTURER_MISMATCH",
  );
});

// ===========================================================================
// 12. TEST 12 -- an identical re-record is deterministic, so the write planner
//     can recognise it as idempotent.
// ===========================================================================
test("re-validating an identical FARENHYT decision is deterministic (idempotency precondition)", () => {
  const input = base();
  const first = validateProjectFireAlarmEcosystemDecision(input);
  const second = validateProjectFireAlarmEcosystemDecision({ ...input });
  assert.deepEqual(second, first, "identical input must produce an identical validated decision");

  // And it is distinct from the NOTIFIER decision, so a supersede is never a no-op
  // masquerading as one.
  const notifier = validateProjectFireAlarmEcosystemDecision(
    base({
      ecosystem: "NOTIFIER",
      primaryProtocol: ECOSYSTEM_PROTOCOLS.FLASHSCAN,
      preliminaryPanelFamily: { key: "INSPIRE_N16" },
      notDirectMatchEcosystems: ["SIMPLEX", "FARENHYT", "GENT", "GAMEWELL_FCI"],
    }),
  );
  assert.notEqual(notifier.preliminaryPanelFamily.key, first.preliminaryPanelFamily.key);
});

// ===========================================================================
// 13. TEST 9 -- the change is additive: no existing key was renamed or removed.
// ===========================================================================
test("the vocabulary change is purely additive", () => {
  assert.ok(PRELIMINARY_PANEL_FAMILY_KEYS.includes("INSPIRE_N16"));
  assert.equal(PRELIMINARY_PANEL_FAMILIES.INSPIRE_N16.manufacturer, "NOTIFIER");
  assert.deepEqual(PRELIMINARY_PANEL_FAMILIES.INSPIRE_N16.candidates, ["N16e", "N16x"]);

  // Every governed family maps to a real declared ecosystem.
  for (const key of PRELIMINARY_PANEL_FAMILY_KEYS) {
    assert.ok(
      PROJECT_ECOSYSTEM_KEYS.includes(PRELIMINARY_PANEL_FAMILIES[key].manufacturer),
      `${key} must belong to a declared ecosystem`,
    );
  }
  // The vocabulary is frozen, so a later mutation cannot silently add a fallback.
  assert.throws(() => {
    "use strict";
    PRELIMINARY_PANEL_FAMILIES.ANY_IN_HOUSE_PANEL = { manufacturer: "ANY" };
  });
});
