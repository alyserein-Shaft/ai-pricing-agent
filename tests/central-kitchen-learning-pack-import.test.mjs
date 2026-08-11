import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const workbook =
  "outputs/central-kitchen-approved/Central_Kitchen_Structured_Cabling_Learning_Pack_v1.xlsx";

test("Central Kitchen learning pack passes governed dry-run import", () => {
  assert.equal(
    existsSync(workbook),
    true,
    `Approved workbook missing: ${workbook}`,
  );

  const result = spawnSync(
    process.execPath,
    [
      "scripts/import-central-kitchen-learning-pack.mjs",
      "--file",
      workbook,
      "--project-id",
      "central-kitchen-makkah",
      "--organization-id",
      "local-org",
      "--actor-user-id",
      "test-user",
      "--dry-run",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(
    result.status,
    0,
    `Import failed:\n${result.stdout}\n${result.stderr}`,
  );

  const output = `${result.stdout}\n${result.stderr}`;

  assert.match(output, /Workbook valid: YES/);
  assert.match(output, /Candidate Rules: 12/);
  assert.match(output, /Quantity Relationships: 12/);
  assert.match(output, /RFQ-to-Final Changes: 12/);
  assert.match(output, /Passive Components: 12/);
  assert.match(output, /Active Huawei Additions: 10/);
  assert.match(output, /Rack and Services: 5/);
  assert.match(output, /Evidence Sources: 10/);
  assert.match(output, /Ground Truth Records: 51/);
  assert.match(output, /Knowledge Items: 28/);
  assert.match(output, /Exceptions: 8/);
  assert.match(output, /Review Queue: 8/);
  assert.match(output, /Similarity Signals: 6/);

  assert.match(output, /Review State: Needs Review/);
  assert.match(output, /Publication State: Not Published/);
  assert.match(output, /Benchmark State: Learning/);
  assert.match(output, /Reusable Items: 0/);
  assert.match(output, /Historical Only: true/);
  assert.match(output, /Automatic Approval: false/);
  assert.match(output, /Database Writes: 0/);
  assert.match(
    output,
    /DRY RUN COMPLETED — no database changes were made/,
  );
});
