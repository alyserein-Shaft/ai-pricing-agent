import { parseXlsxWorkbook } from "../app/document-parsers/xlsx.mjs";
import { buildHistoricalLearningPack } from "../app/domain/historical-learning-pack-adapter.mjs";
import {
  buildSimilaritySignals,
  computeCompleteness,
  computeHistoricalCompleteness,
  stableStringify,
} from "../app/domain/case-study-learning-engine.mjs";

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const sha256Hex = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const snapshotFingerprint = async (snapshot) =>
  sha256Hex(
    new TextEncoder().encode(stableStringify(snapshot)),
  );

const assertUpload = (file) => {
  if (!(file instanceof File)) {
    const error = new Error("An XLSX learning-pack file is required.");
    error.code = "LEARNING_PACK_FILE_REQUIRED";
    throw error;
  }

  if (!/\.xlsx$/i.test(file.name)) {
    const error = new Error(
      "Historical learning-pack import requires an XLSX workbook.",
    );
    error.code = "LEARNING_PACK_XLSX_REQUIRED";
    throw error;
  }

  if (file.size <= 0) {
    const error = new Error("The uploaded workbook is empty.");
    error.code = "LEARNING_PACK_EMPTY";
    throw error;
  }

  if (file.size > 25 * 1024 * 1024) {
    const error = new Error(
      "The uploaded workbook exceeds the 25 MB import limit.",
    );
    error.code = "LEARNING_PACK_TOO_LARGE";
    throw error;
  }
};

export async function importHistoricalLearningPack({
  db,
  request,
  actor,
  project,
}) {
  const form = await request.formData();
  const file = form.get("file");
  const reason = String(form.get("reason") || "").trim();

  assertUpload(file);

  if (reason.length < 10) {
    const error = new Error(
      "Provide a substantive reason for importing historical project learning.",
    );
    error.code = "LEARNING_PACK_REASON_REQUIRED";
    throw error;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const workbookSha256 = await sha256Hex(bytes.buffer);

  const workbook = parseXlsxWorkbook(bytes, {
    fileName: file.name,
    sha256: workbookSha256,
  });

  const pack = buildHistoricalLearningPack({
    workbook,
    sha256: workbookSha256,
    project: {
      id: project.id,
      organizationId: project.organization_id,
      name: project.name,
      systemDomain: project.system_domain,
      client: project.client,
      location: project.location,
      currency: project.currency || "SAR",
      projectOutcome:
        project.initial_status ||
        "Historical Final Quotation Reviewed",
    },
  });

  const fingerprint = await snapshotFingerprint(pack.snapshot);

  const existing = await db
    .prepare(
      `SELECT *
       FROM case_studies
       WHERE project_id=?
         AND snapshot_fingerprint=?
       LIMIT 1`,
    )
    .bind(project.id, fingerprint)
    .first();

  if (existing) {
    return {
      caseStudy: existing,
      historicalCompleteness: existing.historical_completeness_assessment
        ? JSON.parse(existing.historical_completeness_assessment)
        : null,
      learningReadiness: existing.learning_readiness || null,
      idempotent: true,
      workbookSha256,
      counts: pack.counts,
      databaseWrites: 0,
    };
  }

  const previous = await db
    .prepare(
      `SELECT *
       FROM case_studies
       WHERE project_id=?
         AND superseded_at IS NULL
       ORDER BY case_version DESC
       LIMIT 1`,
    )
    .bind(project.id)
    .first();

  const caseStudyId = uid("caseStudy");
  const stamp = now();
  const caseVersion = Number(previous?.case_version || 0) + 1;

  const inventory = pack.sources.map((source) => ({
    sourceType: source.sourceType,
    completenessState: source.completenessState,
  }));

  const completeness = computeCompleteness(
    inventory,
    pack.groundTruthRecords.map((record) => ({
      recordType: record.recordType,
      originalValue: record.originalValue,
      provenance: {
        sourceDocumentId:
          record.provenance?.sourceDocumentId ||
          `${file.name}:${record.provenance?.sheet}:${record.provenance?.row}`,
      },
    })),
  );
  const historicalAssessment = computeHistoricalCompleteness({
    snapshot: pack.snapshot,
    sources: pack.sources,
    groundTruth: pack.groundTruthRecords,
    knowledge: pack.knowledgeItems,
  });

  const statements = [];

  if (previous) {
    statements.push(
      db
        .prepare(
          "UPDATE case_studies SET superseded_at=? WHERE id=?",
        )
        .bind(stamp, previous.id),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO case_studies (
          id,
          project_id,
          organization_id,
          case_version,
          snapshot_fingerprint,
          project_snapshot,
          system_domain,
          client,
          location,
          currency,
          project_outcome,
          source_completeness,
          ground_truth_completeness,
          historical_completeness_assessment,
          learning_readiness,
          review_state,
          publication_state,
          benchmark_state,
          frozen_at,
          frozen_by
        ) VALUES (
          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )`,
      )
      .bind(
        caseStudyId,
        project.id,
        project.organization_id,
        caseVersion,
        fingerprint,
        JSON.stringify(pack.snapshot),
        pack.snapshot.systemDomain,
        pack.snapshot.client,
        pack.snapshot.location,
        pack.snapshot.currency,
        pack.snapshot.projectOutcome,
        completeness.sourceCompleteness,
        completeness.groundTruthCompleteness,
        JSON.stringify(historicalAssessment),
        historicalAssessment.learningReadiness,
        "Needs Review",
        "Not Published",
        "Learning",
        stamp,
        actor.id,
      ),
  );

  for (const source of pack.sources) {
    statements.push(
      db
        .prepare(
          `INSERT INTO case_study_sources (
            id,
            case_study_id,
            document_id,
            document_version_id,
            source_type,
            name,
            checksum,
            authority,
            scope,
            completeness_state,
            provenance
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          uid("caseSource"),
          caseStudyId,
          null,
          null,
          source.sourceType,
          source.name,
          workbookSha256,
          source.authority || null,
          source.scope || null,
          source.completenessState,
          JSON.stringify(source.provenance),
        ),
    );
  }

  for (const record of pack.groundTruthRecords) {
    statements.push(
      db
        .prepare(
          `INSERT INTO case_ground_truth_records (
            id,
            case_study_id,
            record_key,
            boq_item_id,
            record_type,
            original_value,
            normalized_value,
            confidence,
            review_state,
            evidence_scope,
            provenance,
            version
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
        )
        .bind(
          uid("caseTruth"),
          caseStudyId,
          record.recordKey,
          null,
          record.recordType,
          JSON.stringify(record.originalValue),
          JSON.stringify(record.normalizedValue),
          record.confidence,
          "Needs Review",
          record.evidenceScope,
          JSON.stringify(record.provenance),
        ),
    );
  }

  for (const item of pack.knowledgeItems) {
    statements.push(
      db
        .prepare(
          `INSERT INTO case_knowledge_items (
            id,
            case_study_id,
            ground_truth_record_id,
            classification,
            layer,
            title,
            original_value,
            normalized_value,
            confidence,
            scope,
            review_state,
            publication_state,
            reusable,
            evidence,
            version
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        )
        .bind(
          uid("caseKnowledge"),
          caseStudyId,
          null,
          item.classification,
          "Project Evidence",
          item.title,
          JSON.stringify(item.originalValue),
          JSON.stringify(item.normalizedValue),
          item.confidence,
          item.scope,
          "Needs Review",
          "Not Published",
          0,
          JSON.stringify({
            ...item.evidence,
            sourceKey: item.key,
            historicalOnly: true,
            automaticApproval: false,
          }),
        ),
    );
  }

  const signals = buildSimilaritySignals({
    ...pack.snapshot,
    projectType: "Historical Completed Project",
    region: pack.snapshot.location,
  });

  for (const signal of signals) {
    statements.push(
      db
        .prepare(
          `INSERT INTO case_similarity_signals (
            id,
            case_study_id,
            signal_type,
            signal_value,
            normalized_value,
            weight,
            provenance
          ) VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(
          uid("caseSignal"),
          caseStudyId,
          signal.signalType,
          signal.signalValue,
          signal.normalizedValue,
          signal.weight,
          JSON.stringify({
            workbookSha256,
            snapshotFingerprint: fingerprint,
            historicalOnly: true,
          }),
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO case_study_audit_log (
          id,
          case_study_id,
          entity_type,
          entity_id,
          action,
          previous_value,
          new_value,
          reason,
          actor_user_id,
          actor_permission,
          request_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        uid("caseAudit"),
        caseStudyId,
        "Case Study",
        caseStudyId,
        "Historical Learning Pack Imported",
        previous
          ? JSON.stringify({
              previousCaseStudyId: previous.id,
              previousCaseVersion: previous.case_version,
            })
          : null,
        JSON.stringify({
          caseVersion,
          fingerprint,
          workbookSha256,
          counts: pack.counts,
          reviewState: "Needs Review",
          publicationState: "Not Published",
          benchmarkState: "Learning",
          reusableItems: 0,
          automaticApproval: false,
        }),
        reason,
        actor.id,
        actor.permission,
        request.headers.get("x-request-id") ||
          crypto.randomUUID(),
      ),
  );

  await db.batch(statements);

  const created = await db
    .prepare("SELECT * FROM case_studies WHERE id=?")
    .bind(caseStudyId)
    .first();

  return {
    caseStudy: created,
    idempotent: false,
    workbookSha256,
    counts: {
      ...pack.counts,
      similaritySignals: signals.length,
    },
    databaseWrites: statements.length,
    governance: {
      reviewState: "Needs Review",
      publicationState: "Not Published",
      benchmarkState: "Learning",
      reusableItems: 0,
      historicalOnly: true,
      automaticApproval: false,
    },
    historicalCompleteness: historicalAssessment,
    learningReadiness: historicalAssessment.learningReadiness,
  };
}
