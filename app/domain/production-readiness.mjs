export const APPLICATION_VERSION = "16.0.0-alpha";
export const MIGRATION_VERSION = "0014_task9_fire_alarm_library";
export const READINESS_REQUIRED_TABLES = ["projects", "documents", "document_versions", "document_processing_runs", "boq_items", "specification_extraction_versions", "requirement_profile_versions", "library_products", "product_versions", "product_variants", "product_attributes", "product_certifications", "product_compatibility", "product_accessories", "supplier_quotes", "supplier_quote_lines", "price_records", "price_source_versions", "discount_rules", "library_processing_jobs", "product_match_runs", "safety_decisions", "pricing_runs", "review_queue_items", "excel_export_jobs", "project_progress_snapshots"];
export const RELEASE_LEVELS = ["Not Ready", "Internal Alpha Ready", "Controlled Pilot Ready", "Beta Ready", "Production Candidate", "Production Ready"];

export const releaseGate = ({ coreWorkflow, criticalSafety, dataIntegrity, backupRestore, monitoring, staging, performance, security, recovery, unresolvedSeverity1 = 0 }) => {
  const evidence = { coreWorkflow, criticalSafety, dataIntegrity, backupRestore, monitoring, staging, performance, security, recovery, unresolvedSeverity1 };
  if (unresolvedSeverity1 || !criticalSafety || !dataIntegrity) return { level: "Not Ready", evidence, blockers: Object.entries(evidence).filter(([, value]) => value === false || (typeof value === "number" && value > 0)).map(([key]) => key) };
  if (!coreWorkflow) return { level: "Functional Prototype", evidence, blockers: ["coreWorkflow"] };
  if (!backupRestore || !monitoring) return { level: "Internal Alpha Ready", evidence, blockers: [!backupRestore && "backupRestore", !monitoring && "monitoring"].filter(Boolean) };
  if (!staging || !security || !recovery) return { level: "Controlled Pilot Ready", evidence, blockers: [!staging && "staging", !security && "security", !recovery && "recovery"].filter(Boolean) };
  if (!performance) return { level: "Beta Ready", evidence, blockers: ["performance"] };
  return { level: "Production Candidate", evidence, blockers: ["Independent production approval and live operational validation required"] };
};

export const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

export const sanitizeLogContext = (context = {}) => Object.fromEntries(Object.entries(context).filter(([key]) => !/authorization|cookie|secret|token|password|filebytes|documentcontent/i.test(key)).map(([key, value]) => [key, typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}…` : value]));
