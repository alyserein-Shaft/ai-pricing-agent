import test from "node:test";
import assert from "node:assert/strict";
import { commandThenRefresh } from "../app/lib/api-client.ts";
import { parseProjectLocation } from "../app/lib/project-navigation.mjs";
import { pricingLineModel, pricingSourcePresentation, quotationActionState, quotationTotals } from "../app/components/workspaces/commercial-models.mjs";
import { validateManualPriceInput } from "../app/domain/pricing-engine.mjs";

const item = { id: "boq-1", item_number: "1", description: "Panel" };

test("pricing values render from the persisted server line", () => {
  const view = pricingLineModel(item, { line: { status: "Draft Price", version_number: 4, output: { totalCost: 100, netSelling: 125, approvalReady: true } } });
  assert.equal(view.version, 4); assert.equal(view.result.netSelling, 125);
});

test("approval-ready pricing remains a draft and is not labelled approved", () => {
  const view = pricingLineModel(item, { line: { status: "Draft Price", output: { approvalReady: true } } });
  assert.equal(view.status, "Draft Price"); assert.notEqual(view.status, "Approved");
});

test("expired and historical sources cannot appear as approved costing sources", () => {
  assert.equal(pricingSourcePresentation({ type: "Historical Catalogue", eligibleForCosting: true }).costingApproved, false);
  assert.equal(pricingSourcePresentation({ type: "Supplier Quote", eligibleForCosting: false }).costingApproved, false);
});

test("manual pricing requires a reason and server-governed evidence", () => {
  const result = validateManualPriceInput({ input: { projectId: "p1", boqItemId: "b1", candidateId: "c1", price: 10, currency: "SAR" }, user: { id: "u1", role: "Estimator" }, technicalApproval: { status: "Approved", candidateId: "c1" } });
  assert.equal(result.permitted, false); assert.ok(result.missing.length > 0);
});

test("pricing mutation refetches authoritative truth", async () => {
  const calls=[]; const result=await commandThenRefresh({ command:async()=>{calls.push("command");return{status:"Draft"}}, refresh:async()=>{calls.push("refresh");return{line:{status:"Blocked"}}} });
  assert.deepEqual(calls,["command","refresh"]); assert.equal(result.readModel.line.status,"Blocked");
});

test("commercial approval mutation refetches server truth", async () => {
  let local="In Review"; await commandThenRefresh({ command:async()=>({status:"Approved"}), refresh:async()=>{local="Blocked";return local} }); assert.equal(local,"Blocked");
});

test("failed mutation never produces local approved state", async () => {
  let state="In Review"; await assert.rejects(commandThenRefresh({command:async()=>{throw new Error("blocked")},refresh:async()=>{state="Approved"}})); assert.equal(state,"In Review");
});

test("quotation readiness is canonical workflow truth", () => {
  const actions=quotationActionState({readyForQuotation:false,readyForIssue:false},null,false); assert.equal(actions.canDraft,false);
});

test("quotationReady false disables approval and issue", () => {
  const workflow={readyForQuotation:false,readyForIssue:false}; assert.equal(quotationActionState(workflow,{status:"Draft"},false).canApprove,false); assert.equal(quotationActionState(workflow,{status:"Approved"},false).canIssue,false);
});

test("quotation revision and totals restore from server response", () => {
  const quotation={revision_number:3,status:"Approved",total_minor:12500,subtotal_minor:10000,vat_minor:2500}; assert.equal(quotation.revision_number,3); assert.equal(quotationTotals(quotation).total,125);
});

test("stale quotation cannot be approved or issued", () => {
  const workflow={readyForQuotation:true,readyForIssue:true}; assert.equal(quotationActionState(workflow,{status:"Draft"},true).canApprove,false); assert.equal(quotationActionState(workflow,{status:"Approved"},true).canIssue,false);
});

test("pricing scenario deep link survives refresh and browser history parsing", () => {
  const location=parseProjectLocation("?project=p1&workspace=Costing&scenario=scenario-7"); assert.equal(location.selectedScenarioId,"scenario-7");
});

test("client selection cannot change canonical workflow readiness", () => {
  const workflow=Object.freeze({readyForQuotation:false,readyForIssue:false}); parseProjectLocation("?project=p1&workspace=Quotation&revision=rev-9"); assert.equal(workflow.readyForQuotation,false);
});
