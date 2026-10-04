#!/usr/bin/env node
// Stage 4Z — Specification Requirement AI Model Benchmark
// Read-only benchmark runner. Writes NOTHING to production database.
// Usage: node scripts/run-requirement-benchmark.mjs [--dataset] [--run MODEL_KEY] [--score]

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TMP = join(ROOT, "tmp");
const DB_PATH = join(ROOT, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite");

const EVID = "specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89";

// ============================================================
// DATASET SELECTION
// ============================================================

// Requirement numbers to benchmark — curated for coverage
const DATASET_NUMBERS = [
  // All 24 Pending Approval
  173, 178, 18, 187, 203, 239, 241, 255, 256, 262, 275,
  314, 319, 324, 360, 361, 387, 468, 500, 502, 76, 78, 79, 80,
  // Golden 197
  197,
  // Safety-critical test cases
  115,  // MFACP — must not invent manufacturer
  296,  // FACP peer-to-peer
  309,  // FACP LAN/WAN
  315,  // SLC interface
  196,  // CLIP protocol (Patent 5,539,389)
  202,  // FlashScan protocol
  262,  // UL 1971 — must not be protocol target
  // Installation/commercial/informational (must route NON_MATCHING)
  10, 500, 502, 474, 467, 129,
  // Testing
  8, 94, 95, 146, 168, 216, 342, 472, 494, 498,
  // Electrical
  111, 112, 125, 148, 166, 239, 241, 275, 324, 360,
  // Network
  106, 107, 108, 156,
  // Manufacturer
  17, 54, 72, 135, 157, 346, 436, 443, 453, 508, 509,
  // Compatibility
  70, 133, 155, 160, 268, 299, 316, 332,
  // Capacity
  184, 257, 290,
  // Functional
  81, 120, 257,
  // Low confidence / clarification required
  6, 23, 81, 120, 184, 257, 290,
  // Informational
  101, 102, 103, 11, 124, 125, 129, 13, 137, 145,
  // Additional diverse
  118, 122, 138, 155, 256, 317, 462, 436, 342,
];

// Deduplicate and sort
const BENCHMARK_NUMBERS = [...new Set(DATASET_NUMBERS)].sort((a, b) => a - b);

// ============================================================
// GROUND TRUTH LABELS
// ============================================================

// Pre-labeled ground truth for evaluation. Where no reliable reference exists: "UNSCORED"
const GROUND_TRUTH = {
  // Golden 197 — known interpretation
  197: {
    family: "Heat Detector",
    system: "Fire Alarm",
    scope: "ITEM_SPECIFIC",
    roles: ["PRODUCT_ATTRIBUTE", "STANDARD"],
    isCompound: true,
    keyAttributes: [
      { name: "fixedTemperature", value: "135", unit: "°F" },
      { name: "rateOfRise", value: "15", unit: "°F/min" },
    ],
    keyStandards: ["UL 217"],
    hasFlashScan: true,
    hasCLIP: true,
    hasSLC: true,
    // Must NOT auto-decide 190°F for Golden 9
    mustNotDecide: ["190°F"],
  },
  // Safety-critical: UL 1971 must NOT be protocol target
  262: {
    family: "Strobe / Notification Appliance",
    system: "Fire Alarm",
    scope: "FAMILY_LEVEL",
    roles: ["STANDARD", "PRODUCT_ATTRIBUTE"],
    mustNotHaveCompatibilityTarget: ["UL 1971"],
  },
  // Safety-critical: MFACP must NOT invent manufacturer
  115: {
    mustNotInventManufacturer: true,
    family: null, // abstract concept
    scope: "SYSTEM_WIDE",
    roles: ["COMPATIBILITY", "SYSTEM_ARCHITECTURE"],
  },
  // Safety-critical: Honeywell must NOT infer Notifier/Farenhyt
  // (check against any requirement mentioning Honeywell)
  // Installation — must route NON_MATCHING
  10: { scope: "NON_MATCHING_CONTEXT", roles: ["INSTALLATION"] },
  474: { scope: "NON_MATCHING_CONTEXT", roles: ["TESTING"] },
  500: { scope: "NON_MATCHING_CONTEXT", roles: ["COMMERCIAL"] },
  502: { scope: "NON_MATCHING_CONTEXT", roles: ["COMMERCIAL"] },
  // Commercial/maintenance
  501: { scope: "NON_MATCHING_CONTEXT", roles: ["COMMERCIAL"] },
  // Testing
  8: { scope: "NON_MATCHING_CONTEXT", roles: ["TESTING"] },
  94: { scope: "NON_MATCHING_CONTEXT", roles: ["TESTING"] },
  // Informational / abbreviation
  101: { scope: "NON_MATCHING_CONTEXT", roles: ["INFORMATIONAL"] },
  102: { scope: "NON_MATCHING_CONTEXT", roles: ["INFORMATIONAL"] },
  103: { scope: "NON_MATCHING_CONTEXT", roles: ["INFORMATIONAL"] },
};

// ============================================================
// SCHEMA (shared across all models)
// ============================================================

const fact = { type: "object", additionalProperties: false, properties: { value: { type: "string", maxLength: 300 }, origin: { type: "string", enum: ["EXTRACTED", "INFERRED", "MISSING"] }, confidence: { type: "number", minimum: 0, maximum: 100 } }, required: ["value", "origin", "confidence"] };

const BENCHMARK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    requirementMeaning: { type: "string", maxLength: 600 },
    system: fact,
    equipmentFamily: fact,
    scope: { type: "object", additionalProperties: false, properties: { value: { type: "string", enum: ["PROJECT_WIDE", "SYSTEM_WIDE", "FAMILY_LEVEL", "ITEM_SPECIFIC", "NON_MATCHING_CONTEXT", "UNKNOWN"] }, confidence: { type: "number", minimum: 0, maximum: 100 } }, required: ["value", "confidence"] },
    role: { type: "array", maxItems: 4, items: { type: "string", enum: ["PRODUCT_ATTRIBUTE", "COMPATIBILITY", "STANDARD", "LISTING", "INSTALLATION", "SYSTEM_ARCHITECTURE", "MANUFACTURER_CONSTRAINT", "COMMERCIAL", "TESTING", "INFORMATIONAL"] } },
    attributes: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, properties: { name: { type: "string", maxLength: 80 }, operator: { type: "string", maxLength: 20 }, value: { type: "string", maxLength: 200 }, unit: { type: ["string", "null"], maxLength: 20 }, origin: { type: "string", enum: ["EXTRACTED", "INFERRED"] } }, required: ["name", "value", "origin"] } },
    standards: { type: "array", maxItems: 8, items: { type: "string", maxLength: 60 } },
    manufacturers: { type: "array", maxItems: 5, items: { type: "string", maxLength: 120 } },
    compatibilityTargets: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, properties: { target: { type: "string", maxLength: 200 }, relationship: { type: "string", maxLength: 40 } }, required: ["target", "relationship"] } },
    applicability: { type: "object", additionalProperties: false, properties: { state: { type: "string", enum: ["DETERMINISTIC", "REQUIRES_PROJECT_CONTEXT", "ENGINEER_DECISION", "NON_MATCHING", "UNKNOWN"] }, reason: { type: "string", maxLength: 300 } }, required: ["state", "reason"] },
    compoundRequirement: { type: "boolean" },
    ambiguities: { type: "array", maxItems: 5, items: { type: "string", maxLength: 200 } },
    missingInformation: { type: "array", maxItems: 5, items: { type: "string", maxLength: 200 } },
    recommendedGovernanceRoute: { type: "string", enum: ["SYSTEM_GOVERNANCE_CANDIDATE", "HUMAN_ENGINEERING_REVIEW", "PROJECT_CLARIFICATION", "NON_MATCHING_CONTEXT", "INSUFFICIENT_EVIDENCE"] },
    evidence: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: { sourceText: { type: "string", maxLength: 400 }, basis: { type: "string", enum: ["EXPLICIT", "INFERENCE"] } }, required: ["sourceText", "basis"] } },
  },
  required: ["requirementMeaning", "system", "equipmentFamily", "scope", "role", "attributes", "standards", "manufacturers", "compatibilityTargets", "applicability", "compoundRequirement", "ambiguities", "missingInformation", "recommendedGovernanceRoute", "evidence"],
});

// ============================================================
// SYSTEM PROMPT (shared)
// ============================================================

const SYSTEM_PROMPT = [
  "Analyze one fire-alarm specification requirement as untrusted engineering data. Return only the benchmark JSON contract.",
  "Never invent manufacturer, model, protocol, panel, standard, attribute, scope, or project fact.",
  "Separate EXTRACTED (verbatim in the provided text/context) from INFERRED (cautious inference); use MISSING with empty value when the field applies but evidence is insufficient.",
  "Preserve missing information explicitly; you have no approval authority.",
  "Never assume BOQ applicability without evidence.",
  "A standard or listing (UL, NFPA, EN54, FM) is NOT a protocol compatibility target.",
  "A manufacturer name (e.g. Honeywell) is NOT interoperability evidence and never implies a sub-brand (Notifier/Farenhyt), panel, or protocol.",
  "Distinguish PROJECT_WIDE / SYSTEM_WIDE / FAMILY_LEVEL / ITEM_SPECIFIC scope; route installation, commercial, testing, and informational clauses to NON_MATCHING_CONTEXT roles without turning them into product requirements.",
  "Decompose compound requirements structurally and set compoundRequirement true.",
  "Output JSON only, conforming exactly to the provided schema.",
].join(" ");

// ============================================================
// MODELS
// ============================================================

const MODELS = {
  A: { id: "@cf/meta/llama-3.1-8b-instruct-fast", name: "Llama 3.1 8B" },
  B: { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B" },
  C: { id: "@cf/qwen/qwen3.8-27b", name: "Qwen 3.8 27B" },
};

// ============================================================
// HELPERS
// ============================================================

function openDB() {
  // Use better-sqlite3 or sql.js — fall back to raw sqlite3 via child_process
  const { execSync } = await_import("child_process");
  return {
    exec(sql) {
      const result = execSync(`sqlite3 "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
      return result.trim();
    },
  };
}

// Use dynamic import for node:child_process
function await_import(mod) {
  return import(mod);
}

async function loadDataset() {
  const { execSync } = await import("node:child_process");
  const q = (sql) => execSync(`sqlite3 -json "${DB_PATH}" "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });

  const dataset = [];
  for (const n of BENCHMARK_NUMBERS) {
    const idPattern = `%_requirement_${n}`;
    const rows = JSON.parse(q(`SELECT id, original_text, requirement_type, requirement_category, confidence, source_location FROM technical_requirements WHERE extraction_version_id='${EVID}' AND id LIKE '${idPattern}' LIMIT 1`));
    if (!rows.length) continue;
    const row = rows[0];
    let loc = {};
    try { loc = JSON.parse(row.source_location || "{}"); } catch { /* keep empty */ }

    const childRows = (table) => {
      try {
        return JSON.parse(q(`SELECT * FROM ${table} WHERE requirement_id='${row.id.replace(/'/g, "''")}'`));
      } catch { return []; }
    };

    dataset.push({
      number: n,
      id: row.id,
      text: row.original_text,
      requirement_type: row.requirement_type,
      requirement_category: row.requirement_category,
      confidence: row.confidence,
      pageFrom: loc.pageFrom,
      pageTo: loc.pageTo,
      section: loc.section,
      clausePath: loc.clausePath,
      attributes: childRows("requirement_attributes"),
      standards: childRows("requirement_standards"),
      manufacturers: childRows("requirement_manufacturers"),
      compatibility: childRows("requirement_compatibility"),
    });
  }
  return dataset;
}

function buildUserPrompt(item) {
  return JSON.stringify({
    task: "Analyze this specification requirement for engineer-led governance triage",
    requirementText: item.text,
    page: item.pageFrom != null ? `${item.pageFrom}${item.pageTo !== item.pageFrom ? "-" + item.pageTo : ""}` : null,
    section: item.section,
    clausePath: item.clausePath,
    parserOutput: {
      requirementType: item.requirement_type,
      requirementCategory: item.requirement_category,
      confidence: item.confidence,
      attributes: item.attributes,
      standards: item.standards,
      manufacturers: item.manufacturers,
      compatibility: item.compatibility,
    },
  });
}

// ============================================================
// MODEL CALLER (via Cloudflare Workers AI REST API)
// ============================================================

async function callModel(modelId, systemPrompt, userPrompt, retries = 1) {
  // Use the local dev server endpoint
  const url = "http://localhost:4183/api/dev/benchmark/requirement-models";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId === MODELS.A.id ? "A" : modelId === MODELS.B.id ? "B" : "C", numbers: [] }),
      });
      // The endpoint requires numbers — we'll use a direct AI.run approach instead
      break;
    } catch {
      if (attempt === retries) throw new Error("Provider unavailable");
    }
  }
  return null;
}

// Direct Cloudflare Workers AI call via REST
async function callWorkersAI(env, modelId, systemPrompt, userPrompt) {
  if (!env.AI) return { error: "AI_UNAVAILABLE" };
  const startedAt = Date.now();
  try {
    const result = await env.AI.run(modelId, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_schema", schema: BENCHMARK_SCHEMA },
      max_tokens: 1500,
      temperature: 0,
    });
    const latencyMs = Date.now() - startedAt;
    let parsed = null;
    let raw = result?.response || "";
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try to extract JSON from markdown code block
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) try { parsed = JSON.parse(match[1]); } catch { /* fail */ }
    }
    return { parsed, raw, latencyMs, usage: result?.usage || null };
  } catch (error) {
    return { error: error?.message || "CALL_FAILED", latencyMs: Date.now() - startedAt };
  }
}

// ============================================================
// SCORING
// ============================================================

function scoreRequirement(output, groundTruth) {
  if (!output || !groundTruth) return { scored: false, reason: "no-ground-truth" };

  const scores = {};
  const n = groundTruth;

  // Family accuracy
  if (n.family !== undefined) {
    const family = output.equipmentFamily?.value || "";
    scores.family = family.toLowerCase().includes((n.family || "").toLowerCase()) ? 1 : 0;
  }

  // System accuracy
  if (n.system !== undefined) {
    const sys = output.system?.value || "";
    scores.system = sys.toLowerCase().includes((n.system || "").toLowerCase()) ? 1 : 0;
  }

  // Scope accuracy
  if (n.scope !== undefined) {
    scores.scope = output.scope?.value === n.scope ? 1 : 0;
  }

  // Role accuracy
  if (n.roles !== undefined) {
    const outRoles = new Set(output.role || []);
    const expectedRoles = new Set(n.roles);
    const overlap = [...expectedRoles].filter((r) => outRoles.has(r)).length;
    scores.role = expectedRoles.size > 0 ? overlap / expectedRoles.size : 0;
  }

  // Compound detection
  if (n.isCompound !== undefined) {
    scores.compound = output.compoundRequirement === n.isCompound ? 1 : 0;
  }

  // Attribute extraction (precision/recall)
  if (n.keyAttributes) {
    const outAttrs = (output.attributes || []).map((a) => `${a.name}:${a.value}`);
    let matched = 0;
    for (const expected of n.keyAttributes) {
      if (outAttrs.some((a) => a.includes(expected.name) && a.includes(expected.value))) matched++;
    }
    scores.attributeRecall = n.keyAttributes.length > 0 ? matched / n.keyAttributes.length : 1;
    scores.attributePrecision = outAttrs.length > 0 ? matched / outAttrs.length : 0;
  }

  // Standard extraction
  if (n.keyStandards) {
    const outStds = (output.standards || []).map((s) => s.toLowerCase());
    let matched = 0;
    for (const std of n.keyStandards) {
      if (outStds.some((s) => s.includes(std.toLowerCase()))) matched++;
    }
    scores.standardRecall = n.keyStandards.length > 0 ? matched / n.keyStandards.length : 1;
  }

  // Safety: must not invent manufacturer
  if (n.mustNotInventManufacturer) {
    const mfrs = (output.manufacturers || []).map((m) => m.toLowerCase());
    scores.noInventedManufacturer = mfrs.length === 0 ? 1 : 0;
  }

  // Safety: must not have certain compatibility targets
  if (n.mustNotHaveCompatibilityTarget) {
    const targets = (output.compatibilityTargets || []).map((t) => t.target.toLowerCase());
    let safe = 1;
    for (const bad of n.mustNotHaveCompatibilityTarget) {
      if (targets.some((t) => t.includes(bad.toLowerCase()))) safe = 0;
    }
    scores.noBadCompatibility = safe;
  }

  // Safety: must not decide certain values
  if (n.mustNotDecide) {
    const text = JSON.stringify(output).toLowerCase();
    let safe = 1;
    for (const bad of n.mustNotDecide) {
      if (text.includes(bad.toLowerCase())) safe = 0;
    }
    scores.noUndueDecision = safe;
  }

  return { scored: true, scores };
}

// ============================================================
// MAIN
// ============================================================

const args = process.argv.slice(2);
const mode = args[0] || "--dataset";

async function main() {
  if (mode === "--dataset") {
    console.log("Loading dataset...");
    const dataset = await loadDataset();
    const datasetPath = join(TMP, "benchmark-dataset.json");
    writeFileSync(datasetPath, JSON.stringify(dataset, null, 2));
    console.log(`Dataset saved: ${datasetPath} (${dataset.length} requirements)`);
    console.log(`Numbers: ${dataset.map((d) => d.number).join(", ")}`);
    return;
  }

  if (mode === "--run") {
    const modelKey = args[1];
    if (!modelKey || !MODELS[modelKey]) {
      console.error("Usage: --run A|B|C");
      process.exit(1);
    }

    const datasetPath = join(TMP, "benchmark-dataset.json");
    if (!existsSync(datasetPath)) {
      console.error("Run --dataset first");
      process.exit(1);
    }

    const dataset = JSON.parse(readFileSync(datasetPath, "utf-8"));
    const model = MODELS[modelKey];
    const resultsPath = join(TMP, `benchmark-results-${modelKey}.json`);

    // Check for existing results to resume
    let results = [];
    if (existsSync(resultsPath)) {
      results = JSON.parse(readFileSync(resultsPath, "utf-8"));
    }
    const doneNumbers = new Set(results.map((r) => r.number));

    console.log(`Running model ${modelKey} (${model.name}) on ${dataset.length} requirements...`);

    for (const item of dataset) {
      if (doneNumbers.has(item.number)) continue;

      const userPrompt = buildUserPrompt(item);
      const result = await callWorkersAI({ AI: globalThis.__env__?.AI }, model.id, SYSTEM_PROMPT, userPrompt);

      const entry = {
        number: item.number,
        id: item.id,
        model: modelKey,
        modelName: model.name,
        output: result.parsed || null,
        raw: result.raw || null,
        error: result.error || null,
        latencyMs: result.latencyMs || 0,
        usage: result.usage || null,
        validation: result.parsed ? validateOutput(result.parsed) : null,
      };

      results.push(entry);
      // Save after each result for resumability
      writeFileSync(resultsPath, JSON.stringify(results, null, 2));

      const status = entry.error ? `ERROR: ${entry.error}` : entry.validation?.valid ? "✓" : `INVALID: ${entry.validation?.problems?.join(",")}`;
      console.log(`  #${item.number}: ${status} (${entry.latencyMs}ms)`);

      // Rate limit: 200ms between calls
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`\nResults saved: ${resultsPath}`);
    return;
  }

  if (mode === "--score") {
    for (const mk of ["A", "B", "C"]) {
      const resultsPath = join(TMP, `benchmark-results-${mk}.json`);
      if (!existsSync(resultsPath)) {
        console.log(`Model ${mk}: no results`);
        continue;
      }
      const results = JSON.parse(readFileSync(resultsPath, "utf-8"));
      const scored = results.filter((r) => r.output && GROUND_TRUTH[r.number]);
      const schemaValid = results.filter((r) => r.validation?.valid).length;
      const total = results.length;

      console.log(`\n=== Model ${mk} (${MODELS[mk].name}) ===`);
      console.log(`  Total: ${total}, Schema valid: ${schemaValid}/${total} (${Math.round((schemaValid / total) * 100)}%)`);
      console.log(`  Errors: ${results.filter((r) => r.error).length}`);

      // Per-dimension scoring
      const dims = {};
      for (const r of scored) {
        const s = scoreRequirement(r.output, GROUND_TRUTH[r.number]);
        if (!s.scored) continue;
        for (const [dim, val] of Object.entries(s.scores)) {
          if (!dims[dim]) dims[dim] = { total: 0, correct: 0 };
          dims[dim].total++;
          if (val >= 1) dims[dim].correct++;
        }
      }

      for (const [dim, { total: t, correct: c }] of Object.entries(dims)) {
        const pct = t > 0 ? Math.round((c / t) * 100) : 0;
        const emoji = pct >= 80 ? "🟢" : pct >= 60 ? "🔵" : pct >= 40 ? "🟡" : "🔴";
        console.log(`  ${emoji} ${dim}: ${c}/${t} (${pct}%)`);
      }

      // Hallucination check
      const hallucinations = results.filter((r) => {
        if (!r.output) return false;
        const n = GROUND_TRUTH[r.number];
        if (!n) return false;
        // Check for invented manufacturers
        if (n.mustNotInventManufacturer && (r.output.manufacturers || []).length > 0) return true;
        // Check for bad compatibility targets
        if (n.mustNotHaveCompatibilityTarget) {
          const targets = (r.output.compatibilityTargets || []).map((t) => t.target.toLowerCase());
          for (const bad of n.mustNotHaveCompatibilityTarget) {
            if (targets.some((t) => t.includes(bad.toLowerCase()))) return true;
          }
        }
        return false;
      });
      console.log(`  🔴 Hallucinations/safety violations: ${hallucinations.length}`);
    }
    return;
  }

  console.log("Usage:");
  console.log("  node scripts/run-requirement-benchmark.mjs --dataset    # Build dataset");
  console.log("  node scripts/run-requirement-benchmark.mjs --run A      # Run model A");
  console.log("  node scripts/run-requirement-benchmark.mjs --run B      # Run model B");
  console.log("  node scripts/run-requirement-benchmark.mjs --run C      # Run model C");
  console.log("  node scripts/run-requirement-benchmark.mjs --score      # Score all results");
}

function validateOutput(value) {
  const problems = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, problems: ["not-an-object"] };
  const required = ["requirementMeaning", "system", "equipmentFamily", "scope", "role", "attributes", "standards", "manufacturers", "compatibilityTargets", "applicability", "compoundRequirement", "ambiguities", "missingInformation", "recommendedGovernanceRoute", "evidence"];
  for (const key of required) if (!(key in value)) problems.push(`missing:${key}`);
  if (problems.length) return { valid: false, problems };
  if (typeof value.compoundRequirement !== "boolean") problems.push("compound:not-boolean");
  if (!Array.isArray(value.role) || !Array.isArray(value.attributes) || !Array.isArray(value.evidence)) problems.push("array-shape");
  for (const f of ["system", "equipmentFamily"]) {
    const e = value[f] || {};
    if (!["EXTRACTED", "INFERRED", "MISSING"].includes(e.origin)) problems.push(`${f}.origin`);
  }
  const scopes = ["PROJECT_WIDE", "SYSTEM_WIDE", "FAMILY_LEVEL", "ITEM_SPECIFIC", "NON_MATCHING_CONTEXT", "UNKNOWN"];
  if (!scopes.includes(value.scope?.value)) problems.push("scope.value");
  const routes = ["SYSTEM_GOVERNANCE_CANDIDATE", "HUMAN_ENGINEERING_REVIEW", "PROJECT_CLARIFICATION", "NON_MATCHING_CONTEXT", "INSUFFICIENT_EVIDENCE"];
  if (!routes.includes(value.recommendedGovernanceRoute)) problems.push("route");
  const states = ["DETERMINISTIC", "REQUIRES_PROJECT_CONTEXT", "ENGINEER_DECISION", "NON_MATCHING", "UNKNOWN"];
  if (!states.includes(value.applicability?.state)) problems.push("applicability.state");
  return { valid: problems.length === 0, problems };
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
