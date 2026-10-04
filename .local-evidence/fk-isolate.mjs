// FK ISOLATION — READ-ONLY w.r.t. production. Works on a COPY of the live D1.
// Executes the requirement-profile save batch statement-by-statement (instead of
// atomically) so the exact statement violating a foreign key is identified.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync } from "node:fs";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";

const LIVE =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const COPY = "/private/var/folders/vn/h7zfhtk92h3c0kw_d2bz_chr0000gn/T/opencode/fkprobe.sqlite";
const P = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const ITEM = process.argv[2] || "boqitem_20c8fe0b-1353-43ae-92c2-f8368aeafec6";

copyFileSync(LIVE, COPY);
const raw = new DatabaseSync(COPY);
raw.exec("PRAGMA foreign_keys=ON");

const prepared = new Map();
const db = {
  prepare(sql) {
    if (!prepared.has(sql)) prepared.set(sql, raw.prepare(sql));
    const st = prepared.get(sql);
    let bound = null;
    const self = {
      bind: (...v) => {
        bound = v;
        return self;
      },
      _sql: sql,
      _vals: () => bound,
      first: async () => st.get(...(bound ?? [])) ?? null,
      all: async () => ({ results: st.all(...(bound ?? [])) }),
      run: async () => {
        try { return st.run(...(bound ?? [])); }
        catch (err) {
          console.log("\n*** NON-BATCH STATEMENT FAILED ***");
          console.log("SQL:", String(sql).slice(0, 260));
          console.log("VALUES:", JSON.stringify(bound).slice(0, 260));
          console.log("ERROR:", err.message);
          throw err;
        }
      },
    };
    return self;
  },
  // Deliberately NON-atomic so the first FK violation is observable.
  async batch(statements) {
    for (let i = 0; i < statements.length; i += 1) {
      const s = statements[i];
      try {
        await s.run();
      } catch (err) {
        console.log(`\n*** FK / ERROR AT STATEMENT ${i} of ${statements.length} ***`);
        console.log("SQL:", String(s._sql).slice(0, 300));
        console.log("VALUES:", JSON.stringify(s._vals ? s._vals() : null).slice(0, 300));
        console.log("ERROR:", err.message);
        process.exit(0);
      }
    }
    return statements.map(() => ({ success: true }));
  },
};

try {
  // Replicate the QUEUE route exactly: it creates a document_processing_runs row
  // and passes its id as runId, which persistProfile writes into
  // requirement_profile_versions.processing_run_id (its own FK).
  // Use a REAL document_version_id from this database: document_processing_runs
  // is FK-bound to document_versions, so a made-up id fails here for reasons
  // unrelated to what this probe is testing.
  const dv = raw.prepare("SELECT b.source_document_id FROM boq_items b WHERE b.id=?").get(ITEM)?.source_document_id;
  const dvRow = raw
    .prepare("SELECT dv.id FROM document_versions dv JOIN documents d ON d.id=dv.document_id WHERE d.id=? LIMIT 1")
    .get(dv);
  if (!dvRow) throw new Error("no real document_version_id available for the probe run");
  const runId = "job_probe_" + Date.now();
  raw
    .prepare("INSERT INTO document_processing_runs (id, document_version_id, stage, status, progress, processor_version) VALUES (?, ?, 'Queued', 'Queued', 1, 'probe')")
    .run(runId, dvRow.id);
  await executeRequirementProfile({ DB: db }, { itemId: ITEM, userId: "local-development-user", runId });
  console.log("No FK violation: profile regenerated cleanly on the copy.");
} catch (err) {
  console.log("\nOUTER ERROR:", err.message);
  console.log("STACK:", String(err.stack).split("\n").slice(0,12).join("\n"));
}
