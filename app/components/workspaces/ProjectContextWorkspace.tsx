import { useEffect, useState } from "react";

type ProjectContextExtraction = {
  id: string;
  original_filename: string;
  version_number: number;
  review_status: string;
  summary?: {
    extractedFacts?: number;
    needsReview?: number;
    aiInterpretationRequired?: number;
    missingFields?: string[];
    sourceSheet?: string;
  };
};

type ProjectContextFact = {
  id: string;
  extraction_version_id: string;
  fact_key: string;
  label: string;
  extracted_value: string;
  normalized_value?: string | null;
  source_sheet: string;
  source_row: number;
  source_cell: string;
  source_label_cell?: string | null;
  confidence: number;
  requires_ai_interpretation: number;
  review_status: string;
  reviewed_value?: string | null;
  review_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
};

type ProjectContextAction = {
  fact: ProjectContextFact;
  action: "approve" | "edit" | "reject";
  reviewedValue: string;
  reason: string;
  saving: boolean;
  error: string;
};

type ProjectContextResponse = {
  extractions: ProjectContextExtraction[];
  facts: ProjectContextFact[];
};

const humanize = (value: string) =>
  value
    .replace(/_available$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());

const generalKeys = new Set([
  "lead_score",
  "project_name",
  "project_status",
  "project_category",
  "project_location",
  "scope",
  "timeline",
]);

const contactKeys = new Set([
  "contact_name",
  "company_name",
  "company_role",
  "contact_email",
  "contact_phone",
  "decision_maker",
  "quoted_before",
]);

const groupFor = (fact: ProjectContextFact) => {
  if (generalKeys.has(fact.fact_key)) return "Project overview";
  if (contactKeys.has(fact.fact_key)) return "Client and authority";
  if (fact.fact_key.endsWith("_available")) {
    return "Available project evidence";
  }
  return "Commercial instructions";
};

export function ProjectContextWorkspace({
  projectId,
}: {
  projectId: string;
}) {
  const [data, setData] = useState<ProjectContextResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewAction, setReviewAction] =
    useState<ProjectContextAction | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/project-context`,
        { cache: "no-store" },
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body?.error?.message ||
            "Project Context could not be loaded.",
        );
      }

      setData({
        extractions: body.extractions || [],
        facts: body.facts || [],
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Project Context could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const openReview = (
    fact: ProjectContextFact,
    action: ProjectContextAction["action"],
  ) => {
    setReviewAction({
      fact,
      action,
      reviewedValue:
        action === "edit"
          ? fact.reviewed_value || fact.extracted_value
          : "",
      reason: "",
      saving: false,
      error: "",
    });
  };

  const submitReview = async () => {
    if (!reviewAction || reviewAction.saving) return;

    const reason = reviewAction.reason.replace(/\s+/g, " ").trim();
    if (reason.length < 10) {
      setReviewAction(current =>
        current
          ? {
              ...current,
              error:
                "Enter a substantive review reason of at least 10 characters.",
            }
          : current,
      );
      return;
    }

    if (
      reviewAction.action === "edit" &&
      !reviewAction.reviewedValue.trim()
    ) {
      setReviewAction(current =>
        current
          ? {
              ...current,
              error: "Enter the corrected reviewed value.",
            }
          : current,
      );
      return;
    }

    setReviewAction(current =>
      current
        ? { ...current, saving: true, error: "" }
        : current,
    );

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(
          projectId,
        )}/project-context/facts/${encodeURIComponent(
          reviewAction.fact.id,
        )}/${reviewAction.action}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            reason,
            reviewedValue:
              reviewAction.action === "edit"
                ? reviewAction.reviewedValue.trim()
                : undefined,
          }),
        },
      );

      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body?.error?.message ||
            "Project Context review could not be saved.",
        );
      }

      setReviewAction(null);
      await load();
    } catch (reason) {
      setReviewAction(current =>
        current
          ? {
              ...current,
              saving: false,
              error:
                reason instanceof Error
                  ? reason.message
                  : "Project Context review could not be saved.",
            }
          : current,
      );
    }
  };

  if (loading) {
    return (
      <section
        className="project-context-workspace"
        aria-label="Project Context extraction"
      >
        <p>Loading extracted project context…</p>
      </section>
    );
  }

  if (!data?.extractions.length && !error) return null;

  if (error) {
    return (
      <section
        className="project-context-workspace project-context-error"
        aria-label="Project Context extraction"
      >
        <strong>Project Context is unavailable</strong>
        <p>{error}</p>
        <button className="secondary-action" onClick={() => void load()}>
          Retry
        </button>
      </section>
    );
  }

  const extraction = data.extractions[0];
  const activeFacts = data.facts.filter(
    fact => fact.extraction_version_id === extraction.id,
  );

  const groups = [
    "Project overview",
    "Client and authority",
    "Commercial instructions",
    "Available project evidence",
  ].map(name => ({
    name,
    facts: activeFacts.filter(fact => groupFor(fact) === name),
  })).filter(group => group.facts.length);

  return (
    <section
      className="project-context-workspace"
      aria-labelledby="project-context-title"
    >
      <header className="project-context-heading">
        <div>
          <small>GOVERNED PROJECT CONTEXT</small>
          <h2 id="project-context-title">Extracted project information</h2>
          <p>
            These facts are separate from BOQ items. They remain review-only
            until explicitly verified.
          </p>
        </div>
        <div className="project-context-source">
          <strong>{extraction.original_filename}</strong>
          <span>
            extraction v{extraction.version_number} ·{" "}
            {extraction.review_status}
          </span>
          <button className="secondary-action" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </header>

      <div className="project-context-summary">
        <article>
          <small>Extracted facts</small>
          <strong>{activeFacts.length}</strong>
        </article>
        <article>
          <small>Needs review</small>
          <strong>
            {
              activeFacts.filter(
                fact => fact.review_status === "Needs Review",
              ).length
            }
          </strong>
        </article>
        <article>
          <small>AI interpretation</small>
          <strong>
            {
              activeFacts.filter(
                fact => Number(fact.requires_ai_interpretation) === 1,
              ).length
            }
          </strong>
        </article>
        <article>
          <small>Source sheet</small>
          <strong>
            {extraction.summary?.sourceSheet || "Recorded"}
          </strong>
        </article>
      </div>

      {groups.map(group => (
        <section className="project-context-group" key={group.name}>
          <header>
            <h3>{group.name}</h3>
            <span>{group.facts.length} fact(s)</span>
          </header>

          <div className="project-context-facts">
            {group.facts.map(fact => (
              <article
                key={fact.id}
                className={
                  Number(fact.requires_ai_interpretation) === 1
                    ? "requires-ai-review"
                    : ""
                }
              >
                <header>
                  <div>
                    <small>{humanize(fact.fact_key)}</small>
                    <strong>
                      {fact.review_status === "Edited"
                        ? fact.reviewed_value
                        : fact.extracted_value}
                    </strong>
                    {fact.review_status === "Edited" && (
                      <span className="project-context-original">
                        Extracted: {fact.extracted_value}
                      </span>
                    )}
                  </div>
                  <span className="review-pending">
                    {fact.review_status}
                  </span>
                </header>

                <footer>
                  <span>
                    Source: {fact.source_sheet} · {fact.source_cell}
                    {fact.source_row ? ` · row ${fact.source_row}` : ""}
                  </span>
                  <span>Confidence: {fact.confidence}%</span>
                </footer>

                {Number(fact.requires_ai_interpretation) === 1 && (
                  <p className="project-context-ai-note">
                    Requires AI interpretation and human confirmation before
                    commercial use.
                  </p>
                )}

                <div className="project-context-review-actions">
                  <button
                    onClick={() => openReview(fact, "approve")}
                    disabled={fact.review_status === "Approved"}
                  >
                    {fact.review_status === "Approved"
                      ? "Approved"
                      : "Approve fact"}
                  </button>
                  <button
                    className="secondary-action"
                    onClick={() => openReview(fact, "edit")}
                  >
                    Edit value
                  </button>
                  <button
                    className="secondary-action project-context-reject"
                    onClick={() => openReview(fact, "reject")}
                    disabled={fact.review_status === "Rejected"}
                  >
                    {fact.review_status === "Rejected"
                      ? "Rejected"
                      : "Reject fact"}
                  </button>
                </div>

                {fact.review_reason && (
                  <p className="project-context-review-proof">
                    Last review: {fact.review_reason}
                    {fact.reviewed_at
                      ? ` · ${new Date(
                          fact.reviewed_at,
                        ).toLocaleString()}`
                      : ""}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

      {extraction.summary?.missingFields?.length ? (
        <aside className="project-context-missing">
          <strong>Missing project context</strong>
          <p>
            {extraction.summary.missingFields
              .map(humanize)
              .join(" · ")}
          </p>
        </aside>
      ) : null}

      {reviewAction && (
        <div
          className="match-overlay project-context-review-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-context-review-title"
        >
          <button
            className="drawer-scrim"
            aria-label="Close Project Context review"
            disabled={reviewAction.saving}
            onClick={() => setReviewAction(null)}
          />
          <section className="match-panel project-context-review-panel">
            <header className="match-header">
              <div>
                <small>GOVERNED PROJECT CONTEXT REVIEW</small>
                <h2 id="project-context-review-title">
                  {reviewAction.action === "approve"
                    ? "Approve extracted fact"
                    : reviewAction.action === "edit"
                      ? "Correct extracted fact"
                      : "Reject extracted fact"}
                </h2>
                <p>
                  {humanize(reviewAction.fact.fact_key)} · source{" "}
                  {reviewAction.fact.source_sheet} ·{" "}
                  {reviewAction.fact.source_cell}
                </p>
              </div>
              <button
                aria-label="Close Project Context review"
                disabled={reviewAction.saving}
                onClick={() => setReviewAction(null)}
              >
                ×
              </button>
            </header>

            <div className="project-context-review-body">
              <section>
                <small>Immutable extracted value</small>
                <strong>
                  {reviewAction.fact.extracted_value}
                </strong>
              </section>

              {reviewAction.action === "edit" && (
                <label>
                  Corrected reviewed value
                  <textarea
                    aria-label="Corrected Project Context value"
                    value={reviewAction.reviewedValue}
                    disabled={reviewAction.saving}
                    onChange={event =>
                      setReviewAction(current =>
                        current
                          ? {
                              ...current,
                              reviewedValue: event.target.value,
                              error: "",
                            }
                          : current,
                      )
                    }
                  />
                </label>
              )}

              <label>
                Mandatory review reason
                <textarea
                  aria-label="Project Context review reason"
                  placeholder="Explain the source evidence supporting this decision."
                  value={reviewAction.reason}
                  disabled={reviewAction.saving}
                  onChange={event =>
                    setReviewAction(current =>
                      current
                        ? {
                            ...current,
                            reason: event.target.value,
                            error: "",
                          }
                        : current,
                    )
                  }
                />
              </label>

              {reviewAction.error && (
                <p className="managed-document-error">
                  {reviewAction.error}
                </p>
              )}

              <p className="project-context-review-safety">
                This decision updates only the governed Project Context fact.
                It does not alter the original extraction, BOQ rows or project
                metadata automatically.
              </p>
            </div>

            <footer className="preview-actions">
              <button
                className="secondary-action"
                disabled={reviewAction.saving}
                onClick={() => setReviewAction(null)}
              >
                Cancel
              </button>
              <button
                disabled={
                  reviewAction.saving ||
                  reviewAction.reason.trim().length < 10 ||
                  (reviewAction.action === "edit" &&
                    !reviewAction.reviewedValue.trim())
                }
                onClick={() => void submitReview()}
              >
                {reviewAction.saving
                  ? "Saving review…"
                  : reviewAction.action === "approve"
                    ? "Approve fact"
                    : reviewAction.action === "edit"
                      ? "Save corrected value"
                      : "Reject fact"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
