import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PROJECT_NAVIGATION, projectNavigationSelection } from "../app/lib/application-navigation.mjs";
import { parseProjectLocation, buildProjectLocation } from "../app/lib/project-navigation.mjs";
import {
  resolveUnderstandingReviewSelection,
  shouldAcceptUnderstandingReviewDetail,
  understandingReviewIdentitiesMatch,
} from "../app/domain/understanding-review-selection.mjs";

const key = (character) => character.repeat(28);
const authority = "a".repeat(64);
const queue = (reviewKey, itemReference) => ({ reviewKey, itemReference });
const detail = (reviewKey) => ({ reviewKey, selectionAuthority: authority, authoritativeEvidence: { reviewKey } });

test("AI Understanding Review is URL-restorable under Tender and Understand tender", () => {
  const tender = PROJECT_NAVIGATION.find((item) => item.id === "Tender");
  assert.ok(tender.children.some((item) => item.workspace === "AI Understanding Review"));
  assert.deepEqual(projectNavigationSelection("AI Understanding Review"), { parent: "Tender", child: "AI Understanding Review" });
  const url = buildProjectLocation("project-a", "AI Understanding Review");
  assert.deepEqual(parseProjectLocation(url).workspace, "AI Understanding Review");
});

test("workspace preserves URL filter, selected detail, refresh and Back/Forward state", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/AiUnderstandingReviewWorkspace.tsx", import.meta.url), "utf8");
  for (const key of ["reviewStatus", "understandingFilter", "q", "reviewItem"]) assert.match(ui, new RegExp(key));
  assert.match(ui, /popstate/); assert.match(ui, /pushState/); assert.match(ui, /replaceState/);
  for (const filter of ["Awaiting review", "Approved", "Rejected", "Failed", "Missing essential classification", "Missing matching attributes", "Governed Fire Alarm", "Exploratory systems"]) assert.match(ui.toLowerCase(), new RegExp(filter.toLowerCase()));
});

test("stale Cat6A selection resolves to visible Addressable Flasher and cannot remain actionable", () => {
  const cat6a = queue(key("c"), "27.01.02");
  const flasher = queue(key("f"), "27.06.10");
  const selected = resolveUnderstandingReviewSelection([flasher], cat6a.reviewKey);
  assert.equal(selected, flasher.reviewKey);
  assert.equal(understandingReviewIdentitiesMatch(selected, flasher, detail(cat6a.reviewKey)), false);
  assert.equal(understandingReviewIdentitiesMatch(selected, flasher, detail(flasher.reviewKey)), true);
});

test("selection resolver handles stale URLs, zero results and deterministic restoration", () => {
  const first = queue(key("a"), "A"); const second = queue(key("b"), "B");
  assert.equal(resolveUnderstandingReviewSelection([first, second], key("z")), first.reviewKey);
  assert.equal(resolveUnderstandingReviewSelection([first, second], second.reviewKey), second.reviewKey);
  assert.equal(resolveUnderstandingReviewSelection([], second.reviewKey), "");
});

test("rapid changes and delayed detail responses cannot replace the current target", () => {
  const oldItem = queue(key("a"), "27.01.02"); const currentItem = queue(key("b"), "27.06.10");
  assert.equal(shouldAcceptUnderstandingReviewDetail(oldItem.reviewKey, currentItem.reviewKey, currentItem, detail(oldItem.reviewKey)), false);
  assert.equal(shouldAcceptUnderstandingReviewDetail(currentItem.reviewKey, currentItem.reviewKey, currentItem, detail(currentItem.reviewKey)), true);
  assert.equal(shouldAcceptUnderstandingReviewDetail(currentItem.reviewKey, currentItem.reviewKey, currentItem, { ...detail(currentItem.reviewKey), authoritativeEvidence: { reviewKey: oldItem.reviewKey } }), false);
});

test("workspace fails closed on identity mismatch and uses server-issued mutation authority", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/AiUnderstandingReviewWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ui, /Selection changed — reload the current item/);
  assert.match(ui, /if \(!detail \|\| submitting \|\| !identitiesAligned\)/);
  assert.match(ui, /selectionAuthority: mutationTarget\.selectionAuthority/);
  assert.match(ui, /detailRequest\.current/);
  assert.match(ui, /Equipment type/);
  assert.match(ui, /Product family/);
});

test("workspace separates extraction and AI review and exposes no bulk action", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/AiUnderstandingReviewWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ui, /Two independent reviews/); assert.match(ui, /Extraction review/); assert.match(ui, /AI understanding/);
  assert.doesNotMatch(ui, /Approve all|Bulk approve/i);
  for (const action of ["Approve interpretation", "Edit and approve", "Reject interpretation", "Return to review"]) assert.match(ui, new RegExp(action, "i"));
});

test("workspace renders only server-authorized actions and human field labels", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/AiUnderstandingReviewWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ui, /detail\.allowedActions\.includes\(operation\)/);
  assert.match(ui, /approvalDenialMessage/);
  assert.match(ui, /replace\(\/\^attributes\\\.\//);
  assert.match(ui, /AI attempted/);
  assert.doesNotMatch(ui, /<span key=\{value\}>\{value\}<\/span>/);
  assert.match(ui, /detail\.allowedActions\.includes\("RETURN_TO_REVIEW"\)/);
  for (const heading of ["Classification blockers", "Later project evidence needed", "Technical matching blockers", "Informational missing", "Discovery readiness", "Technical match readiness"]) assert.match(ui, new RegExp(heading));
  assert.match(ui, /matching fields needed later/);
  assert.doesNotMatch(ui, />Blocking missing</);
});

test("Addressable Flasher proposal is not presented as a missing canonical review", async () => {
  const [ui, api, resolver] = await Promise.all([
    readFile(new URL("../app/components/workspaces/AiUnderstandingReviewWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/estimator-understanding-review-api.mjs", import.meta.url), "utf8"),
    readFile(new URL("../worker/effective-understanding-interpretation.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /AI proposed classification/);
  assert.match(ui, /Engineer-reviewed canonical classification/);
  assert.match(ui, /No engineer-reviewed canonical version yet/);
  assert.match(ui, /value\.aiProposal/);
  assert.match(ui, /canonicalReview\?\.interpretation \|\| value\.aiProposal/);
  assert.match(ui, /Unsaved review draft — no review version is created until submission/);
  assert.match(api, /classification: proposalClassification/);
  assert.match(resolver, /acceptedCandidate: Boolean\(candidate\)/);
  assert.ok(api.indexOf("if (request.method === \"GET\")") < api.indexOf("const validated = validateUnderstandingReviewCommand"), "detail refresh must remain read-only");
});

test("Product Selection reports approved understanding as discovery-only readiness", async () => {
  const matching = await readFile(new URL("../app/components/workspaces/MatchingWorkspace.tsx", import.meta.url), "utf8");
  assert.match(matching, /understanding approved — ready for product discovery/);
  assert.match(matching, /Review AI understanding/);
  assert.doesNotMatch(matching, /understanding approved — product approved/i);
});
