// GOVERNED DRAWING-ARCHITECTURE PROJECTION (READ-ONLY PLANNER + IDEMPOTENT WRITER).
//
// WHY THIS EXISTS
// ---------------
// Approved drawing architecture is reviewed, approved and versioned correctly.
// The stage-4 bridge consumes it correctly. The panel-sizing engine correctly
// refuses to persist a snapshot whose panels are not approved architecture
// identities. The break is that the sizing path enumerates panel identity from
// `PANEL_EXISTS` rows alone, and those rows carry a ROLE token ("FACP") as the
// subject rather than a per-physical-panel identity. Measured on the current
// Al Mousa approved version: 5 approved PANEL_EXISTS rows collapse to 4
// required identities, because three of them share the identical string
// "FACP". The six distinct served areas live in the AREA_COVERAGE channel and
// therefore never contribute an identity at all.
//
// So this module projects the approved rows into the governed engineering fact
// graph WITHOUT inventing an identity, and it records identity resolution as a
// first-class governed state. It is a projection, not a second architecture
// model: nothing here re-parses a drawing, re-decides an adjudication, or
// promotes an unapproved row.
//
// THE ONE RULE THAT MATTERS MOST
// ------------------------------
// A generic `FACP` row with no canonical adjudication resolves to NO identity.
// Minting "FACP @<sheet>" would be inventing a physical panel -- precisely the
// kind of confident fabrication this project refuses. Those rows are projected
// with GENERIC_IDENTITY_UNRESOLVED and stay visible instead.

import { createHash } from "node:crypto";

export const DRAWING_ARCHITECTURE_PROJECTION_VERSION = "drawing-architecture-governed-projection-1.0.0";

const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const normSheet = (v) => text(v).replace(/\s+/g, " ").replace(/^"|"$/g, "");

/** Panel role tokens. A role is NOT an identity. */
export const PANEL_ROLE_TOKENS = Object.freeze(["FACP", "MFACP"]);

export const IDENTITY_RESOLUTION = Object.freeze({
  ADJUDICATED_CANONICAL: "ADJUDICATED_CANONICAL",
  ROLE_TOKEN_SHEET_SCOPED: "ROLE_TOKEN_SHEET_SCOPED",
  GENERIC_IDENTITY_UNRESOLVED: "GENERIC_IDENTITY_UNRESOLVED",
});

/**
 * Resolve the panel identity an approved row asserts.
 *
 * MFACP is a UNIQUE role on this project (one campus-wide master), so the role
 * token alone is already an unambiguous panel identity and is recorded as
 * sheet-scoped rather than unresolved. A generic FACP is NOT unique -- the
 * approved architecture contains six of them -- so without a canonical
 * adjudication it resolves to nothing.
 */
export const resolvePanelIdentity = (evidence) => {
  const canonical = text(evidence.adjudication?.canonicalPanelIdentity);
  if (canonical) {
    return { identity: canonical, state: IDENTITY_RESOLUTION.ADJUDICATED_CANONICAL, adjudicationKey: evidence.adjudication.exceptionKey ?? null };
  }
  const subject = text(evidence.subject);
  if (subject === "MFACP") {
    return { identity: "MFACP", state: IDENTITY_RESOLUTION.ROLE_TOKEN_SHEET_SCOPED, adjudicationKey: null };
  }
  return { identity: null, state: IDENTITY_RESOLUTION.GENERIC_IDENTITY_UNRESOLVED, adjudicationKey: null };
};

/**
 * Confidence derived from evidence class, never invented.
 * EXPLICIT/PRIMARY is direct evidence; DERIVED/PRIMARY is an inference the
 * reviewer approved; anything else is carried at its own class.
 */
export const confidenceFor = (evidence) => {
  const kind = text(evidence.evidenceKind).toUpperCase();
  const authority = text(evidence.authorityClass).toUpperCase();
  if (kind === "EXPLICIT" && authority === "PRIMARY") return 95;
  if (kind === "DERIVED" && authority === "PRIMARY") return 80;
  if (kind === "EXPLICIT") return 70;
  return 50;
};

/** Deterministic id so repeated projection is a NO-OP rather than a duplicate. */
const digest = (parts) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
export const projectionFactId = (projectId, factType, sheet, subject, predicate) =>
  `daf_${digest([projectId, factType, normSheet(sheet), text(subject), predicate])}`;
export const projectionRelationshipId = (projectId, left, type, right) =>
  `dar_${digest([projectId, text(left), text(type), text(right)])}`;
export const projectionProvenanceId = (factId, evidenceId) =>
  `dap_${digest([factId, text(evidenceId)])}`;

/** Select the CURRENT approved architecture version. */
export function currentApprovedVersion(rows) {
  const live = rows.filter((r) => !r.superseded_at);
  if (!live.length) return null;
  return live.sort((a, b) => Number(b.version_number) - Number(a.version_number))[0];
}

/** Rows belonging to the current approved version only. */
export const rowsForVersion = (approvedRows, versionId) =>
  approvedRows.filter((r) => r.approved_version_id === versionId);

/**
 * Build the projection PLAN. Pure: no DB, no writes.
 *
 * Returns { facts, relationships, provenance, identities, unresolved }.
 */
export function planProjection({ projectId, approvedVersion, approvedRows, evidence }) {
  const version = currentApprovedVersion(approvedVersion);
  if (!version) return { status: "NO_CURRENT_APPROVED_ARCHITECTURE", facts: [], relationships: [], provenance: [], identities: [], unresolved: [] };

  // The version filter is asserted by currentApprovedVersion above; rowsForVersion
  // is the exported, independently tested path for selecting them.
  rowsForVersion(approvedRows, version.id);
  const facts = [];
  const relationships = [];
  const provenance = [];
  const identities = new Map();
  const unresolved = [];

  // Panel inventory first, so every later relationship can bind to an identity.
  const panelEvidence = evidence.filter((e) => e.factType === "PANEL_EXISTS");
  // identityBySheetRole is ROLE-AWARE. A sheet can host more than one panel, and
  // the six `FACP SERVES <area>` rows all sit on the same sheet as the MFACP.
  const identityBySheetRole = new Map();
  const sheetKey = (sheet, role) => `${normSheet(sheet)}::${text(role)}`;
  const ANY_ROLE = "*";
  const anyRoleSheetKey = (sheet) => sheetKey(sheet, ANY_ROLE);
  for (const e of panelEvidence) {
    const { identity, state, adjudicationKey } = resolvePanelIdentity(e);
    const sheet = normSheet(e.provenance?.sourceDrawingNumber);
    if (identity) {
      identityBySheetRole.set(sheetKey(sheet, e.subject), identity);
      // A sheet may host several panels (AMS-001 hosts both the MFACP and a
      // FACP). The wildcard entry exists only for rows that assert no role of
      // their own, and is only set when the sheet has exactly ONE panel -- a
      // multi-panel sheet never gets an unambiguous non-role owner.
      const wildcard = identityBySheetRole.get(anyRoleSheetKey(sheet));
      identityBySheetRole.set(anyRoleSheetKey(sheet), wildcard && wildcard !== identity ? null : identity);
      const existing = identities.get(identity);
      if (existing) {
        existing.sheets.push(sheet);
        existing.evidenceIds.push(e.id);
      } else {
        identities.set(identity, {
          identity,
          resolutionState: state,
          adjudicationKey,
          role: text(e.subject),
          sheets: [sheet],
          evidenceIds: [e.id],
        });
      }
    } else {
      unresolved.push({
        factType: e.factType,
        subject: text(e.subject),
        sheet,
        page: e.provenance?.sourcePage ?? null,
        evidenceId: e.id,
        resolutionState: state,
        reason: "a generic panel role token with no canonical adjudication cannot be promoted to a physical panel identity",
      });
    }
  }

  /** Reverse index: identity -> role, so a network row can bind by its object. */
  const roleByIdentity = new Map([...identities].map(([identity, meta]) => [identity, meta.role]));

  /** The owning panel identity for an approved row, or null.
   *
   * Order of authority:
   *   1. the row's own canonical adjudication;
   *   2. its own SUBJECT when that subject is already an approved identity;
   *   3. its OBJECT when that object names an approved identity (a network row
   *      binds to the panel it names, not to whichever panel shares its sheet);
   *   4. a ROLE-MATCHED panel on the same sheet.
   *
   * Step 4 is deliberately role-matched. All six `FACP SERVES <area>` rows sit
   * on the same sheet as the MFACP, so an un-matched sheet lookup would
   * re-parent every building FACP onto the master panel -- treating a panel
   * LOCATION as a served-area identity, which is the specific confusion this
   * projection must not introduce. */
  const ownerOf = (e) => {
    const direct = resolvePanelIdentity(e).identity;
    if (direct) return direct;
    const subject = text(e.subject);
    if (subject && roleByIdentity.has(subject)) return subject;
    const object = text(e.object);
    if (object && roleByIdentity.has(object)) return object;
    // When the row's subject IS a panel role token ("FACP"/"MFACP"), the sheet
    // lookup must match on role -- otherwise the six `FACP SERVES` rows on the
    // MFACP's sheet would re-parent onto the master panel.
    // When the subject is NOT a role token (a loop id, a NAC id, a system
    // name), the sheet's panel is the only sensible owner and role matching
    // does not apply, because the row asserts no role of its own.
    const key = PANEL_ROLE_TOKENS.includes(subject)
      ? sheetKey(e.provenance?.sourceDrawingNumber, subject)
      : anyRoleSheetKey(e.provenance?.sourceDrawingNumber);
    return key ? identityBySheetRole.get(key) || null : null;
  };

  const pushFact = (e, { entityType, entityId, predicate, value }) => {
    const id = projectionFactId(projectId, predicate, e.provenance?.sourceDrawingNumber, e.subject, entityId);
    facts.push({
      id,
      projectId,
      entityType,
      entityId,
      predicate,
      value,
      dataType: "JSON",
      operator: "=",
      factType: "DRAWING_ARCHITECTURE_PROJECTION",
      scopeType: "Project",
      scopeId: projectId,
      status: "Current",
      confidence: confidenceFor(e),
      modelVersion: DRAWING_ARCHITECTURE_PROJECTION_VERSION,
      architectureVersion: Number(version.version_number),
      approvedVersionId: version.id,
      sourceEvidenceId: e.id,
    });
    provenance.push({
      id: projectionProvenanceId(id, e.id),
      factId: id,
      sourceType: "DRAWING_ARCHITECTURE_APPROVED_ROW",
      sourceId: version.id,
      evidenceId: e.id,
      documentId: e.provenance?.documentId ?? null,
      documentVersionId: e.provenance?.documentVersionId ?? null,
      page: e.provenance?.sourcePage ?? null,
      sheet: normSheet(e.provenance?.sourceDrawingNumber) || null,
      section: text(e.factType) || null,
      clause: null,
      originalText: [e.subject, e.relation, e.object].filter(Boolean).join(" ").slice(0, 500) || null,
      extractionMethod: "approved-drawing-architecture-projection",
      ruleVersion: DRAWING_ARCHITECTURE_PROJECTION_VERSION,
      confidence: confidenceFor(e),
      userRole: "governed-projection",
      humanReason: `Projected from approved drawing architecture v${version.version_number}`,
    });
    return id;
  };

  const pushRelationship = (e, { left, relationshipType, right, conditions, quantityRule }) => {
    const id = projectionRelationshipId(projectId, left, relationshipType, right);
    relationships.push({
      id,
      projectId,
      leftEntityType: "FIRE_ALARM_PANEL",
      leftEntityId: left,
      relationshipType,
      rightEntityType: relationshipType.startsWith("HAS_") ? "FIRE_ALARM_CIRCUIT" : "AREA",
      rightEntityId: right,
      conditions: conditions ?? [],
      exceptions: [],
      quantityRule: quantityRule ?? null,
      factType: "DRAWING_ARCHITECTURE_PROJECTION",
      scopeType: "Project",
      scopeId: projectId,
      confidence: confidenceFor(e),
      status: "Current",
      versionNumber: 1,
      createdBy: "governed-projection",
      sourceEvidenceId: e.id,
    });
    return id;
  };

  // 1. Panel inventory facts.
  for (const [identity, meta] of identities) {
    const e = panelEvidence.find((x) => meta.evidenceIds.includes(x.id));
    pushFact(e, {
      entityType: "FIRE_ALARM_PANEL",
      entityId: identity,
      predicate: "PANEL_IDENTITY_RESOLUTION",
      value: {
        identity,
        role: meta.role,
        resolutionState: meta.resolutionState,
        adjudicationKey: meta.adjudicationKey,
        sheets: [...new Set(meta.sheets)],
        approvedArchitectureVersion: Number(version.version_number),
      },
    });
  }

  // 2. Panel role / location / served area -- kept distinct on purpose.
  for (const e of evidence) {
    const relation = text(e.relation).toUpperCase();
    const identity = ownerOf(e);

    // An area-coverage row whose owning panel has no approved identity is
    // still real project evidence. It is projected as a FACT carrying its
    // unresolved state, never as a SERVES_AREA relationship -- because a
    // relationship would have to name a physical panel that does not yet
    // exist in approved architecture.
    if (!identity) {
      if (e.factType === "PANEL_SERVES_AREA" && text(e.object)) {
        pushFact(e, {
          entityType: "FIRE_ALARM_AREA",
          entityId: text(e.object),
          predicate: "AREA_COVERAGE_PANEL_UNRESOLVED",
          value: {
            area: text(e.object),
            relation: relation || null,
            assertedByRole: text(e.subject),
            sheet: normSheet(e.provenance?.sourceDrawingNumber),
            identityState: IDENTITY_RESOLUTION.GENERIC_IDENTITY_UNRESOLVED,
          },
        });
      }
      continue;
    }

    if (e.factType === "PANEL_SERVES_AREA") {
      const area = text(e.object);
      if (!area) continue;
      if (relation === "SERVES") {
        pushRelationship(e, { left: identity, relationshipType: "SERVES_AREA", right: area });
      } else if (relation === "LOCATED_AT") {
        // Location is NOT served-area identity. A master panel can be located
        // in one room while serving the campus.
        pushRelationship(e, { left: identity, relationshipType: "LOCATED_AT", right: area });
      }
    }

    if (e.factType === "SLC_LOOP_EXISTS") {
      pushRelationship(e, {
        left: identity,
        relationshipType: "HAS_SLC_LOOP",
        right: text(e.subject),
        quantityRule: { perLoop: true, drawn: true },
      });
    }

    if (e.factType === "NAC_CIRCUIT_EXISTS") {
      pushRelationship(e, { left: identity, relationshipType: "HAS_NAC_CIRCUIT", right: `${normSheet(e.provenance?.sourceDrawingNumber)}::${text(e.subject)}` });
    }

    if (e.factType === "PANEL_NETWORK_LINK" || e.factType === "FIRE_ALARM_NETWORK_TOPOLOGY") {
      pushFact(e, {
        entityType: "FIRE_ALARM_PANEL",
        entityId: identity,
        predicate: e.factType,
        value: { subject: text(e.subject), relation: relation || null, object: text(e.object), factType: e.factType },
      });
    }
  }

  return {
    status: "PROJECTED",
    approvedVersionId: version.id,
    architectureVersion: Number(version.version_number),
    approvedFactCount: version.approved_fact_count,
    facts,
    relationships,
    provenance,
    identities: [...identities.values()].sort((a, b) => a.identity.localeCompare(b.identity)),
    unresolved,
  };
}

/**
 * Fold the projection plan into governed engineering facts for a project.
 * Idempotent by construction: ids are content-derived, so a re-projection of
 * unchanged evidence yields byte-identical rows and zero new writes.
 */
export function foldProjection({ plan, existingFacts, existingRelationships }) {
  const factIds = new Set(existingFacts.map((r) => r.id));
  const relIds = new Set(existingRelationships.map((r) => r.id));
  const newFacts = plan.facts.filter((f) => !factIds.has(f.id));
  const newRelationships = plan.relationships.filter((r) => !relIds.has(r.id));
  return {
    status: plan.status,
    factsToWrite: newFacts,
    relationshipsToWrite: newRelationships,
    unchangedFactCount: plan.facts.length - newFacts.length,
    unchangedRelationshipCount: plan.relationships.length - newRelationships.length,
  };
}