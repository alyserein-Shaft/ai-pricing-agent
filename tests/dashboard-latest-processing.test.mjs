import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardSource = await readFile(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
const workflowSource = await readFile(new URL("../app/domain/dashboard-workflow-engine.mjs", import.meta.url), "utf8");

test("dashboard processing metrics count only the latest run per version and stage", () => {
  const latestRunGuard = /NOT EXISTS \(SELECT 1 FROM document_processing_runs newer WHERE newer\.document_version_id=r\.document_version_id AND newer\.stage=r\.stage/;
  assert.equal((dashboardSource.match(new RegExp(latestRunGuard.source, "g")) || []).length, 2);
  assert.match(dashboardSource, /newer\.created_at>r\.created_at/);
  assert.match(dashboardSource, /newer\.created_at=r\.created_at AND newer\.id>r\.id/);
  assert.equal((dashboardSource.match(/r\.stage IN \('Intake','Classification'\)/g) || []).length, 2);
});

test("failure action does not claim to reprocess until the user selects Retry", () => {
  assert.match(workflowSource, /Review \$\{facts\.failedJobs\} failed document job/);
  assert.match(workflowSource, /Retry is available on each failed document after reviewing its error/);
  assert.doesNotMatch(workflowSource, /`Reprocess \$\{facts\.failedJobs\} failed document job/);
});
