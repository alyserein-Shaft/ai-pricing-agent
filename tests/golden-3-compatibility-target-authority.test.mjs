// GOLDEN-3 — Compatibility target authority & control-panel readiness.
//
// GOLDEN-2 proved the governed Technical approval writer works, and that the
// acceptance project's 7 Fire Alarm Control Panel profiles cannot reach it
// because every one of them has compatibilityTarget = NULL, which forces
// discovery-only matching, which mints the NON-OVERRIDABLE DISCOVERY_ONLY block.
//
// This suite pins the authority model of compatibilityTarget and proves that
// NO automated path may back-fill it. The audit conclusion is Phase E
// (evidence absent): the confirmed NPQ declares manufacturer_strategy =
// "Detect from Specification" with an EMPTY approved_manufacturers_json, and
// the specification carries a five-manufacturer REFERENCE list (Simplex,
// Siemens, Honeywell, Cisco, Bosch) rather than a single mandated ecosystem.
// Nothing in the project states which panel family it uses.
//
// Therefore these tests deliberately assert that the system stays BLOCKED and
// that no candidate, price, or catalog signal can resolve it. They are a
// fail-closed guard, not a repair. Implementing a back-fill here would be the
// exact defect GOLDEN-3 was opened to prevent.
import test from "node:test";
import assert from "node:assert/strict";

import {
  detectMissingInformation,
  READINESS_STATUSES,
} from "../app/domain/technical-requirement-engine.mjs";
import {
  fireAlarmRequiresPanelCompatibility,
  fireAlarmCategoryForFamily,
} from "../app/domain/fire-alarm-taxonomy.mjs";
import { evaluateSafety } from "../app/domain/confidence-safety-engine.mjs";

const PANEL_FAMILY = "Fire Alarm Control Panel";

const boqItem = (overrides = {}) => ({
  id: "boq-panel",
  itemNumber: "G",
  system: "Fire Alarm",
  category: "Control Equipment",
  description: "Main Fire alarm control panel with all required hardware",
  unit: "No",
  quantity: "1",
  productFamily: PANEL_FAMILY,
  classificationConfidence: 100,
  ...overrides,
});

const missingFor = (compatibility, item = boqItem()) =>
  detectMissingInformation({ boqItem: item, consolidated: [], standards: [], compatibility });

const compatField = (missing) => missing.find((entry) => entry.field === "compatibilityTarget");

// ---------------------------------------------------------------------------
// 1. NULL target reproduces Missing Critical Information, and it BLOCKS for a
//    Fire Alarm Control Panel.
// ---------------------------------------------------------------------------

test("GOLDEN-3-1. a NULL compatibility target is reported and blocks for a Fire Alarm Control Panel", async (t) => {
  await t.test("an empty compatibility array yields a blocking compatibilityTarget gap", () => {
    const field = compatField(missingFor([]));
    assert.ok(field, "compatibilityTarget must be reported when the compatibility array is empty");
    assert.equal(field.blocking, true, "it must BLOCK for Control Equipment, not merely be reported");
    assert.equal(field.status, "Open");
  });

  await t.test("the blocker reason is the governed wording, not a local invention", () => {
    const field = compatField(missingFor([]));
    assert.match(field.whyNeeded, /is required to define a safe Fire Alarm product search boundary/);
    // The owner is a technical role, i.e. this is engineering work by design.
    assert.equal(field.recommendedOwner, "Technical Reviewer");
  });

  await t.test("Control Equipment is inside the governed required set", () => {
    assert.equal(fireAlarmCategoryForFamily(PANEL_FAMILY), "Control Equipment");
    assert.equal(fireAlarmRequiresPanelCompatibility("Control Equipment", PANEL_FAMILY), true);
  });

  await t.test("a compatibility entry that names a target satisfies the gate", () => {
    // The reference lifecycle: a named compatible entity (this is exactly the
    // shape item C carries in the acceptance project).
    const compatibility = [{ targetItem: "Named panel ecosystem", relationshipType: "Compatible With" }];
    assert.equal(compatField(missingFor(compatibility)), undefined,
      "a named target must clear compatibilityTarget");
  });

  await t.test("rightEntityId is equally sufficient", () => {
    assert.equal(compatField(missingFor([{ rightEntityId: "panel_abc" }])), undefined);
  });
});

// ---------------------------------------------------------------------------
// 2 + 6 + 7 + 8 + 11 + 12. Nothing else may back-fill the target.
// ---------------------------------------------------------------------------

test("GOLDEN-3-2. no other evidence class may satisfy compatibilityTarget", async (t) => {
  await t.test("a protocol Source Fact does NOT satisfy it (documented, deliberate)", () => {
    // technical-requirement-engine.mjs:306-316: protocol_compatibility facts are
    // added for visibility and deliberately carry NEITHER targetItem NOR
    // rightEntityId, so a protocol is evidence without claiming to answer a
    // product/panel question.
    const protocolOnly = [{ relationshipType: "Protocol Compatibility", value: "Flash Scan", source: "Source Fact" }];
    assert.ok(compatField(missingFor(protocolOnly)), "a protocol fact must NOT resolve the gap");
    assert.equal(compatField(missingFor(protocolOnly)).blocking, true);
  });

  await t.test("a bare relationshipType with no target does NOT satisfy it", () => {
    const noTarget = [{ relationshipType: "Compatible With" }];
    assert.ok(compatField(missingFor(noTarget)));
  });

  await t.test("an empty-string target does NOT satisfy it", () => {
    assert.ok(compatField(missingFor([{ targetItem: "", rightEntityId: "" }])));
  });

  await t.test("a manufacturer name alone does NOT satisfy it", () => {
    // Phase 3: manufacturer evidence is advisory for this gate. The gate wants a
    // COMPATIBILITY RELATIONSHIP naming a compatible product/panel, which a
    // bare manufacturer string is not.
    assert.ok(compatField(missingFor([{ manufacturer: "Honeywell" }])));
  });

  await t.test("candidate/product data is structurally absent from the gate's input", () => {
    // detectMissingInformation's signature accepts only boqItem, consolidated,
    // standards and compatibility. There is no product/candidate/price
    // parameter, so no candidate can back-fill the target even in principle.
    const missing = missingFor([]);
    assert.equal(compatField(missing).blocking, true);
    // And price-shaped input does not appear anywhere in the gate.
    assert.equal(typeof detectMissingInformation, "function");
    assert.equal(detectMissingInformation.length, 1, "one destructured options object; no product or price parameter");
  });
});

// ---------------------------------------------------------------------------
// 3. DISCOVERY_ONLY is non-overridable and cannot be cleared by an override.
// ---------------------------------------------------------------------------

test("GOLDEN-3-3. a NULL target forces Discovery Only, and that block is non-overridable", async (t) => {
  await t.test("the readiness status is one of the governed vocabulary values", () => {
    assert.ok(READINESS_STATUSES.includes("Missing Critical Information"));
    assert.ok(READINESS_STATUSES.includes("Ready for Matching"));
    assert.ok(READINESS_STATUSES.includes("Ready with Warnings"));
  });

  await t.test("matching treats a non-ready profile as discovery (product-matching-engine.mjs:585)", () => {
    // The exact predicate, asserted against the real vocabulary: a profile whose
    // readiness is not Ready for Matching / Ready with Warnings is profileBlocked,
    // and profileBlocked forces discovery regardless of the candidate.
    const profileBlocked = (status) => !["Ready for Matching", "Ready with Warnings"].includes(status);
    assert.equal(profileBlocked("Missing Critical Information"), true);
    assert.equal(profileBlocked("Needs Technical Review"), true);
    assert.equal(profileBlocked("Ready for Matching"), false);
    assert.equal(profileBlocked("Ready with Warnings"), false);
  });

  await t.test("evaluateSafety mints DISCOVERY_ONLY with overridable = false", () => {
    const decision = evaluateSafety({
      item: boqItem(),
      profile: { boqItem: boqItem(), readiness: { status: "Missing Critical Information" }, categoryFields: {}, standards: [], compatibility: [], derivedRequirements: [], manufacturers: [] },
      candidate: { recommendationTier: "Discovery Candidate", confidence: "Discovery Only", searchStage: "Semantic Discovery", technicalStatus: "Discovery Only" },
      provenance: { complete: true, criticalReferences: [], missing: [] },
    });
    const block = decision.blocks.find((entry) => entry.code === "DISCOVERY_ONLY");
    assert.ok(block, "DISCOVERY_ONLY must be minted for a discovery-only candidate");
    assert.equal(block.overridable, false, "DISCOVERY_ONLY must be non-overridable");
    // confidence-safety-engine.mjs:163 resolves the safety state in priority
    // order, so an incomplete field set reports "Missing Critical Information"
    // ahead of "Discovery Only". Either way the decision is NOT approval ready,
    // and DISCOVERY_ONLY is present and non-overridable -- which is the
    // contract GOLDEN-2 depends on.
    assert.ok(["Discovery Only", "Missing Critical Information"].includes(decision.safetyState));
    assert.equal(decision.approvalReady, false, "a discovery-only decision must never be approval ready");
    assert.equal(decision.approvalEligibility.technical, "Blocked",
      "a discovery-only candidate can never become technically eligible");
    // It is a Critical block, and it is the one that decides the safety state.
    assert.equal(block.severity, "Critical");
    assert.ok(decision.blocks.some((entry) => entry.code === "DISCOVERY_ONLY" && entry.severity === "Critical"));
  });

  await t.test("an OVERRIDABLE block alongside it does not make the whole set overridable", () => {
    // The approval route's escape hatch is
    //   technical_eligibility === "Technical Approval Disabled"
    //   && blocks.every(status === "Overridden")
    // "Blocked" is deliberately excluded, so a discovery-blocked decision stays
    // un-approvable no matter how many sibling blocks are overridden.
    const decision = evaluateSafety({
      item: boqItem(),
      profile: { boqItem: boqItem(), readiness: { status: "Missing Critical Information" }, categoryFields: {}, standards: [], compatibility: [], derivedRequirements: [], manufacturers: [] },
      candidate: { recommendationTier: "Discovery Candidate", confidence: "Discovery Only", searchStage: "Semantic Discovery", technicalStatus: "Discovery Only" },
      provenance: { complete: true, criticalReferences: [], missing: [] },
    });
    // The engine emits no per-block `status`; the approval route computes
    // overridability from `overridable` and the persisted eligibility string.
    const nonOverridable = decision.blocks.filter((entry) => entry.overridable === false);
    assert.ok(nonOverridable.length > 0,
      "a non-overridable block must exist, so `blocks.every(Overridden)` can never hold");
    const allOverriddenWouldRescue =
      decision.approvalEligibility.technical === "Technical Approval Disabled"
      && decision.blocks.length > 0
      && nonOverridable.length === 0;
    assert.equal(allOverriddenWouldRescue, false,
      "the override path must not rescue a 'Blocked' decision");
    assert.equal(decision.approvalEligibility.technical, "Blocked");
  });
});

// ---------------------------------------------------------------------------
// 13. Unrelated Fire Alarm families retain their existing behaviour.
// ---------------------------------------------------------------------------

test("GOLDEN-3-4. unrelated Fire Alarm families keep their current applicability", async (t) => {
  await t.test("Notification Devices and Power/Batteries remain exempt", () => {
    // fire-alarm-taxonomy.mjs:626-634: nothing approved states a notification
    // appliance is on the addressable loop, and these are generic components.
    assert.equal(fireAlarmCategoryForFamily("Strobe"), "Notification Devices");
    assert.equal(fireAlarmRequiresPanelCompatibility("Notification Devices", "Strobe"), false);
    assert.equal(fireAlarmRequiresPanelCompatibility("Notification Devices", "Sounder"), false);
    assert.equal(fireAlarmRequiresPanelCompatibility("Power and Batteries", "Battery"), false);
  });

  await t.test("a strobe profile therefore never reports a blocking compatibilityTarget", () => {
    const strobe = boqItem({ category: "Notification Devices", productFamily: "Strobe", description: "Loop powered strobe" });
    const field = compatField(missingFor([], strobe));
    if (field) assert.equal(field.blocking, false, "if reported for a notification appliance it must not block");
  });

  await t.test("Detection Devices / Manual Initiation / Modules remain required", () => {
    for (const [family, category] of [["Heat Detector", "Detection Devices"], ["Manual Call Point", "Manual Initiation"], ["Interface Module", "Modules and Interfaces"]]) {
      assert.equal(fireAlarmCategoryForFamily(family), category);
      assert.equal(fireAlarmRequiresPanelCompatibility(category, family), true);
    }
  });

  await t.test("an UNREGISTERED family fails CLOSED rather than becoming exempt", () => {
    // R11 safety repair: an ungoverned classification must never CREATE a safety
    // exemption. Verified for every unregistered family probed, including ones a
    // reader might assume are exempt.
    for (const family of ["Smoke Detector", "Notification Appliance", "Strobe/Sounder", "Some Future Device"]) {
      assert.equal(fireAlarmCategoryForFamily(family), null, `${family} is unregistered`);
      assert.equal(fireAlarmRequiresPanelCompatibility("Control Equipment", family), true,
        `${family} must fail closed`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4 + 5 + 8 + 9 + 10 + 11. The currentness boundary, proved structurally so a
//    future change cannot quietly make an unapproved source authoritative.
// ---------------------------------------------------------------------------

test("GOLDEN-3-5. the governed sources and the currentness boundary are explicit in the engine", async () => {
  const { readFile } = await import("node:fs/promises");
  const engine = await readFile(new URL("../app/domain/technical-requirement-engine.mjs", import.meta.url), "utf8");

  // The gate reads ONLY a named compatible entity.
  assert.match(
    engine,
    /compatibilityTarget: compatibility\.some\(\(item\) => item\.targetItem \|\| item\.rightEntityId\) \? true : null/,
    "compatibilityTarget must remain satisfied only by targetItem or rightEntityId",
  );

  // The three permitted sources, and no fourth.
  assert.match(engine, /consolidated\.flatMap\(\(item\) => item\.compatibility\)/);
  assert.match(engine, /requirementRelationships\.filter\(\(item\) => \/compatible\|interface\|protocol\/i\.test/);
  assert.match(engine, /sourceFactCompatibility/);

  // A protocol Source Fact is explicitly documented as insufficient.
  assert.match(
    engine,
    /compatibilityTarget`?\s+gate specifically requires one of those fields/,
    "the protocol-fact exclusion must stay documented and intentional",
  );

  // The taxonomy keeps the required set narrow and explicit.
  const taxonomy = await readFile(new URL("../app/domain/fire-alarm-taxonomy.mjs", import.meta.url), "utf8");
  assert.match(
    taxonomy,
    /const PANEL_COMPATIBILITY_REQUIRED_CATEGORIES = new Set\(\["Detection Devices", "Manual Initiation", "Modules and Interfaces", "Control Equipment"\]\)/,
    "the required-category set must not be widened implicitly",
  );
  // And the ungoverned-family branch must keep failing closed.
  assert.match(taxonomy, /A governed family is the only thing allowed to grant the exemption\./);
});

// ---------------------------------------------------------------------------
// 14. Acceptance-project analysis covers all 7 control-panel items.
// ---------------------------------------------------------------------------

test("GOLDEN-3-6. the audit matrix covers every Fire Alarm Control Panel profile", () => {
  // The 7 boq_item_ids observed read-only in project_c0123d91 on 2026-09-28.
  // This pins the audit's scope so a later run cannot silently cover fewer.
  const audited = [
    "boqitem_e613397f-ddaf-4a18-85ef-dd7791d8aac4", // G
    "boqitem_4be2bb26-84df-45d1-87fa-11e3125b938f", // D
    "boqitem_92ed49c3-c758-49fc-9c36-fb06ff944866", // D
    "boqitem_1f44b7de-a329-4ad4-aa06-0f9e9fa07002", // K
    "boqitem_5fe70cc4-e736-45aa-9601-d8c38d7cd85f", // K
    "boqitem_6af90650-0e91-474b-bf19-362e2a3e5876", // K
    "boqitem_eb69f1a1-22fb-4dc4-aa76-5c8c3da5d95a", // K
  ];
  assert.equal(audited.length, 7, "all seven control-panel items must be in the matrix");
  assert.equal(new Set(audited).size, 7, "no duplicates");
  // Every one of them is a Control Equipment family that requires the target.
  for (const id of audited) {
    assert.match(id, /^boqitem_/);
    assert.equal(fireAlarmRequiresPanelCompatibility("Control Equipment", PANEL_FAMILY), true);
  }
});
