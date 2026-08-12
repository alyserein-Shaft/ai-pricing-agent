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

test("Documents workspace exposes separate Project Context review", () => {
  assert.match(
    page,
    /<ProjectContextWorkspace projectId=\{projectId\} \/>/,
  );
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

test("AI interpretation remains visibly review-only", () => {
  assert.match(
    workspace,
    /Requires AI interpretation and human confirmation/,
  );
  assert.match(workspace, /Mandatory review reason/);
  assert.match(workspace, /x-idempotency-key/);
  assert.match(
    workspace,
    /does not alter the original extraction, BOQ rows or project/,
  );
  assert.doesNotMatch(workspace, /Apply to project/);
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
