import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const componentPath = join(
  root,
  "app/components/workspaces/KnowledgeLibraryWorkspace.tsx",
);
const component = readFileSync(componentPath, "utf8");

const pagePath = join(root, "app/page.tsx");
const page = readFileSync(pagePath, "utf8");

const navPath = join(root, "app/lib/application-navigation.mjs");
const nav = readFileSync(navPath, "utf8");

const reviewRegion = component.slice(component.indexOf("isReviewSection"));
const renderSite = page.slice(
  page.indexOf("<KnowledgeLibraryWorkspace"),
  page.indexOf("<KnowledgeLibraryWorkspace") + 1800,
);
const knowledgeChildren = nav.slice(
  nav.indexOf('"Knowledge"'),
  nav.indexOf("],", nav.indexOf('"Knowledge"')),
);

test("KN-UX-4 component types the exception review surface (queue, target, reason, decisions)", () => {
  assert.ok(
    /reviewItems: Record<string, unknown>\[\];/.test(component),
    "Props must type the review-queue dataset",
  );
  assert.ok(
    /reviewTarget: string \| null;/.test(component),
    "Props must type the selected review target",
  );
  assert.ok(/reviewReason: string;/.test(component), "Props must type the reason");
  assert.ok(
    /onReviewTarget: \(id: string \| null\) => void;/.test(component),
    "Props must type the target setter",
  );
  assert.ok(
    /onReviewReason: \(value: string\) => void;/.test(component),
    "Props must type the reason setter",
  );
  assert.ok(/onReview: \(/.test(component), "Props must type the decision submitter");
});

test("KN-UX-4 component destructures every review prop", () => {
  for (const name of [
    "reviewItems,",
    "reviewTarget,",
    "reviewReason,",
    "onReviewTarget,",
    "onReviewReason,",
    "onReview,",
  ]) {
    assert.ok(
      component.split("\n").some((line) => new RegExp(`^\\s*${name.replace(",", ",?")}$`).test(line)),
      `destructure must include ${name}`,
    );
  }
});

test("KN-UX-4 review is a distinct section that keys the empty-state off the queue", () => {
  assert.ok(
    /const isReviewSection = section === "Review";/.test(component),
    "review mode must be derived from the section",
  );
  assert.ok(
    /: isReviewSection\s*\? visibleReviewItems\.length/m.test(component),
    "empty-state count must key off the review dataset in review mode",
  );
  assert.ok(
    /\{isReviewSection && !viewingIdentities\s*\? visibleReviewItems\.map\(/m.test(component),
    "review mode must render the review queue (kind-filtered; identities view renders the separate identity payload)",
  );
});

test("KN-UX-4 queue items expose kind, state, confidence, and source context", () => {
  assert.ok(
    /item_kind === "Fact" \? "FACT" : "FILE"/.test(reviewRegion),
    "item rows must distinguish Fact versus File items",
  );
  assert.ok(
    /review-blocked/.test(reviewRegion),
    "item rows must surface the pending review state",
  );
  assert.ok(
    /Confidence: \$\{String\(item\.confidence\)/.test(reviewRegion),
    "item rows must expose confidence where available",
  );
  assert.ok(
    /source_file \|\|/.test(reviewRegion) && /processing_status \|\|/.test(reviewRegion),
    "item rows must expose the source / processing context",
  );
  assert.ok(
    /String\(item\.title \|\| "Unnamed review item"\)/.test(reviewRegion),
    "item rows must render the item title",
  );
});

test("KN-UX-4 decisions are governed: reason-gated Confirm/Reject, never a generic Approve", () => {
  assert.ok(
    />\s*Confirm\s*<\/button>/.test(reviewRegion),
    "a Confirm decision control must exist",
  );
  assert.ok(
    />\s*Reject\s*<\/button>/.test(reviewRegion),
    "a Reject decision control must exist",
  );
  assert.equal(
    (reviewRegion.match(/disabled=\{reviewReason\.trim\(\)\.length < 5\}/g) || [])
      .length,
    2,
    "both decisions must be gated on a substantive reason",
  );
  assert.ok(
    /onReview\(item, "confirm"\)/.test(reviewRegion) &&
      /onReview\(item, "reject"\)/.test(reviewRegion),
    "both governed decision actions must be wired",
  );
  assert.ok(
    /aria-label="Review decision reason"/.test(reviewRegion),
    "a labeled reason input must exist",
  );
  assert.doesNotMatch(
    reviewRegion,
    /Approve/,
    "the exception review surface must never offer a generic Approve",
  );
});

test("KN-UX-4 page passes the queue state and governed handler to the workspace", () => {
  assert.ok(
    /reviewItems=\{\s*knowledgeReviewItems/m.test(renderSite),
    "page must pass the loaded review queue",
  );
  assert.ok(
    /reviewTarget=\{knowledgeReviewTarget\}/.test(renderSite),
    "page must pass the review target",
  );
  assert.ok(
    /reviewReason=\{knowledgeReviewReason\}/.test(renderSite),
    "page must pass the review reason",
  );
  assert.ok(
    /onReviewTarget=\{setKnowledgeReviewTarget\}/.test(renderSite),
    "page must pass the target setter",
  );
  assert.ok(
    /onReviewReason=\{setKnowledgeReviewReason\}/.test(renderSite),
    "page must pass the reason setter",
  );
  assert.ok(
    /onReview=\{\s*\(item, action\) => void reviewKnowledgeItem\(item, action\)\}/.test(
      renderSite,
    ),
    "page must pass the governed review decision handler",
  );
});

test("KN-UX-4 Review is a reachable Knowledge navigation child", () => {
  assert.ok(
    knowledgeChildren.includes("Review"),
    "nav must include the Knowledge Review child so the queue is discoverable",
  );
  assert.ok(
    /id: "Knowledge Review"[\s\S]*section: "Review"/.test(knowledgeChildren),
    "the Review child must route to the Review section",
  );
});

test("KN-UX-4 preserves the KN-UX-3 workspace invariants (regression guard)", () => {
  assert.ok(
    /productIdentities: Record<string, unknown>\[\];/.test(component),
    "KN-UX-3: type must still carry productIdentities",
  );
  const renderTail = component.slice(component.indexOf('className="library-results"'));
  assert.ok(
    /!loading && activeCount === 0/.test(renderTail),
    "KN-UX-3: empty predicate must still key off the active dataset count",
  );
  assert.ok(
    /files\.map|activeCount/.test(renderTail),
    "KN-UX-3: file-backed sections must still map the files dataset",
  );
  const knUx3Window = page.slice(
    page.indexOf("<KnowledgeLibraryWorkspace"),
    page.indexOf("<KnowledgeLibraryWorkspace") + 1200,
  );
  assert.ok(
    /productIdentities=\{/.test(knUx3Window),
    "KN-UX-3: the page must still pass productIdentities within the render window",
  );
});