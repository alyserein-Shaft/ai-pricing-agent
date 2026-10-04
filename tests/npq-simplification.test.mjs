import test from "node:test";
import assert from "node:assert/strict";
import { validateNpQProfile } from "../app/domain/project-npq-engine.mjs";

// Authority Consolidation & NPQ Simplification Sprint, item 3/12: only
// primarySystem and projectCurrency have any real downstream effect
// (projects.system_domain / project_dashboard_profiles.currency). Delivery
// scope, manufacturer strategy fields, and pricing strategy/source were
// removed from onboarding entirely -- they must never block creation.

test("creation succeeds with only the minimal required fields", () => {
  const result = validateNpQProfile(
    { primarySystem: "Fire Alarm", projectCurrency: "SAR" },
    { forConfirmation: true },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test("primarySystem is still required -- it has real downstream effect (projects.system_domain)", () => {
  const missingSystem = validateNpQProfile({}, { forConfirmation: true });
  assert.equal(missingSystem.ok, false);
  // projectCurrency always normalizes to "SAR" when blank, so it is never
  // reported as literally missing -- only primarySystem has no such default.
  assert.deepEqual(missingSystem.missing, ["primarySystem"]);

  const complete = validateNpQProfile({ primarySystem: "CCTV" }, { forConfirmation: true });
  assert.equal(complete.ok, true);
  assert.equal(complete.profile.projectCurrency, "SAR");
});

test("removed fields (delivery scope, pricing strategy, primary pricing source type) never block creation regardless of value", () => {
  const result = validateNpQProfile(
    {
      primarySystem: "Fire Alarm",
      projectCurrency: "SAR",
      deliveryScope: "",
      pricingStrategy: "Price List",
      primaryPricingSourceType: "",
    },
    { forConfirmation: true },
  );
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result.missing), /deliveryScope|pricingStrategy|primaryPricingSourceType/);
});

test("manufacturerStrategy-conditional checks remain for any other caller, but are inert for onboarding's default", () => {
  const defaultStrategy = validateNpQProfile(
    { primarySystem: "Fire Alarm", projectCurrency: "SAR" },
    { forConfirmation: true },
  );
  assert.equal(defaultStrategy.profile.manufacturerStrategy, "Detect from Specification");
  assert.equal(defaultStrategy.ok, true);

  const explicitFixedNoManufacturer = validateNpQProfile(
    { primarySystem: "Fire Alarm", projectCurrency: "SAR", manufacturerStrategy: "Fixed Manufacturer" },
    { forConfirmation: true },
  );
  assert.equal(explicitFixedNoManufacturer.ok, false);
  assert.deepEqual(explicitFixedNoManufacturer.missing, ["preferredManufacturer"]);
});

test("deliveryScope always normalizes to a valid enum value even when never collected -- ONBOARDING RECOVERY C: the explicit unresolved state, never a false real commercial scope", () => {
  const result = validateNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR" });
  assert.equal(result.profile.deliveryScope, "Pending Tender Review");
});
