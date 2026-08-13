import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("shared prerequisite state separates semantic label from user-facing prose", async () => {
  const ui = await source("app/components/shared/WorkspaceStates.tsx");
  assert.match(ui, /semanticLabel/);
  assert.match(ui, /workspace-state-badge[^>]*>\{semanticLabel\}<\/span>/);
  assert.match(ui, /workspace-state-title[^>]*>\{title\}<\/strong>/);
  assert.doesNotMatch(ui, /<small>\{state\}<\/small><strong>\{title\}/);
});

test("Costing presents a semantic waiting badge, separate message, reason, and one action", async () => {
  const ui = await source("app/components/workspaces/PricingWorkspace.tsx");
  assert.match(ui, /state="WAITING" statusLabel="Waiting for technical review" title="Pricing is not available yet"/);
  assert.match(ui, /detail=\{props\.blocker \|\|/);
  assert.match(ui, /action="Open technical review"/);
  assert.equal((ui.match(/action="Open technical review"/g) || []).length, 1);
});

test("waiting and blocked prerequisite treatments never use success green", async () => {
  const css = await source("app/globals.css");
  const waiting = css.match(/\.workspace-state-waiting \{([^}]*)\}/)?.[1] || "";
  const blocked = css.match(/\.workspace-state-blocked \{([^}]*)\}/)?.[1] || "";
  assert.match(waiting, /#b46b00/);
  assert.match(blocked, /#b33b43/);
  assert.doesNotMatch(`${waiting}${blocked}`, /#16673f|#e8f7ef|var\(--green\)/i);
});

test("Quotation blocked state uses semantic prose and does not expose its raw token", async () => {
  const ui = await source("app/components/workspaces/QuotationWorkspace.tsx");
  assert.match(ui, /state="BLOCKED" statusLabel="Blocked" title="Quotation cannot be drafted yet"/);
  assert.doesNotMatch(ui, />BLOCKED\{/);
});

test("Supplier Price Evidence empty and blocked messaging contains no raw machine token", async () => {
  const ui = await source("app/components/workspaces/SupplierPriceIntakeWorkspace.tsx");
  assert.match(ui, /No extracted supplier quotation lines/);
  assert.doesNotMatch(ui, />\{?(?:WAITING|BLOCKED|EMPTY|NOT_STARTED)\}?/);
});
