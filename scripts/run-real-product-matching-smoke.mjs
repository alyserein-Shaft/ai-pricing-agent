import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.PHASE3_SMOKE_BASE_URL || "http://127.0.0.1:5173";
const d1Directory = join(process.cwd(), ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const database = process.env.PHASE3_SMOKE_DB || readdirSync(d1Directory).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite").map((name) => join(d1Directory, name))[0];
assert.ok(database, "Local D1 database was not found.");
const sql = (statement) => execFileSync("sqlite3", [database, statement], { encoding: "utf8" }).trim();
const scalar = (statement) => Number(sql(statement) || 0);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const requestJson = async (path, options) => { const response = await fetch(`${baseUrl}${path}`, options); const body = await response.json(); assert.ok(response.ok, `${path} failed (${response.status}): ${JSON.stringify(body)}`); return body; };

const row = JSON.parse(sql(`SELECT json_object('id',id,'projectId',project_id,'description',description,'source',source_location) FROM boq_items WHERE description='Smoke detectors (above ceiling)' AND row_type IN ('Item','BOQ Item') ORDER BY created_at LIMIT 1;`));
assert.equal(row.description, "Smoke detectors (above ceiling)");
assert.match(String(row.source), /MECH RFQ/);
const before = {
  runs: scalar(`SELECT count(*) FROM product_match_runs WHERE boq_item_id=${quote(row.id)};`),
  products: scalar("SELECT count(*) FROM library_products;"), prices: scalar("SELECT count(*) FROM price_records;"),
  safety: scalar("SELECT count(*) FROM safety_decisions;"), approvals: scalar("SELECT count(*) FROM safety_approval_requests;"), selections: scalar("SELECT count(*) FROM product_match_reviews WHERE action IN ('Selected','Confirmed','Approved Product Match');"),
};

const executed = await requestJson(`/api/boq-items/${encodeURIComponent(row.id)}/estimator-product-matching/retry`, { method: "POST" });
assert.ok(executed.matchRunId);
assert.ok(executed.result?.candidates?.length > 0, "Deterministic retrieval returned no candidates.");
assert.equal(executed.result.aiRanking?.status, "COMPLETED", JSON.stringify(executed.result.aiRanking?.error));
const shortlistIds = executed.result.candidates.map((candidate) => candidate.product.id);
const validatedIds = executed.result.aiRanking.validatedResponse.candidates.map((candidate) => candidate.candidateId);
assert.deepEqual(new Set(validatedIds), new Set(shortlistIds), "AI response did not reference exactly the supplied shortlist.");

const canonical = JSON.parse(sql(`SELECT json_group_array(json_object('id',p.id,'partNumber',p.part_number,'approved',p.approved_for_discovery,'reviewStatus',p.review_status)) FROM canonical_library_products p WHERE p.requested_product_id=p.id AND p.id IN (${shortlistIds.map(quote).join(",")});`));
assert.equal(canonical.length, shortlistIds.length);
assert.ok(canonical.every((entry) => entry.approved === 1 && entry.reviewStatus === "Reviewed"));
const expectedSmokeParts = new Set(["2151","2151-CH","2151T","2351/EC","2351TEM"]);
assert.ok(canonical.some((entry) => expectedSmokeParts.has(entry.partNumber)), "Approved smoke-detector coverage was absent from the shortlist.");

const matching = await requestJson(`/api/projects/${encodeURIComponent(row.projectId)}/estimator-product-matching`);
const persisted = matching.items.find((item) => item.boqItemId === row.id);
assert.equal(persisted.matchRunId, executed.matchRunId);
assert.ok(persisted.candidates.length > 0, "Estimator matching GET returned no persisted candidates.");
const candidateDetail = await requestJson(`/api/boq-items/${encodeURIComponent(row.id)}/matching/candidates`);
assert.equal(candidateDetail.candidates.length, shortlistIds.length);
assert.ok(candidateDetail.candidates.every((candidate) => candidate.review_status === "Needs Review"));
const readiness = await requestJson(`/api/projects/${encodeURIComponent(row.projectId)}/estimator-readiness`);
const readinessItem = readiness.items.find((item) => item.boqItemId === row.id);
assert.notEqual(readinessItem.status, "READY", "AI ranking promoted the item without engineer confirmation.");

const after = {
  runs: scalar(`SELECT count(*) FROM product_match_runs WHERE boq_item_id=${quote(row.id)};`),
  products: scalar("SELECT count(*) FROM library_products;"), prices: scalar("SELECT count(*) FROM price_records;"),
  safety: scalar("SELECT count(*) FROM safety_decisions;"), approvals: scalar("SELECT count(*) FROM safety_approval_requests;"), selections: scalar("SELECT count(*) FROM product_match_reviews WHERE action IN ('Selected','Confirmed','Approved Product Match');"),
};
assert.equal(after.runs, before.runs + 1);
for (const authority of ["products","prices","safety","approvals","selections"]) assert.equal(after[authority], before[authority], `${authority} authority changed during smoke test.`);

console.log(JSON.stringify({
  boqItemId: row.id, description: row.description, matchRunId: executed.matchRunId,
  deterministicCandidateCount: shortlistIds.length,
  shortlist: canonical.map((entry) => ({ canonicalProductId: entry.id, partNumber: entry.partNumber })),
  aiProvider: executed.result.aiRanking.metadata.provider, aiModel: executed.result.aiRanking.metadata.model,
  aiRankingStatus: executed.result.aiRanking.status, persistedCandidateCount: candidateDetail.candidates.length,
  estimatorMatchingState: persisted.summary?.matchingState || executed.result.matchingState,
  estimatorReadinessState: readinessItem.status,
  productSelectionsCreated: after.selections - before.selections,
  priceRecordsCreated: after.prices - before.prices,
  safetyTechnicalApprovalsCreated: (after.safety - before.safety) + (after.approvals - before.approvals),
}, null, 2));
console.log("SUCCESS: REAL PHASE 3 PRODUCT MATCHING PASSED END TO END");
