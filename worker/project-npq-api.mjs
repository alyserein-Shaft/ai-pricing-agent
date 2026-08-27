import { authenticateLibraryActor } from "./library-auth.mjs";
import {
  NPQ_ENGINE_VERSION,
  normalizeNpQProfile,
  npqFingerprint,
  npqReadiness,
  validateNpQProfile,
} from "../app/domain/project-npq-engine.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });

const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const bodyOf = async request => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const parse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const access = (db, projectId, userId) =>
  db
    .prepare(`
      SELECT
        p.id,
        p.name,
        p.organization_id,
        p.system_domain,
        p.owner_user_id,
        COALESCE(
          pm.role,
          CASE WHEN p.owner_user_id=? THEN 'Project Manager' END
        ) role
      FROM projects p
      LEFT JOIN project_members pm
        ON pm.project_id=p.id
       AND pm.user_id=?
       AND pm.status='Active'
       AND pm.revoked_at IS NULL
      WHERE p.id=?
        AND p.archived_at IS NULL
        AND (p.owner_user_id=? OR pm.id IS NOT NULL)
    `)
    .bind(userId, userId, projectId, userId)
    .first();

const hydrate = row => {
  if (!row) return null;
  const profile = {
    country: row.country || "",
    city: row.city || "",
    location: row.location || "",
    inquirySubject: row.inquiry_subject || "",
    inquiryReceived: row.inquiry_received || "",
    contactName: row.contact_name || "",
    contactEmail: row.contact_email || "",
    contactPhone: row.contact_phone || "",

    primarySystem: row.primary_system,
    additionalSystems: parse(row.additional_systems_json, []),
    deliveryScope: row.delivery_scope,
    scopeNotes: row.scope_notes || "",

    manufacturerStrategy: row.manufacturer_strategy,
    preferredManufacturer: row.preferred_manufacturer || "",
    approvedManufacturers: parse(row.approved_manufacturers_json, []),
    manufacturerNotes: row.manufacturer_notes || "",

    pricingStrategy: row.pricing_strategy,
    primaryPricingSourceType: row.primary_pricing_source_type || "",
    primaryPricingSourceId: row.primary_pricing_source_id || "",
    fallbackPricingSources: parse(row.fallback_pricing_sources_json, []),
    projectCurrency: row.project_currency,
    pricingNotes: row.pricing_notes || "",

    expectedEvidence: parse(row.expected_evidence_json, []),
    boqAvailability: row.boq_availability,
    drawingAvailability: row.drawing_availability,
  };

  return {
    id: row.id,
    projectId: row.project_id,
    version: Number(row.version_number),
    status: row.status,
    fingerprint: row.input_fingerprint,
    profile,
    readiness: npqReadiness(profile, row.status),
    confirmationReason: row.confirmation_reason || null,
    confirmedBy: row.confirmed_by || null,
    confirmedAt: row.confirmed_at || null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    supersededAt: row.superseded_at || null,
  };
};

const currentDraft = (db, projectId) =>
  db
    .prepare(`
      SELECT *
      FROM project_npq_profile_versions
      WHERE project_id=?
        AND status='Draft'
        AND superseded_at IS NULL
      ORDER BY version_number DESC
      LIMIT 1
    `)
    .bind(projectId)
    .first();

const currentConfirmed = (db, projectId) =>
  db
    .prepare(`
      SELECT *
      FROM project_npq_profile_versions
      WHERE project_id=?
        AND status='Confirmed'
        AND superseded_at IS NULL
      ORDER BY version_number DESC
      LIMIT 1
    `)
    .bind(projectId)
    .first();

const nextVersion = async (db, projectId) =>
  Number(
    (
      await db
        .prepare(`
          SELECT COALESCE(MAX(version_number),0)+1 version
          FROM project_npq_profile_versions
          WHERE project_id=?
        `)
        .bind(projectId)
        .first()
    )?.version || 1,
  );

const event = (
  db,
  {
    projectId,
    profileVersionId,
    action,
    previousValue,
    newValue,
    reason,
    actor,
    role,
    requestId,
  },
) =>
  db
    .prepare(`
      INSERT INTO project_npq_profile_events (
        id,
        project_id,
        profile_version_id,
        action,
        previous_value,
        new_value,
        reason,
        actor_user_id,
        actor_role,
        request_id
      )
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `)
    .bind(
      id("npqEvent"),
      projectId,
      profileVersionId,
      action,
      previousValue ? JSON.stringify(previousValue) : null,
      JSON.stringify(newValue),
      reason,
      actor,
      role,
      requestId,
    );

export async function handleProjectNpQApi(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/npq(?:\/(draft|confirm|history))?$/,
  );
  if (!match) return null;

  if (!env.DB) {
    return json(
      {
        error: {
          code: "NPQ_STORAGE_UNAVAILABLE",
          message: "NPQ project context storage is unavailable.",
        },
      },
      503,
    );
  }

  const auth = await authenticateLibraryActor(request, env);
  if (auth.error) return json({ error: auth.error }, auth.error.status);

  const actor = auth.actor;
  const projectId = decodeURIComponent(match[1]);
  const operation = match[2] || "get";
  const project = await access(env.DB, projectId, actor.id);

  if (!project) {
    return json(
      {
        error: {
          code: "PROJECT_NOT_FOUND",
          message: "Project was not found or is not available to this account.",
        },
      },
      404,
    );
  }

  const role = project.role || "Estimator";

  if (request.method === "GET" && operation === "get") {
    const [draft, confirmed] = await Promise.all([
      currentDraft(env.DB, projectId),
      currentConfirmed(env.DB, projectId),
    ]);

    return json({
      engineVersion: NPQ_ENGINE_VERSION,
      project: {
        id: project.id,
        name: project.name,
        systemDomain: project.system_domain,
      },
      draft: hydrate(draft),
      confirmed: hydrate(confirmed),
      authority: confirmed
        ? {
            state: "CONFIRMED",
            version: Number(confirmed.version_number),
            fingerprint: confirmed.input_fingerprint,
          }
        : {
            state: "NOT_CONFIRMED",
            version: null,
            fingerprint: null,
          },
    });
  }

  if (request.method === "GET" && operation === "history") {
    const rows = await env.DB
      .prepare(`
        SELECT *
        FROM project_npq_profile_versions
        WHERE project_id=?
        ORDER BY version_number DESC
        LIMIT 100
      `)
      .bind(projectId)
      .all();

    return json({
      engineVersion: NPQ_ENGINE_VERSION,
      versions: (rows.results || []).map(hydrate),
    });
  }

  if (
    request.method === "POST" &&
    operation === "draft"
  ) {
    const payload = await bodyOf(request);
    const validation = validateNpQProfile(payload.profile || payload);
    if (!validation.ok) {
      return json(
        {
          error: {
            code: validation.code,
            message: `NPQ draft is missing required fields: ${validation.missing.join(", ")}.`,
            missing: validation.missing,
          },
        },
        422,
      );
    }

    const profile = normalizeNpQProfile(validation.profile);
    const fingerprint = await npqFingerprint(profile);
    const existingDraft = await currentDraft(env.DB, projectId);

    if (existingDraft?.input_fingerprint === fingerprint) {
      return json({
        engineVersion: NPQ_ENGINE_VERSION,
        draft: hydrate(existingDraft),
        idempotent: true,
      });
    }

    const version = await nextVersion(env.DB, projectId);
    const profileId = id("npqProfile");
    const requestId =
      request.headers.get("x-request-id") ||
      String(payload.requestId || "") ||
      id("request");
    const reason =
      String(payload.reason || "").trim() ||
      "NPQ onboarding draft saved";
    const stamp = now();

    const statements = [];

    if (existingDraft) {
      statements.push(
        env.DB
          .prepare(`
            UPDATE project_npq_profile_versions
            SET superseded_at=?
            WHERE id=?
              AND status='Draft'
              AND superseded_at IS NULL
          `)
          .bind(stamp, existingDraft.id),
      );
    }

    statements.push(
      env.DB
        .prepare(`
          INSERT INTO project_npq_profile_versions (
            id,
            project_id,
            version_number,
            country,
            city,
            location,
            inquiry_subject,
            inquiry_received,
            contact_name,
            contact_email,
            contact_phone,
            primary_system,
            additional_systems_json,
            delivery_scope,
            scope_notes,
            manufacturer_strategy,
            preferred_manufacturer,
            approved_manufacturers_json,
            manufacturer_notes,
            pricing_strategy,
            primary_pricing_source_type,
            primary_pricing_source_id,
            fallback_pricing_sources_json,
            project_currency,
            pricing_notes,
            expected_evidence_json,
            boq_availability,
            drawing_availability,
            status,
            input_fingerprint,
            created_by,
            created_at
          )
          VALUES (
            ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
            'Draft',?,?,?
          )
        `)
        .bind(
          profileId,
          projectId,
          version,
          profile.country || null,
          profile.city || null,
          profile.location || null,
          profile.inquirySubject || null,
          profile.inquiryReceived || null,
          profile.contactName || null,
          profile.contactEmail || null,
          profile.contactPhone || null,
          profile.primarySystem,
          JSON.stringify(profile.additionalSystems),
          profile.deliveryScope,
          profile.scopeNotes || null,
          profile.manufacturerStrategy,
          profile.preferredManufacturer || null,
          JSON.stringify(profile.approvedManufacturers),
          profile.manufacturerNotes || null,
          profile.pricingStrategy,
          profile.primaryPricingSourceType || null,
          profile.primaryPricingSourceId || null,
          JSON.stringify(profile.fallbackPricingSources),
          profile.projectCurrency,
          profile.pricingNotes || null,
          JSON.stringify(profile.expectedEvidence),
          profile.boqAvailability,
          profile.drawingAvailability,
          fingerprint,
          actor.id,
          stamp,
        ),
    );

    statements.push(
      event(env.DB, {
        projectId,
        profileVersionId: profileId,
        action: existingDraft ? "Draft Revised" : "Draft Created",
        previousValue: existingDraft ? hydrate(existingDraft) : null,
        newValue: {
          version,
          status: "Draft",
          fingerprint,
          profile,
        },
        reason,
        actor: actor.id,
        role,
        requestId,
      }),
    );

    await env.DB.batch(statements);

    const created = await env.DB
      .prepare("SELECT * FROM project_npq_profile_versions WHERE id=?")
      .bind(profileId)
      .first();

    return json(
      {
        engineVersion: NPQ_ENGINE_VERSION,
        draft: hydrate(created),
        confirmed: hydrate(await currentConfirmed(env.DB, projectId)),
        idempotent: false,
      },
      201,
    );
  }

  if (
    request.method === "POST" &&
    operation === "confirm"
  ) {
    const payload = await bodyOf(request);
    const reason = String(payload.reason || "").trim();

    if (reason.length < 5) {
      return json(
        {
          error: {
            code: "NPQ_CONFIRMATION_REASON_REQUIRED",
            message: "Record a substantive reason before confirming NPQ strategy.",
          },
        },
        422,
      );
    }

    const draft = await currentDraft(env.DB, projectId);
    if (!draft) {
      return json(
        {
          error: {
            code: "NPQ_DRAFT_REQUIRED",
            message: "Save an NPQ draft before confirmation.",
          },
        },
        409,
      );
    }

    const hydratedDraft = hydrate(draft);
    const validation = validateNpQProfile(hydratedDraft.profile, {
      forConfirmation: true,
    });

    if (!validation.ok) {
      return json(
        {
          error: {
            code: validation.code,
            message: `NPQ cannot be confirmed until required fields are complete: ${validation.missing.join(", ")}.`,
            missing: validation.missing,
          },
        },
        422,
      );
    }

    if (
      payload.expectedVersion !== undefined &&
      Number(payload.expectedVersion) !== Number(draft.version_number)
    ) {
      return json(
        {
          error: {
            code: "NPQ_VERSION_STALE",
            message: "The NPQ draft changed. Refresh before confirming.",
          },
        },
        409,
      );
    }

    if (
      payload.expectedFingerprint &&
      String(payload.expectedFingerprint) !== draft.input_fingerprint
    ) {
      return json(
        {
          error: {
            code: "NPQ_SELECTION_STALE",
            message: "The NPQ strategy changed. Refresh before confirming.",
          },
        },
        409,
      );
    }

    const previousConfirmed = await currentConfirmed(env.DB, projectId);
    const stamp = now();
    const requestId =
      request.headers.get("x-request-id") ||
      String(payload.requestId || "") ||
      id("request");

    const statements = [];

    if (previousConfirmed) {
      statements.push(
        env.DB
          .prepare(`
            UPDATE project_npq_profile_versions
            SET superseded_at=?
            WHERE id=?
              AND status='Confirmed'
              AND superseded_at IS NULL
          `)
          .bind(stamp, previousConfirmed.id),
      );
    }

    statements.push(
      env.DB
        .prepare(`
          UPDATE project_npq_profile_versions
          SET
            status='Confirmed',
            confirmation_reason=?,
            confirmed_by=?,
            confirmed_at=?
          WHERE id=?
            AND status='Draft'
            AND superseded_at IS NULL
        `)
        .bind(reason, actor.id, stamp, draft.id),
    );

    statements.push(
      event(env.DB, {
        projectId,
        profileVersionId: draft.id,
        action: "NPQ Confirmed",
        previousValue: {
          status: "Draft",
          previousConfirmedVersion:
            previousConfirmed?.version_number || null,
        },
        newValue: {
          status: "Confirmed",
          version: Number(draft.version_number),
          fingerprint: draft.input_fingerprint,
        },
        reason,
        actor: actor.id,
        role,
        requestId,
      }),
    );

    await env.DB.batch(statements);

    const confirmed = await currentConfirmed(env.DB, projectId);

    return json({
      engineVersion: NPQ_ENGINE_VERSION,
      confirmed: hydrate(confirmed),
      authority: {
        state: "CONFIRMED",
        version: Number(confirmed.version_number),
        fingerprint: confirmed.input_fingerprint,
      },
    });
  }

  return json(
    {
      error: {
        code: "NPQ_OPERATION_NOT_FOUND",
        message: "NPQ operation not found.",
      },
    },
    404,
  );
}
