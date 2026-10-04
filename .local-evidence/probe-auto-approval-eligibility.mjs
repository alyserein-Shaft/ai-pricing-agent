// READ-ONLY eligibility probe. No DB writes. Pure function evaluation against
// the stored Golden descriptions, using the GOVERNED classifiers only.
import { DatabaseSync } from "node:sqlite";
import { classifyFireAlarmFamilyFromText, fireAlarmCategoryForFamily } from "../app/domain/fire-alarm-taxonomy.mjs";
import { hasGovernedTaxonomy, isCanonicalPair } from "../app/domain/system-knowledge-registry.mjs";

const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const P = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

const db = new DatabaseSync(DB, { readOnly: true });

const rows = db
  .prepare(
    `SELECT b.id, b.description, b.system_value, b.category, b.subcategory,
            v.readiness_status, v.id profile_id,
            i.id interp_id, i.status interp_status, i.validated_interpretation
       FROM requirement_profile_versions v
       JOIN boq_items b ON b.id = v.boq_item_id
       LEFT JOIN estimator_item_interpretations i
         ON i.boq_item_id = b.id
        AND i.version_number = (SELECT MAX(x.version_number) FROM estimator_item_interpretations x WHERE x.boq_item_id=b.id)
      WHERE v.project_id = ? AND v.superseded_at IS NULL
      ORDER BY v.readiness_status, b.description, b.id`,
  )
  .all(P);

// distinct stored descriptions -> governed deterministic classification
const descs = [...new Set(rows.map((r) => r.description))];
const det = new Map();
for (const d of descs) {
  let out = null;
  try {
    out = classifyFireAlarmFamilyFromText(d);
  } catch (e) {
    out = { error: e.message };
  }
  det.set(d, out);
}

const summary = { total: rows.length, withInterp: 0, deterministicNull: 0, candidates: [] };
const byDesc = new Map();

for (const r of rows) {
  const d = det.get(r.description);
  const hasInterp = Boolean(r.interp_id);
  if (hasInterp) summary.withInterp += 1;
  const reproducible = Boolean(d && d.family);
  if (!reproducible) summary.deterministicNull += 1;

  const entry = {
    description: r.description,
    deterministic: reproducible ? { family: d.family, category: d.category, equipmentType: d.equipmentType ?? null } : null,
    hasInterp,
    interpStatus: r.interp_status ?? null,
    aiFamily: (() => { try { return JSON.parse(r.validated_interpretation || "null")?.productFamily?.value ?? null; } catch { return null; } })(),
    aiOrigin: (() => { try { return JSON.parse(r.validated_interpretation || "null")?.productFamily?.origin ?? null; } catch { return null; } })(),
    system_value: r.system_value ?? null,
    category: r.category ?? null,
    readiness: r.readiness_status,
    count: 0,
  };
  entry.count += 1;
  const key = r.description;
  if (!byDesc.has(key)) byDesc.set(key, entry);
  else byDesc.get(key).count += 1;

  if (reproducible) {
    summary.candidates.push({
      description: r.description,
      family: d.family,
      category: d.category,
      hasInterp,
      aiFamily: entry.aiFamily,
      aiMatchesDeterministic: entry.aiFamily === d.family,
      systemOk: r.system_value === d.system ?? r.system_value === "Fire Alarm",
    });
  }
}

console.log("=== SUMMARY ===");
console.log("total current profiles :", summary.total);
console.log("with an interpretation  :", summary.withInterp);
console.log("deterministic classifier returned null (fails closed):", summary.deterministicNull);
console.log("deterministically reproducible:", summary.total - summary.deterministicNull);
console.log();
console.log("=== DISTINCT DESCRIPTIONS: governed classifier output ===");
for (const [d, e] of byDesc) {
  const det2 = det.get(d);
  console.log(
    `x${e.count}  ${det2 && det2.family ? "OK  " : "NULL"}  ${d.slice(0, 66).padEnd(66)}  ->  ${
      det2 && det2.family ? `${det2.category} / ${det2.family}` : "(classifier fails closed)"
    }`,
  );
}
console.log();
console.log("=== CANONICAL CHECK for reproducible ones ===");
for (const c of summary.candidates.slice(0, 40)) {
  const pair = isCanonicalPair("Fire Alarm", c.category, c.family);
  console.log(`  ${pair ? "CANON" : "NOT  "}  ${c.family.padEnd(34)} cat=${c.category.padEnd(22)} interp=${c.hasInterp} aiMatch=${c.aiMatchesDeterministic}`);
}
