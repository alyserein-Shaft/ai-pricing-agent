/**
 * MVP-BOM-5 shared real-chain seed.
 *
 * Builds a complete, FK-valid product graph on a database that already has the
 * FULL drizzle-active chain applied (see tests/helpers/active-chain.mjs
 * `openEmptyDatabase` + `applyActiveChain`, or the `activeChainDatabase`
 * fixture). Every INSERT shape below is proven against the real chain by
 * tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs; only the pricing and
 * quotation line helpers carry the MVP-BOM-5 generalized source identity.
 *
 * The helpers intentionally cover BOTH source branches:
 *   - PRODUCT lines: boq/candidate/safety provenance NOT NULL, scope identity NULL,
 *     source_type='PRODUCT', source_product_id=product_id.
 *   - SCOPE lines: boq/candidate/safety NULL, scope identity NOT NULL,
 *     source_type='SCOPE', source_product_id=product_id.
 */

export const IDS = {
  PROJECT: "p1",
  BOQ_ITEM: "b1",
  PROFILE: "prof-1",
  MATCH_RUN: "pmr-1",
  CANDIDATE: "pmc-1",
  SAFETY: "sd-1",
  MANUFACTURER: "m1",
  PRODUCT: "prod-1",
  PRODUCT_2: "prod-2",
  SCENARIO: "sc-1",
  RUN: "pr-1",
  WORKFLOW_SNAPSHOT: "ws-1",
  QUOTATION_REVISION: "rev-1",
  COMMERCIAL_APPROVAL: "pa-1",
};

// pricing_lines column list after 0015: the 30 historical columns plus the
// generalized source identity. Keep IDs quoted so the helpers stay valid both
// before (where they simply prove the pre-0015 schema cannot express SCOPE) and
// after the migration.
export const PRICING_LINE_COLUMNS = [
  "id", "pricing_run_id", "project_id", "boq_item_id", "candidate_id",
  "product_id", "safety_decision_id", "selected_price_record_id",
  "version_number", "status", "quantity", "unit", "source_currency",
  "project_currency", "original_list_price_minor", "net_material_unit_minor",
  "material_total_minor", "direct_cost_minor", "total_cost_minor",
  "gross_selling_minor", "customer_discount_minor", "net_selling_minor",
  "vat_minor", "final_value_minor", "margin_basis_points",
  "markup_basis_points", "output", "explanation", "approval_ready",
  "created_at",
  "source_type", "engineering_scope_kind", "system", "source_role",
  "source_snapshot_id", "source_fingerprint", "source_product_id",
].join(",");

export const QUOTATION_LINE_COLUMNS = [
  "id", "quotation_revision_id", "project_id", "boq_item_id", "sequence",
  "item_number", "description", "unit", "quantity", "candidate_id",
  "product_id", "manufacturer_name", "part_number", "product_description",
  "pricing_run_id", "pricing_run_version", "pricing_line_id",
  "pricing_line_version", "pricing_input_fingerprint", "commercial_approval_id",
  "commercial_approval_version", "currency", "total_cost_minor",
  "net_selling_minor", "source_snapshot_json", "created_at",
  "source_type", "engineering_scope_kind", "system", "source_role",
  "source_snapshot_id", "source_fingerprint", "source_product_id",
].join(",");

/** Insert a PRODUCT pricing line. `id` is the pricing line id. */
export const insertProductPricingLine = (raw, {
  id = "pl-prod-1",
  runId = IDS.RUN,
  projectId = IDS.PROJECT,
  boqItemId = IDS.BOQ_ITEM,
  candidateId = IDS.CANDIDATE,
  productId = IDS.PRODUCT,
  safetyDecisionId = IDS.SAFETY,
  sourceProductId = undefined,
  status = "Approved",
  approvalReady = 1,
} = {}) => {
  const sourceProductIdFinal = sourceProductId === undefined ? productId : sourceProductId;
  raw.prepare(`INSERT INTO pricing_lines (${PRICING_LINE_COLUMNS}) VALUES (${new Array(37).fill("?").join(",")})`).run(
    id, runId, projectId, boqItemId, candidateId, productId, safetyDecisionId, null,
    1, status, 1, "EA", "SAR", "SAR", 100, 100, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0,
    "{}", "fixture", approvalReady, "now",
    "PRODUCT", null, null, null, null, null, sourceProductIdFinal,
  );
  return id;
};

/** Insert a SCOPE pricing line (pure sizing-derived source, no provenance). */
export const insertScopePricingLine = (raw, {
  id = "pl-scope-1",
  runId = IDS.RUN,
  projectId = IDS.PROJECT,
  productId = IDS.PRODUCT,
  sourceProductId = undefined,
  engineeringScopeKind = "Sizing",
  system = "Fire Alarm",
  sourceRole = "Panel Sizing",
  sourceSnapshotId = "snap-1",
  sourceFingerprint = "fingerprint-scope-1",
  status = "Approved",
  approvalReady = 1,
} = {}) => {
  const sourceProductIdFinal = sourceProductId === undefined ? productId : sourceProductId;
  raw.prepare(`INSERT INTO pricing_lines (${PRICING_LINE_COLUMNS}) VALUES (${new Array(37).fill("?").join(",")})`).run(
    id, runId, projectId, null, null, productId, null, null,
    1, status, 1, "EA", "SAR", "SAR", 100, 100, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0,
    "{}", "fixture", approvalReady, "now",
    "SCOPE", engineeringScopeKind, system, sourceRole, sourceSnapshotId, sourceFingerprint, sourceProductIdFinal,
  );
  return id;
};

/** Insert a PRODUCT quotation line anchored to a reconstructed pricing line. */
export const insertProductQuotationLine = (raw, {
  id = "ql-prod-1",
  revisionId = IDS.QUOTATION_REVISION,
  projectId = IDS.PROJECT,
  boqItemId = IDS.BOQ_ITEM,
  candidateId = IDS.CANDIDATE,
  productId = IDS.PRODUCT,
  pricingLineId = "pl-prod-1",
  approvalId = IDS.COMMERCIAL_APPROVAL,
  sourceProductId = undefined,
  sequence = 1,
} = {}) => {
  const sourceProductIdFinal = sourceProductId === undefined ? productId : sourceProductId;
  raw.prepare(`INSERT INTO project_quotation_lines (${QUOTATION_LINE_COLUMNS}) VALUES (${new Array(33).fill("?").join(",")})`).run(
    id, revisionId, projectId, boqItemId, sequence, "1", "Addressable smoke detector", "EA", "1",
    candidateId, productId, "Honeywell", "P-001", "Fixture product",
    IDS.RUN, 1, pricingLineId, 1, "fp-quotation-1", approvalId, 1, "SAR", 100, 100, "{}", "now",
    "PRODUCT", null, null, null, null, null, sourceProductIdFinal,
  );
  return id;
};

/** Insert a SCOPE quotation line (pure source; boq/candidate NULL). */
export const insertScopeQuotationLine = (raw, {
  id = "ql-scope-1",
  revisionId = IDS.QUOTATION_REVISION,
  projectId = IDS.PROJECT,
  productId = IDS.PRODUCT,
  pricingLineId = "pl-scope-1",
  approvalId = IDS.COMMERCIAL_APPROVAL,
  sourceProductId = undefined,
  engineeringScopeKind = "Sizing",
  system = "Fire Alarm",
  sourceRole = "Panel Sizing",
  sourceSnapshotId = "snap-1",
  sourceFingerprint = "fingerprint-scope-1",
  sequence = 2,
} = {}) => {
  const sourceProductIdFinal = sourceProductId === undefined ? productId : sourceProductId;
  raw.prepare(`INSERT INTO project_quotation_lines (${QUOTATION_LINE_COLUMNS}) VALUES (${new Array(33).fill("?").join(",")})`).run(
    id, revisionId, projectId, null, sequence, "2", "Sizing-derived output product", "EA", "1",
    null, productId, "Honeywell", "P-001", "Fixture product",
    IDS.RUN, 1, pricingLineId, 1, "fp-quotation-scope-1", approvalId, 1, "SAR", 100, 100, "{}", "now",
    "SCOPE", engineeringScopeKind, system, sourceRole, sourceSnapshotId, sourceFingerprint, sourceProductIdFinal,
  );
  return id;
};

/**
 * Seed the complete base product graph: organization, project, source document
 * pipeline, BOQ item, requirement profile, product library, selection chain
 * (match run + candidate + safety decision), pricing scenario + run, workflow
 * snapshot, commercial approval and quotation revision.
 */
export const seedProductGraph = (raw) => {
  raw.prepare("INSERT INTO organizations (id,name,owner_user_id) VALUES (?,?,?)").run("org1", "Fixture Organization", "owner1");
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
    .run(IDS.PROJECT, "MVP-BOM-5 fixture project", "owner1", "org1", "Fire Alarm", "Active");

  raw.prepare("INSERT INTO documents (id,project_id,logical_name,created_by,created_at) VALUES (?,?,?,?,?)")
    .run("doc1", IDS.PROJECT, "BOQ and riser", "owner1", "now");
  raw.prepare(`INSERT INTO document_versions
    (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("dv1", "doc1", 1, "boq.pdf", "boq.stored", "pdf", "application/pdf", 4, "sha-dv1", "projects/boq.pdf", "owner1", "2020-01-01T00:00:00.000Z");
  raw.prepare("UPDATE documents SET current_version_id='dv1' WHERE id='doc1'").run();
  raw.prepare(`INSERT INTO boq_extraction_versions
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run("ext1", "doc1", "dv1", 1, "Completed", "parser-v1", "rules-v1", "ocr-v1", "owner1", "now", "now");

  raw.prepare(`INSERT INTO boq_items
    (id,extraction_version_id,project_id,source_document_id,duplicate_of_item_id,row_type,sequence,item_number,hierarchy_depth,section_path,system_value,category,subcategory,description,normalized_unit,original_unit,numeric_quantity,original_quantity,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.BOQ_ITEM, "ext1", IDS.PROJECT, "doc1", null, "BOQ Item", 1, "1", 0, "1", "Fire Alarm",
    "Detectors", "Addressable Smoke Detector", "Addressable smoke detector", "EA", "EA", 1, 1, 95,
    "Resolved", "Approved", "{}", "{}", "{}", 1, "now", "now",
  );

  raw.prepare(`INSERT INTO requirement_profile_versions
    (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,approved_for_matching,superseded_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.PROFILE, IDS.PROJECT, IDS.BOQ_ITEM, 1, "Ready for Matching", "engine-v1", "rules-v1", "model-v1",
    "fp-prof-1", JSON.stringify({ boqItem: { id: IDS.BOQ_ITEM, system: "Fire Alarm", productFamily: "Addressable Smoke Detector", attributes: {} } }),
    "fixture profile", "Ready", "{}", 1, null, "owner1", "now",
  );

  raw.prepare("INSERT INTO product_manufacturers (id,name,normalized_name,created_by,created_at) VALUES (?,?,?,?,?)")
    .run(IDS.MANUFACTURER, "Honeywell", "honeywell", "ingest", "now");
  raw.prepare(`INSERT INTO product_sources
    (id,checksum,source_type,authority,scope_type,file_name,validity_state,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run("source-1", "sum-source-1", "Manufacturer Datasheet", "Manufacturer", "Global", "source-1.pdf", "Current", "ingest", "now");
  const product = (id, partNumber, role) => raw.prepare(`INSERT INTO library_products
    (id,manufacturer_id,part_number,normalized_part_number,description,created_by,created_at,review_status,approved_for_discovery,identity_status,identity_version,product_role)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, IDS.MANUFACTURER, partNumber, partNumber.toLowerCase(), `Fixture product ${partNumber}`, "ingest", "now", "Reviewed", 0, "Active", 1, role,
  );
  product(IDS.PRODUCT, "P-001", "Control Panel");
  product(IDS.PRODUCT_2, "P-002", "Detector");
  raw.prepare("INSERT INTO product_source_evidence (id,product_id,source_id,original_text,parser_version,created_at) VALUES (?,?,?,?,?,?)")
    .run("pse-1", IDS.PRODUCT, "source-1", "P-001 datasheet", "parser-v1", "now");

  raw.prepare(`INSERT INTO product_match_runs
    (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,created_by,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.MATCH_RUN, IDS.PROJECT, IDS.BOQ_ITEM, IDS.PROFILE, 1, "Completed", "fp-pmr-1", "engine-v1", "rules-v1", "search-v1", "model-v1", "Project", "{}", "owner1", "now", "now",
  );
  raw.prepare(`INSERT INTO product_match_candidates
    (id,match_run_id,product_id,rank,search_stage,score,score_components,technical_status,recommendation_tier,confidence_state,confidence_score,matching_basis,commercial_availability,explanation,mandatory_failures,lifecycle_result)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.CANDIDATE, IDS.MATCH_RUN, IDS.PRODUCT, 1, "Recall", 1, "{}", "Eligible", "Recommended", "Resolved", 95,
    "Fixture", "Available", "fixture", "[]", "Active",
  );
  raw.prepare(`INSERT INTO safety_decisions
    (id,project_id,boq_item_id,requirement_profile_version_id,match_run_id,candidate_id,version_number,input_fingerprint,safety_state,compliance_state,confidence_level,overall_confidence,confidence_components,technical_eligibility,price_eligibility,missing_information,provenance_status,explanation,engine_version,ruleset_version,model_version,recalculation_reason,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.SAFETY, IDS.PROJECT, IDS.BOQ_ITEM, IDS.PROFILE, IDS.MATCH_RUN, IDS.CANDIDATE, 1, "fp-sd-1",
    "Safe", "Compliant", "High", 95, "{}", "Eligible", "Eligible", "[]", "Verified", "fixture",
    "engine-v1", "rules-v1", "model-v1", "initial", "owner1", "now",
  );

  raw.prepare(`INSERT INTO pricing_scenarios
    (id,project_id,name,mode,version_number,project_currency,status,assumptions,settings,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.SCENARIO, IDS.PROJECT, "Fixture scenario", "Base", 1, "SAR", "Active", "[]", "{}", "owner1", "now",
  );
  raw.prepare(`INSERT INTO pricing_runs
    (id,project_id,scenario_id,version_number,status,input_fingerprint,engine_version,ruleset_version,reason,locked_versions,summary,created_by,created_at,completed_at,superseded_at,error_code,error_message)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.RUN, IDS.PROJECT, IDS.SCENARIO, 1, "Completed", "run-fp", "engine-v1", "rules-v1", "Fixture run", "{}", "{}", "owner1", "now", "now", null, null, null,
  );

  raw.prepare(`INSERT INTO presales_workflow_snapshots
    (id,project_id,model_version,input_fingerprint,status,progress,current_stage_id,ready_for_quotation,ready_for_issue,stages_json,blockers_json,warnings_json,calculated_by,calculated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.WORKFLOW_SNAPSHOT, IDS.PROJECT, "model-v1", "fp-ws-1", "Completed", 100, "stage-quotation", 1, 1,
    "{}", "[]", "[]", "system", "now",
  );

  raw.prepare(`INSERT INTO pricing_approvals
    (id,project_id,pricing_run_id,pricing_line_id,approval_type,status,entity_version,request_reason,evidence,requested_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.COMMERCIAL_APPROVAL, IDS.PROJECT, IDS.RUN, null, "Commercial Price", "Approved", 1, "Fixture approval", "{}", "owner1", "now",
  );

  raw.prepare(`INSERT INTO project_quotation_revisions
    (id,project_id,revision_number,quotation_fingerprint,workflow_snapshot_id,currency,subtotal_minor,vat_basis_points,vat_minor,total_minor,terms_json,source_summary_json,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    IDS.QUOTATION_REVISION, IDS.PROJECT, 1, "qf-1", IDS.WORKFLOW_SNAPSHOT, "SAR", 1000, 1500, 150, 1150,
    "{}", "{}", "Draft", "owner1", "now",
  );

  return raw;
};