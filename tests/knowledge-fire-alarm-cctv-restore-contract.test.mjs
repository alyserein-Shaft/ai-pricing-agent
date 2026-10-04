import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GLOBAL_DESTINATIONS, buildGlobalLocation, canonicalizeGlobalSearch, globalNavigationSelection, resolveGlobalDestination } from "../app/lib/application-navigation.mjs";
import { globalWorkspacePresentation } from "../app/lib/project-navigation.mjs";

// R6 — FIRE ALARM / CCTV URL-RESTORE.
// `?workspace=Knowledge&section=Fire+Alarm|CCTV` (and the legacy
// `?workspace=Fire+Alarm+Knowledge|CCTV+Knowledge` forms) resolved to the
// "Fire Alarm Knowledge"/"CCTV Knowledge" workspaces, but
// globalWorkspacePresentation returned null for them, so restoreLocation fell
// through to Dashboard Overview — the Fire Alarm and CCTV surfaces were never
// URL-restorable. The presentation fix maps both workspaces into the Dashboard
// area with their own active module (the page.tsx render branch already exists:
// `activeModule === "Fire Alarm Knowledge"` / `"CCTV Knowledge"`). The section
// shown to the AppShell is derived from the module so the sidebar highlights
// the correct child instead of "Knowledge Files".

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("R6 presentation restores Fire Alarm and CCTV knowledge workspaces from URLs", () => {
  assert.deepEqual(globalWorkspacePresentation("Fire Alarm Knowledge"), {
    topLevelArea: "Dashboard",
    activeModule: "Fire Alarm Knowledge",
    showAllProjects: false,
  });
  assert.deepEqual(globalWorkspacePresentation("CCTV Knowledge"), {
    topLevelArea: "Dashboard",
    activeModule: "CCTV Knowledge",
    showAllProjects: false,
  });
});

test("R6 canonical and legacy destinations resolve to the Fire Alarm/CCTV knowledge workspaces", () => {
  assert.equal(resolveGlobalDestination("Knowledge", "Fire Alarm").workspace, "Fire Alarm Knowledge");
  assert.equal(resolveGlobalDestination("Knowledge", "CCTV").workspace, "CCTV Knowledge");
  assert.equal(resolveGlobalDestination("Fire Alarm Knowledge").workspace, "Fire Alarm Knowledge");
  assert.equal(resolveGlobalDestination("CCTV Knowledge").workspace, "CCTV Knowledge");
});

test("R6 built locations round-trip for every Knowledge leaf including Fire Alarm and CCTV", () => {
  const knowledge = GLOBAL_DESTINATIONS.find((item) => item.id === "Knowledge");
  const leaves = [
    ...knowledge.children.filter((item) => item.section),
    ...(knowledge.children.find((item) => item.id === "Knowledge System Packs")?.children || []),
  ];
  for (const child of leaves) {
    assert.equal(buildGlobalLocation(child.workspace, child.section || ""), `?workspace=Knowledge&section=${child.section.replace(/ /g, "+")}`);
  }
});

test("R6 navigation selection highlights the exact child for every Knowledge section (no Files mis-highlight)", () => {
  assert.deepEqual(globalNavigationSelection("Fire Alarm Knowledge", "Fire Alarm"), { parent: "Knowledge", child: "Knowledge Fire Alarm" });
  assert.deepEqual(globalNavigationSelection("CCTV Knowledge", "CCTV"), { parent: "Knowledge", child: "Knowledge CCTV" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Standards"), { parent: "Knowledge", child: "Knowledge Search" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Search"), { parent: "Knowledge", child: "Knowledge Search" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Product Identities"), { parent: "Knowledge", child: "Knowledge Review" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Review"), { parent: "Knowledge", child: "Knowledge Review" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Manufacturers"), { parent: "Knowledge", child: "Knowledge Search" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Prices"), { parent: "Knowledge", child: "Knowledge Sources" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Files"), { parent: "Knowledge", child: "Knowledge Sources" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Sources"), { parent: "Knowledge", child: "Knowledge Sources" });
});

test("R6 canonical search keeps the canonical Knowledge workspace form for Fire Alarm/CCTV URLs", () => {
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=Fire+Alarm"), "?workspace=Knowledge&section=Fire+Alarm");
  assert.equal(canonicalizeGlobalSearch("?workspace=Fire+Alarm+Knowledge"), "?workspace=Knowledge&section=Fire+Alarm");
  assert.equal(canonicalizeGlobalSearch("?workspace=CCTV+Knowledge"), "?workspace=Knowledge&section=CCTV");
});

test("R6 the app shell passes the module-derived section so the sidebar highlights the Fire Alarm/CCTV child", async () => {
  const page = await source("app/page.tsx");
  const shellRegion = page.slice(page.indexOf("<AppShell"));
  assert.match(shellRegion, /activeModule === "Fire Alarm Knowledge" \? "Fire Alarm" : activeModule === "CCTV Knowledge" \? "CCTV" : knowledgeSection/);
});