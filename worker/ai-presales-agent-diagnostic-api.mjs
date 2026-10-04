// Phase A1 (2026-09-01): dev-only, real-model smoke harness for the AI
// Pre-Sales Agent loop. Mirrors worker/boq-ai-diagnostic-api.mjs's exact
// safety pattern: localhost-only, explicit env-flag gated, fixed/synthetic
// input. This is NOT a production route -- no migration, no session
// persistence, no UI. Its only purpose is to gather real evidence about
// @cf/meta/llama-3.1-8b-instruct-fast driving the bounded, entity-scope-
// grounded tool loop.
//
// Slice 2 seeds a FIXED, realistic set of BOQ items -- including a genuine
// duplicate item_number, to exercise the real ambiguity path -- for
// get_boq_item_context. node:sqlite's DatabaseSync is not constructible
// inside this Vite/Wrangler workerd runtime ("Illegal constructor" even
// under nodejs_compat, unlike plain Node where tests/ai-presales-agent-
// tools.test.mjs already proves the real SQL resolver against 8 real,
// SQL-backed scenarios). Rather than seed a real D1 database here -- which
// would risk touching the same local D1 file real project work (including
// Stanly Egypt) may use -- this harness calls the SAME PURE resolver/shaper
// functions (resolveItemReference, shapeBoqItemContext) the real SQL-backed
// resolveBoqItemContext already uses, over a fixed in-memory array. The
// SQL-integration layer itself is exhaustively covered separately by
// tests/ai-presales-agent-tools.test.mjs; this route's unique job is
// proving the LIVE MODEL loop against realistic tool output shapes.
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { shapeProjectStatus, runAgentTurn, AGENT_DECISION_SCHEMA, ANSWER_EXPLANATION_SCHEMA, resolveItemReference, shapeBoqItemContext, shapeRequirementProfile, shapeProductMatchingStatus } from "../app/domain/ai-presales-agent-engine.mjs";
import { boqUnderstandingProviderReadiness, createConfiguredCloudflareStructuredProvider } from "./boq-understanding-provider.mjs";

const PATH = "/api/dev/ai-presales-agent/native-smoke";
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const localHost = (hostname) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

// A fixed, realistic mid-project scenario with genuine blockers across
// several stages (used by get_project_status).
const FIXED_PROJECT_ID = "diagnostic-fixed-project";
const FIXED_WORKFLOW = derivePresalesWorkflow({
  project: { id: FIXED_PROJECT_ID, name: "Diagnostic Fixture Project", organizationId: "org_diagnostic", systemDomain: "Fire Alarm" },
  facts: {
    documents: 4, classified: 4, processing: 0, failedJobs: 0,
    boqItems: 12, extractionReview: 0,
    specificationExtractions: 1,
    requirementProfiles: 12, requirementReview: 2,
    matchedItems: 8, technicalPending: 3, technicalApproved: 5,
    openSafetyBlocks: 1,
    pricedItems: 5, missingPrices: 3,
    commercialPending: 0, commercialApproved: 0,
    finalReviewApproved: 0, finalReviewPending: 0,
    openClarifications: 1, blockingClarifications: 0,
    exportsCompleted: 0, exportFailures: 0,
    quotationDrafts: 0, quotationApproved: 0, quotationIssued: 0,
  },
});

// A fixed, in-memory set of current BOQ items for get_boq_item_context --
// includes item 28.19 (the exact item Slice 1's real-model failure named,
// qty 24 matching that scenario exactly), a distinct second item (28.20,
// for cross-item tests), and a deliberate duplicate item_number (9.1 x2)
// to exercise the real ambiguity path. Row shape matches the real boq_items
// columns resolveItemReference/shapeBoqItemContext read.
const FIXED_ITEMS = [
  { id: "boqitem_2819", item_number: "28.19", sequence: 1, description: "Ceiling Mounted Dome Camera", numeric_quantity: 24, original_quantity: 24, system_value: "CCTV", subcategory: "Dome Camera", category: null, review_status: "Approved" },
  { id: "boqitem_2820", item_number: "28.20", sequence: 2, description: "Wall Mounted Bullet Camera", numeric_quantity: 6, original_quantity: 6, system_value: "CCTV", subcategory: "Bullet Camera", category: null, review_status: "Approved" },
  { id: "boqitem_2821", item_number: "28.21", sequence: 5, description: "PTZ Camera", numeric_quantity: 2, original_quantity: 2, system_value: "CCTV", subcategory: "PTZ Camera", category: null, review_status: "Approved" },
  { id: "boqitem_2822", item_number: "28.22", sequence: 6, description: "Fixed Dome Camera", numeric_quantity: 3, original_quantity: 3, system_value: "CCTV", subcategory: "Fixed Dome Camera", category: null, review_status: "Approved" },
  // Slice 4: five new items, one per matching-fixture state Section 17's
  // live test matrix needs. Each has a CLEAN requirement profile (never
  // stale/blocked -- Scenarios A-C/F isolate the MATCHING state alone; the
  // requirement layer is proven separately by 28.19/28.21/28.22 already).
  { id: "boqitem_2823", item_number: "28.23", sequence: 7, description: "Addressable Smoke Detector", numeric_quantity: 40, original_quantity: 40, system_value: "Fire Alarm", subcategory: "Smoke Detector", category: null, review_status: "Approved" },
  { id: "boqitem_2824", item_number: "28.24", sequence: 8, description: "Addressable Heat Detector", numeric_quantity: 15, original_quantity: 15, system_value: "Fire Alarm", subcategory: "Heat Detector", category: null, review_status: "Approved" },
  { id: "boqitem_2825", item_number: "28.25", sequence: 9, description: "Manual Call Point", numeric_quantity: 10, original_quantity: 10, system_value: "Fire Alarm", subcategory: "Manual Call Point", category: null, review_status: "Approved" },
  { id: "boqitem_2826", item_number: "28.26", sequence: 10, description: "Sounder Beacon", numeric_quantity: 8, original_quantity: 8, system_value: "Fire Alarm", subcategory: "Sounder Beacon", category: null, review_status: "Approved" },
  { id: "boqitem_2827", item_number: "28.27", sequence: 11, description: "Interface Module", numeric_quantity: 5, original_quantity: 5, system_value: "Fire Alarm", subcategory: "Interface Module", category: null, review_status: "Approved" },
  { id: "boqitem_91a", item_number: "9.1", sequence: 3, description: "Manual Call Point (first 9.1 row)", numeric_quantity: 8, original_quantity: 8, system_value: "Fire Alarm", subcategory: "Manual Call Point", category: null, review_status: "Approved" },
  { id: "boqitem_91b", item_number: "9.1", sequence: 4, description: "Manual Call Point (duplicate 9.1 row from a split)", numeric_quantity: 4, original_quantity: 4, system_value: "Fire Alarm", subcategory: "Manual Call Point", category: null, review_status: "Approved" },
];

// Slice 3: a fixed, in-memory requirement-profile fixture per item id,
// covering every state Section 12's live test matrix needs -- reusing the
// SAME pure shapeRequirementProfile the real SQL-backed resolveRequirement
// Profile calls, over hand-built "parsedProfile" shapes matching EXACTLY
// what buildTechnicalRequirementProfile really produces (readiness.status/
// blockingReasons, missingInformation, conflicts -- see
// app/domain/technical-requirement-engine.mjs). No fixture recomputes
// requirements; each just supplies the already-computed engine output
// shapeRequirementProfile then reshapes, identically to production.
//
// 28.19: a REAL blocker (missing Panel Compatibility + a real BOQ-vs-
//   Drawing Voltage conflict) -- Scenario A / D.
// 28.20: a CLEAN, complete profile (Ready for Matching, no gaps) --
//   Scenario B.
// 28.21: no profile generated at all -- Scenario F.
// 28.22: a profile whose Drawing-sourced requirement is stale -- Scenario E.
const FIXED_REQUIREMENT_PROFILES = {
  boqitem_2819: {
    row: { id: "reqprofile_2819", readiness_status: "Missing Critical Information", status: "Needs Review" },
    parsedProfile: {
      boqItem: { system: "CCTV", productFamily: "Dome Camera" },
      consolidatedRequirements: [
        { key: "Protocol", normalizedRequirement: "Protocol", attributes: [{ name: "Protocol", normalizedValue: "ONVIF" }], sources: [{ sourceType: "Specification", source: {} }] },
        { key: "Voltage", normalizedRequirement: "Voltage", attributes: [{ name: "Voltage", normalizedValue: "24V" }, { name: "Voltage", normalizedValue: "12V" }], sources: [{ sourceType: "BOQ", source: {} }, { sourceType: "Drawing", source: {} }] },
        { key: "Panel Compatibility", normalizedRequirement: "Panel Compatibility", attributes: [], sources: [{ sourceType: "Specification", source: {} }] },
      ],
      missingInformation: [{ field: "Panel Compatibility", whyNeeded: "Panel Compatibility is required to define a safe CCTV product search boundary." }],
      conflicts: [{ attribute: "Voltage", type: "Required Value Conflict", values: [{ value: "24V", unit: "V", source: { sourceType: "BOQ" } }, { value: "12V", unit: "V", source: { sourceType: "Drawing" } }], technicalImpact: "Voltage cannot be used safely for product matching until the governing source is confirmed.", blocking: true }],
      readiness: { status: "Missing Critical Information", blockingReasons: ["Panel Compatibility is required to define a safe CCTV product search boundary.", "Voltage cannot be used safely for product matching until the governing source is confirmed."] },
    },
    stale: false,
  },
  boqitem_2820: {
    row: { id: "reqprofile_2820", readiness_status: "Ready for Matching", status: "Completed" },
    parsedProfile: {
      boqItem: { system: "CCTV", productFamily: "Bullet Camera" },
      consolidatedRequirements: [
        { key: "Protocol", normalizedRequirement: "Protocol", attributes: [{ name: "Protocol", normalizedValue: "ONVIF" }], sources: [{ sourceType: "Specification", source: {} }] },
        { key: "Voltage", normalizedRequirement: "Voltage", attributes: [{ name: "Voltage", normalizedValue: "24V" }], sources: [{ sourceType: "BOQ", source: {} }] },
        { key: "IP Rating", normalizedRequirement: "IP Rating", attributes: [{ name: "IP Rating", normalizedValue: "IP66" }], sources: [{ sourceType: "Specification", source: {} }] },
      ],
      missingInformation: [],
      conflicts: [],
      readiness: { status: "Ready for Matching", blockingReasons: [] },
    },
    stale: false,
  },
  boqitem_2822: {
    row: { id: "reqprofile_2822", readiness_status: "Ready for Matching", status: "Completed" },
    parsedProfile: {
      boqItem: { system: "CCTV", productFamily: "Fixed Dome Camera" },
      consolidatedRequirements: [
        { key: "Family", normalizedRequirement: "Family", attributes: [{ name: "Family", normalizedValue: "Fixed Dome Camera" }], sources: [{ sourceType: "Drawing", source: { documentId: "doc_diagnostic", recognitionVersionId: "recog_stale_v1" } }] },
      ],
      missingInformation: [],
      conflicts: [],
      readiness: { status: "Ready for Matching", blockingReasons: [] },
    },
    // Diagnostic-only: the real SQL-backed staleness check
    // (computeRequirementProfileStaleness) is exhaustively proven against a
    // real drawing_symbol_recognition_versions table in
    // tests/ai-presales-agent-tools.test.mjs; this fixture hardcodes the
    // OUTCOME (stale:true) since this route has no real DB to compare a
    // "current" recognition version against.
    stale: true,
  },
};
// Slice 4: a clean, always-current requirement profile for each of the
// five new matching-fixture items -- Scenarios A-D/F isolate the MATCHING
// state alone, so the requirement layer is deliberately never the blocker
// here (that is proven separately by 28.19/28.21/28.22).
const cleanProfileFixture = (system, family) => ({
  row: { id: `reqprofile_${system}_${family}`.replace(/\s+/g, ""), readiness_status: "Ready for Matching", status: "Completed" },
  parsedProfile: {
    boqItem: { system, productFamily: family },
    consolidatedRequirements: [
      { key: "Protocol", normalizedRequirement: "Protocol", attributes: [{ name: "Protocol", normalizedValue: "Addressable" }], sources: [{ sourceType: "Specification", source: {} }] },
    ],
    missingInformation: [],
    conflicts: [],
    readiness: { status: "Ready for Matching", blockingReasons: [] },
  },
  stale: false,
});
Object.assign(FIXED_REQUIREMENT_PROFILES, {
  boqitem_2823: cleanProfileFixture("Fire Alarm", "Smoke Detector"),
  boqitem_2824: cleanProfileFixture("Fire Alarm", "Heat Detector"),
  boqitem_2825: cleanProfileFixture("Fire Alarm", "Manual Call Point"),
  boqitem_2826: cleanProfileFixture("Fire Alarm", "Sounder Beacon"),
  boqitem_2827: cleanProfileFixture("Fire Alarm", "Interface Module"),
});
const resolveFixedRequirementProfile = (itemId) => {
  const fixture = FIXED_REQUIREMENT_PROFILES[itemId];
  if (!fixture) return { found: false, projectId: FIXED_PROJECT_ID, itemId, reason: "REQUIREMENT_PROFILE_NOT_FOUND" };
  return { found: true, projectId: FIXED_PROJECT_ID, itemId, ...shapeRequirementProfile(fixture.row, { parsedProfile: fixture.parsedProfile, stale: fixture.stale }) };
};

// Slice 4, Section 17: a fixed, in-memory product-matching fixture per
// item id, covering every state the live test matrix needs -- reusing the
// SAME pure shapeProductMatchingStatus the real SQL-backed
// resolveProductMatchingStatus calls, over hand-built run/candidate rows
// matching EXACTLY the real product_match_runs/product_match_candidates
// column shapes (see worker/ai-presales-agent-tools.mjs). No fixture
// recomputes matching; each just supplies already-computed engine output.
//
// 28.20: NO matching fixture at all -- Scenario E (MATCH_RUN_NOT_FOUND).
// 28.23: 2 candidates, one Technically Compliant, one Discovery Only --
//   Scenario A (eligible candidates found).
// 28.24: 1 candidate, Discovery Only only -- Scenario B.
// 28.25: 1 candidate, Non-Compliant (a real, named failure) -- Scenario C/G.
// 28.26: a run whose requirement_profile_version_id is intentionally
//   STALE relative to the item's current profile -- Scenario D.
// 28.27: a real run with candidate_count 0 and a real engine no_match
//   reason -- Scenario F (zero candidates, distinct from no run at all).
const matchRunRowFixture = (overrides = {}) => ({ id: "matchrun_fixture", requirement_profile_version_id: "reqprofile_current", status: "Needs Review", candidate_count: 0, no_match: null, ...overrides });
const candidateRowFixture = (overrides = {}) => ({
  id: "cand_fixture", product_id: "prod_fixture", part_number: "PN-FIXTURE", manufacturer: "Honeywell", family: null,
  technical_status: "Technically Compliant", review_status: "Needs Review", matching_basis: JSON.stringify([]), mandatory_failures: JSON.stringify([]),
  ...overrides,
});
const FIXED_MATCHING_FIXTURES = {
  boqitem_2823: {
    run: matchRunRowFixture({ id: "matchrun_2823", requirement_profile_version_id: "reqprofileFireAlarmSmokeDetector", status: "Needs Review", candidate_count: 2 }),
    candidates: [
      candidateRowFixture({ id: "cand_2823_a", product_id: "prod_eagle", part_number: "IDP-EAGLE", family: "Smoke Detector", technical_status: "Technically Compliant", matching_basis: JSON.stringify(["Manufacturer + Product Family"]) }),
      candidateRowFixture({ id: "cand_2823_b", product_id: "prod_photo4", part_number: "IDP-PHOTO-IV", family: "Smoke Detector", technical_status: "Discovery Only", matching_basis: JSON.stringify(["Semantic Discovery"]), mandatory_failures: JSON.stringify([{ type: "Evidence", result: "Evidence Missing" }]) }),
    ],
    stale: false,
  },
  boqitem_2824: {
    run: matchRunRowFixture({ id: "matchrun_2824", requirement_profile_version_id: "reqprofileFireAlarmHeatDetector", status: "Discovery Only", candidate_count: 1 }),
    candidates: [
      candidateRowFixture({ id: "cand_2824_a", product_id: "prod_heat1", part_number: "IHD-90", family: "Heat Detector", technical_status: "Discovery Only", matching_basis: JSON.stringify(["Semantic Discovery"]), mandatory_failures: JSON.stringify([{ type: "Evidence", result: "Missing Product Data" }]) }),
    ],
    stale: false,
  },
  boqitem_2825: {
    run: matchRunRowFixture({ id: "matchrun_2825", requirement_profile_version_id: "reqprofileFireAlarmManualCallPoint", status: "Needs Review", candidate_count: 1 }),
    candidates: [
      candidateRowFixture({ id: "cand_2825_a", product_id: "prod_mcp_bad", part_number: "MCP-OLD-12V", family: "Manual Call Point", technical_status: "Non-Compliant", mandatory_failures: JSON.stringify([{ type: "Voltage", result: "Voltage 12V does not meet the required 24V." }]) }),
    ],
    stale: false,
  },
  boqitem_2826: {
    // The run itself is entirely clean/eligible -- the ONLY thing wrong is
    // that it was generated against an OLDER requirement profile version
    // than the item's current one (stale:true is passed explicitly below,
    // exactly like Slice 3's 28.22 fixture documents for requirement
    // staleness: this route has no real DB to compare a "current" version
    // against, so the outcome is hardcoded rather than recomputed).
    run: matchRunRowFixture({ id: "matchrun_2826", requirement_profile_version_id: "reqprofileFireAlarmSounderBeacon_v1_stale", status: "Needs Review", candidate_count: 1 }),
    candidates: [
      candidateRowFixture({ id: "cand_2826_a", product_id: "prod_beacon1", part_number: "SB-100", family: "Sounder Beacon", technical_status: "Technically Compliant", matching_basis: JSON.stringify(["Manufacturer + Product Family"]) }),
    ],
    stale: true,
  },
  boqitem_2827: {
    run: matchRunRowFixture({ id: "matchrun_2827", requirement_profile_version_id: "reqprofileFireAlarmInterfaceModule", status: "No Match", candidate_count: 0, no_match: JSON.stringify({ reason: "No product was found within the controlled search scope." }) }),
    candidates: [],
    stale: false,
  },
};
const resolveFixedProductMatchingStatus = (itemId) => {
  const fixture = FIXED_MATCHING_FIXTURES[itemId];
  if (!fixture) return { found: false, projectId: FIXED_PROJECT_ID, itemId, reason: "MATCH_RUN_NOT_FOUND" };
  return { found: true, projectId: FIXED_PROJECT_ID, itemId, ...shapeProductMatchingStatus(fixture.run, fixture.candidates, { stale: fixture.stale }) };
};

// The same resolve-then-shape sequence worker/ai-presales-agent-tools.mjs's
// resolveBoqItemContext runs, over the fixed array above instead of a real
// DB read. No Quantity Source Decision or approved-understanding-fact
// override exists for this fixture, so selectedQuantity/system/family fall
// back to the item's own raw values -- an honest, correctly-labeled
// (selectedQuantitySource:"BOQ") fixture, not a fabricated override.
const resolveFixedBoqItemContext = (reference) => {
  const { matches } = resolveItemReference(reference, FIXED_ITEMS);
  if (matches.length === 0) return { found: false, projectId: FIXED_PROJECT_ID, reason: "ITEM_NOT_FOUND", candidateReference: reference };
  if (matches.length > 1) return { found: false, projectId: FIXED_PROJECT_ID, reason: "ITEM_REFERENCE_AMBIGUOUS", candidateReference: reference };
  const item = matches[0];
  const selectedQuantity = { value: item.numeric_quantity, source: "BOQ", decisionId: null };
  const shaped = shapeBoqItemContext(item, { selectedQuantity, approvedSystem: null, approvedFamily: null });
  return { found: true, projectId: FIXED_PROJECT_ID, item: shaped };
};

export async function handleAiPresalesAgentDiagnosticApi(request, env = {}) {
  const url = new URL(request.url);
  if (url.pathname !== PATH) return null;
  if (env.AI_PRESALES_AGENT_DIAGNOSTIC_SMOKE_ENABLED !== "1" || !localHost(url.hostname)) {
    return json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
  }
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const question = String(body?.question || "").trim();
  if (!question || question.length > 400) {
    return json({ error: { code: "QUESTION_REQUIRED", message: "Provide a question up to 400 characters." } }, 400);
  }

  const readiness = boqUnderstandingProviderReadiness(env);
  // Slice 2.1: two providers, same binding/model, different schemas -- see
  // the comment above AGENT_DECISION_SCHEMA in the engine for why a single
  // combined schema is unreliable for the ANSWER path on this model.
  const decisionProvider = createConfiguredCloudflareStructuredProvider(env, { schema: AGENT_DECISION_SCHEMA, maxTokens: 300 });
  // Slice 3.1: the content call now asks for narrow prose only (no
  // responseStatus/subjectStatus/blockers/references fields to get wrong)
  // -- max_tokens lowered accordingly from Slice 3's 900.
  const answerProvider = createConfiguredCloudflareStructuredProvider(env, { schema: ANSWER_EXPLANATION_SCHEMA, maxTokens: 500 });
  if (!decisionProvider || !answerProvider) {
    return json({ reachedCloudflare: false, readiness, errorCategory: readiness.state === "Misconfigured" ? "MISCONFIGURED" : "AI_BINDING_MISSING" }, 503);
  }

  const toolExecutors = {
    get_project_status: async () => shapeProjectStatus(FIXED_PROJECT_ID, FIXED_WORKFLOW),
    get_boq_item_context: async (args) => resolveFixedBoqItemContext(args.itemReference),
    get_requirement_profile: async (args) => resolveFixedRequirementProfile(args.itemId),
    get_product_matching_status: async (args) => resolveFixedProductMatchingStatus(args.itemId),
  };

  const startedAt = Date.now();
  const outcome = await runAgentTurn({ question, projectId: FIXED_PROJECT_ID, decisionProvider, answerProvider, toolExecutors });
  const totalDurationMs = Date.now() - startedAt;

  return json({
    reachedCloudflare: true,
    readiness,
    provider: decisionProvider.metadata.provider,
    model: decisionProvider.metadata.model,
    question,
    outcome,
    totalDurationMs,
    fixture: {
      projectId: FIXED_PROJECT_ID,
      expectedStatus: shapeProjectStatus(FIXED_PROJECT_ID, FIXED_WORKFLOW),
      items: [
        "28.19 (Ceiling Mounted Dome Camera, qty 24; requirement profile: missing Panel Compatibility + Voltage conflict)",
        "28.20 (Wall Mounted Bullet Camera, qty 6; requirement profile: clean; matching: no match run -- MATCH_RUN_NOT_FOUND)",
        "28.21 (PTZ Camera, qty 2; no requirement profile generated)",
        "28.22 (Fixed Dome Camera, qty 3; requirement profile: stale)",
        "28.23 (Addressable Smoke Detector, qty 40; requirement profile: clean; matching: 1 Technically Compliant + 1 Discovery Only candidate)",
        "28.24 (Addressable Heat Detector, qty 15; requirement profile: clean; matching: 1 Discovery Only candidate only)",
        "28.25 (Manual Call Point, qty 10; requirement profile: clean; matching: 1 Non-Compliant candidate, MCP-OLD-12V, real Voltage failure)",
        "28.26 (Sounder Beacon, qty 8; requirement profile: clean; matching: 1 eligible candidate, but the match run itself is stale)",
        "28.27 (Interface Module, qty 5; requirement profile: clean; matching: real run, 0 candidates -- MATCH_RUN_EXISTS with a real no_match reason)",
        "9.1 x2 (deliberately ambiguous)",
      ],
    },
  });
}
