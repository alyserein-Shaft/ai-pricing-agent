// READ-ONLY verification: is the governed system auto-approval actually visible
// to the requirement-profile authority (currentApprovedUnderstandingFacts)?
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { currentApprovedUnderstandingFacts } from "../worker/estimator-understanding-review-api.mjs";

const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const P = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

const raw = new DatabaseSync(DB, { readOnly: true });
const db = {
  prepare(sql) {
    let v = [];
    const s = raw.prepare(sql);
    const st = {
      bind(...x) {
        v = x;
        return st;
      },
      first: async () => s.get(...v) ?? null,
      all: async () => ({ results: s.all(...v) }),
      run: async () => {
        throw new Error("READ-ONLY");
      },
    };
    return st;
  },
  batch: async () => {
    throw new Error("READ-ONLY");
  },
};

const ids = readFileSync("/tmp/eligible9.txt", "utf8").trim().split("\n");
console.log("=== is the system approval visible to the profile authority? ===");
for (const id of ids) {
  const facts = await currentApprovedUnderstandingFacts(db, P, id);
  const d = raw.prepare("SELECT description FROM boq_items WHERE id=?").get(id);
  const prof = raw
    .prepare(
      "SELECT readiness_status, version_number FROM requirement_profile_versions WHERE project_id=? AND boq_item_id=? AND superseded_at IS NULL",
    )
    .get(P, id);
  console.log(
    `  ${facts ? "VISIBLE" : "null   "}  ${d.description.slice(0, 36).padEnd(36)}  fam=${String(
      facts?.productFamily?.value ?? "-",
    ).padEnd(26)} profile=${prof.readiness_status} v${prof.version_number}`,
  );
}
