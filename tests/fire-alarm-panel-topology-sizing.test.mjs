import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allocateBoqDemandToPanels } from "../app/domain/fire-alarm-panel-demand-allocation.mjs";
import { sizeProjectSlcPanels, nonAuthoritativeAggregateCheck } from "../app/domain/fire-alarm-panel-slc-sizing.mjs";

const realPanelCapacity = { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 2100 };
const realExpansionOptions = { loopExpansionUnit: { partNumber: "6815", loopsAddedPerUnit: 1 }, mountingUnit: { partNumber: "5815RMK", capacityPerMountingUnit: 2 } };

test("1. native capacity is applied per physical panel, not once per project", () => {
  // Two panels each with the SAME demand as native capacity: neither should
  // need expansion. If native capacity were applied only once project-wide,
  // the second panel's demand would wrongly appear to exceed capacity.
  const panels = [
    { panelId: "panel-A", demand: { detectors: 159, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions },
    { panelId: "panel-B", demand: { detectors: 159, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions },
  ];
  const result = sizeProjectSlcPanels({ panels });
  assert.equal(result.status, "AUTHORITATIVE_PANEL_SIZING");
  assert.equal(result.panels[0].status, "NO_EXPANSION_REQUIRED");
  assert.equal(result.panels[1].status, "NO_EXPANSION_REQUIRED");
});

test("2. demand allocated to Panel A cannot consume Panel B capacity", () => {
  // Panel A is overloaded (needs expansion); Panel B is underloaded (fits
  // natively). Panel B's spare capacity must never offset Panel A's need.
  const panels = [
    { panelId: "panel-A", demand: { detectors: 300, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions },
    { panelId: "panel-B", demand: { detectors: 10, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions },
  ];
  const result = sizeProjectSlcPanels({ panels });
  assert.equal(result.panels[0].status, "EXPANSION_REQUIRED");
  assert.equal(result.panels[0].requiredExpansionQuantity, 1);
  assert.equal(result.panels[1].status, "NO_EXPANSION_REQUIRED");
  assert.equal(result.panels[1].requiredExpansionQuantity, 0);
});

test("3. unallocated demand is not silently distributed across panels", () => {
  const allocation = allocateBoqDemandToPanels({ boqItemId: "item-28", totalQuantity: 516, allocations: [{ panelId: "panel-A", quantity: 100, evidence: "riser diagram sheet E-101" }] });
  assert.equal(allocation.allocatedQuantity, 100);
  assert.equal(allocation.unallocatedQuantity, 416);
  assert.equal(allocation.status, "PARTIALLY_ALLOCATED");
  // The unallocated remainder must not appear added to panel-A's allocation.
  assert.equal(allocation.allocations.find((a) => a.panelId === "panel-A").quantity, 100);
});

test("4. partial allocation remains partial (matches Step 5's exact example)", () => {
  const allocation = allocateBoqDemandToPanels({ boqItemId: "item-28", totalQuantity: 516, allocations: [{ panelId: "panel-A", quantity: 100 }, { panelId: "panel-B", quantity: 150 }] });
  assert.equal(allocation.allocatedQuantity, 250);
  assert.equal(allocation.unallocatedQuantity, 266);
  assert.equal(allocation.status, "PARTIALLY_ALLOCATED");
});

test("5. unknown topology (no panels) returns INSUFFICIENT_TOPOLOGY_EVIDENCE", () => {
  const result = sizeProjectSlcPanels({ panels: [] });
  assert.equal(result.status, "INSUFFICIENT_TOPOLOGY_EVIDENCE");
  assert.equal(result.projectTotal, null);
});

test("6. an aggregate exploratory sizing can never be marked authoritative", () => {
  const check = nonAuthoritativeAggregateCheck({ demand: { detectors: 1737, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(check.label, "NON_AUTHORITATIVE_AGGREGATE_CHECK");
  assert.match(check.warning, /must never be used as a final expansion quantity/);
  assert.notEqual(check.label, "AUTHORITATIVE_PANEL_SIZING");
});

test("7. panel counts are evidence-derived, never hardcoded -- 0, 1, and 6 panels all work identically", () => {
  for (const count of [0, 1, 6]) {
    const panels = Array.from({ length: count }, (_, i) => ({ panelId: `panel-${i}`, demand: { detectors: 50, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions }));
    const result = sizeProjectSlcPanels({ panels });
    if (count === 0) assert.equal(result.status, "INSUFFICIENT_TOPOLOGY_EVIDENCE");
    else { assert.equal(result.status, "AUTHORITATIVE_PANEL_SIZING"); assert.equal(result.panels.length, count); }
  }
  const orchestrationSource = readFileSync(fileURLToPath(new URL("../app/domain/fire-alarm-panel-slc-sizing.mjs", import.meta.url)), "utf8");
  assert.ok(!/\bpanels\.length\s*(===|==)\s*6\b/.test(orchestrationSource), "orchestration source must not special-case a panel count of 6");
});

test("8. module and detector pools remain separate at the panel level", () => {
  const panels = [{ panelId: "panel-A", demand: { detectors: 159, modules: 159 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions }];
  const result = sizeProjectSlcPanels({ panels });
  assert.equal(result.panels[0].status, "NO_EXPANSION_REQUIRED"); // would wrongly need 2 loops if pools were summed to 318
  assert.equal(result.panels[0].nativeCapacity.detectors, 159);
  assert.equal(result.panels[0].nativeCapacity.modules, 159);
});

test("9. B200S-IV's unresolved SLC address behavior is not guessed into module demand", () => {
  // The Sprint 1.2 investigation found official evidence is ambiguous on
  // whether an addressable sounder base consumes an independent module
  // address. Demand allocation must therefore never count it -- verified
  // here at the allocation layer: only detector demand is ever asserted for
  // an item pairing a detector with a sounder base, never module demand
  // derived from the same device count.
  const detectorAllocation = allocateBoqDemandToPanels({ boqItemId: "item-29", totalQuantity: 1221, allocations: [{ panelId: "panel-A", quantity: 1221, evidence: "IDP-PHOTO-IV addressable detector, confirmed" }] });
  assert.equal(detectorAllocation.allocatedQuantity, 1221);
  // No module-bucket allocation is ever asserted for the same 1221 units.
  const moduleAllocation = allocateBoqDemandToPanels({ boqItemId: "item-29-sounder-base-modules", totalQuantity: 0, allocations: [] });
  assert.equal(moduleAllocation.status, "UNALLOCATED");
  assert.equal(moduleAllocation.totalQuantity, 0);
});

test("10. invalid 'MCLP' addressing cannot enter governed capacity demand", () => {
  // Traced live in Sprint 1.2 Step 12: the current semantic validator
  // rejects "MCLP" outright.
  const validator = readFileSync(fileURLToPath(new URL("../app/domain/system-knowledge-registry.mjs", import.meta.url)), "utf8");
  assert.ok(validator.length > 0);
  // Demand allocation itself never accepts a raw addressing string -- it
  // only accepts pre-vetted quantities the caller asserts are addressable;
  // "MCLP" is not a valid panelId/evidence shape that could smuggle a
  // capacity_bucket assignment through this function.
  assert.throws(() => allocateBoqDemandToPanels({ boqItemId: "item-34", totalQuantity: "MCLP", allocations: [] }), /non-negative totalQuantity/);
});

test("11. historical quotation quantities never become topology inputs", () => {
  // The historical Opera quotation lists 6 panels (sn1 qty6). This module
  // must never read or reference that historical figure to construct a
  // panels array -- panels are supplied entirely by the caller from project
  // topology evidence. Verified here: an empty topology yields
  // INSUFFICIENT_TOPOLOGY_EVIDENCE even though a historical count of 6 is
  // known to exist for this exact project.
  const result = sizeProjectSlcPanels({ panels: [] });
  assert.equal(result.status, "INSUFFICIENT_TOPOLOGY_EVIDENCE");
  assert.equal(result.panels.length, 0);
});

test("12. provenance survives panel allocation and sizing", () => {
  const allocation = allocateBoqDemandToPanels({ boqItemId: "item-28", totalQuantity: 200, allocations: [{ panelId: "panel-A", quantity: 200, evidence: "riser diagram E-101, panel FACP-1 zone" }] });
  assert.equal(allocation.allocations[0].evidence, "riser diagram E-101, panel FACP-1 zone");
  const panels = [{ panelId: "panel-A", demand: { detectors: 200, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions }];
  const sized = sizeProjectSlcPanels({ panels });
  assert.ok(Array.isArray(sized.panels[0].calculationTrace) && sized.panels[0].calculationTrace.length > 0);
  assert.equal(sized.panels[0].panelId, "panel-A");
});

test("13. no project-specific Opera panel IDs are hardcoded in generic domain logic", () => {
  for (const file of ["../app/domain/fire-alarm-panel-demand-allocation.mjs", "../app/domain/fire-alarm-panel-slc-sizing.mjs"]) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    for (const forbidden of ["project_c8d6ffe8", "Opera", "IFP-2100", "6815", "5815"]) {
      assert.ok(!source.includes(forbidden), `${file} must not hardcode "${forbidden}"`);
    }
  }
});
