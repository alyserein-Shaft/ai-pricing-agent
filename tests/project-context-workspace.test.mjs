import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(
  new URL(
    "../app/components/workspaces/ProjectContextWorkspace.tsx",
    import.meta.url,
  ),
  "utf8",
);
const page = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);

test("Documents renders only a compact Project Context summary", () => {
  assert.match(
    page,
    /<ProjectContextWorkspace\s+projectId=\{projectId\}\s+compact/,
  );
  assert.match(page, /onReview=\{\(\) => navigate\("Project Context"\)\}/);
  assert.match(workspace, /if \(compact\)/);
  assert.match(workspace, /Review project context/);
  assert.match(workspace, /Extracted facts/);
  assert.match(workspace, /Needs Review/);
  assert.match(workspace, /Reviewed/);
  assert.match(workspace, /Interpretation review/);
  assert.match(workspace, /Missing context/);
  assert.match(workspace, /extraction\.original_filename/);
  assert.match(workspace, /extraction\.version_number/);
});

test("dedicated Project Context workspace contains the complete review experience", () => {
  assert.match(page, /activeModule === "Project Context"/);
  assert.match(page, /<ProjectContextWorkspace projectId=\{projectId\} \/>/);
  assert.match(workspace, /reviewSections\.map/);
  assert.match(
    workspace,
    /These facts are separate from BOQ items/,
  );
  assert.match(
    workspace,
    /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/project-context/,
  );
});

test("Project Context view retains review status and provenance", () => {
  assert.match(workspace, /fact\.review_status/);
  assert.match(workspace, /fact\.source_sheet/);
  assert.match(workspace, /fact\.source_cell/);
  assert.match(workspace, /fact\.source_row/);
  assert.match(workspace, /fact\.confidence/);
});

test("ambiguous extraction remains visibly review-only without claiming AI ran", () => {
  assert.match(
    workspace,
    /The extracted value is ambiguous and needs human review/,
  );
  assert.match(workspace, /Extraction confidence measures how reliably the source was read/);
  assert.equal((workspace.match(/Extraction confidence measures how reliably the source was read/g) || []).length, 1);
  assert.match(workspace, /not factual, technical, or commercial approval/);
  assert.doesNotMatch(workspace, />AI interpretation</);
  assert.doesNotMatch(workspace, /Requires AI interpretation and human confirmation/);
  assert.match(workspace, /Mandatory review reason/);
  assert.match(workspace, /x-idempotency-key/);
  assert.match(
    workspace,
    /does not alter the original extraction, BOQ rows or project/,
  );
  assert.doesNotMatch(workspace, /Apply to project/);
});

test("review states are separated before facts are rendered", () => {
  assert.match(workspace, /const needsReviewFacts/);
  assert.match(workspace, /const reviewedFacts/);
  assert.match(workspace, /const rejectedFacts/);
  assert.match(workspace, /name: "Needs Review"/);
  assert.match(workspace, /name: "Reviewed"/);
  assert.match(workspace, /name: "Rejected"/);
});

test("fact review exposes governed approve edit and reject actions", () => {
  assert.match(workspace, /openReview\(fact, "approve"\)/);
  assert.match(workspace, /openReview\(fact, "edit"\)/);
  assert.match(workspace, /openReview\(fact, "reject"\)/);
  assert.match(
    workspace,
    /project-context\/facts\/\$\{encodeURIComponent/,
  );
  assert.match(workspace, /fact\.reviewed_value/);
  assert.match(workspace, /Extracted: \{fact\.extracted_value\}/);
});
