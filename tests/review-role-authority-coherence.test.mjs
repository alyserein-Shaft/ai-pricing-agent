// Authority coherence: there must be exactly one role authority, not two that
// drift apart.
//
// `worker/project-authority.mjs` resolves a durable project role and decides who
// may approve technical safety, commercial price and a quotation.
// `app/domain/review-workflow.mjs` separately decided, in a hand-maintained table,
// who may satisfy a review item's `required_role`. The two disagreed, and the
// disagreement was not cosmetic:
//
//   * "Technical Reviewer" and "Senior Technical Reviewer" are the canonical
//     `required_role` values for a technical review, and both are technical
//     approvers, yet neither appeared in any permitted list. A review item
//     requiring a Technical Reviewer could only ever be decided by an
//     Engineering Reviewer, a Technical Manager, or an Administrator.
//   * `resolveProjectAuthority` hands every project *owner* the "Project Manager"
//     role, and "Project Manager" is a technical, commercial and quotation
//     approver -- yet it could not discharge any review gate at all. The owner
//     was authorized to approve a quotation whose review they could not close.
//   * "Management" is a technical approver but could not decide a technical
//     review.
//
// These tests assert the coherence *property* rather than a copied list, so the
// gate keeps holding if the vocabulary changes later.
import assert from "node:assert/strict";
import test from "node:test";

import { validateReviewDecisionSubmission } from "../app/domain/review-workflow.mjs";
import {
  COMMERCIAL_APPROVAL_ROLES,
  PROJECT_ROLE_VOCABULARY,
  QUOTATION_APPROVAL_ROLES,
  REVIEW_REQUIRED_ROLES_BY_STAGE,
  TECHNICAL_APPROVAL_ROLES,
  resolveReviewDecisionRoles,
} from "../app/domain/project-roles.mjs";
import {
  canApproveCommercialPrice,
  canApproveQuotation,
  canApproveTechnicalSafety,
} from "../worker/project-authority.mjs";

const decisionFor = (stage) => (stage === "technical"
  ? { type: "Approve Technical Match", outcome: "Approved" }
  : { type: "Approve Commercial", outcome: "Approved" });

// A required role that is itself the stage's own reviewer is the most direct
// statement of intent available: if a review item asks for a "Technical
// Reviewer", that role must be able to act as one.
const requiredRolesFor = (stage) => (stage === "technical"
  ? ["Technical Reviewer", "Senior Technical Reviewer", "Engineering Reviewer", "Technical Manager"]
  : ["Commercial Reviewer", "Commercial Manager", "Commercial Approver", "Management", "Administrator"]);

test("a role the project authority trusts to approve may discharge the matching review gate", () => {
  for (const stage of ["technical", "commercial"]) {
    const approvers = stage === "technical" ? TECHNICAL_APPROVAL_ROLES : COMMERCIAL_APPROVAL_ROLES;
    for (const currentRole of approvers) {
      for (const requiredRole of requiredRolesFor(stage)) {
        const result = validateReviewDecisionSubmission({
          requiredRole,
          currentRole,
          decision: decisionFor(stage),
        });
        assert.equal(
          result.permitted,
          true,
          `${currentRole} is authorized by the project authority to approve ${stage} work, `
          + `so it must be able to decide a ${stage} review requiring ${requiredRole} `
          + `(errors: ${result.errors.join(", ")})`,
        );
      }
    }
  }
});

test("the canonical reviewer roles can decide reviews that name them as the required role", () => {
  for (const [requiredRole, currentRole] of [
    ["Technical Reviewer", "Technical Reviewer"],
    ["Senior Technical Reviewer", "Senior Technical Reviewer"],
    ["Engineering Reviewer", "Engineering Reviewer"],
    ["Technical Manager", "Technical Manager"],
    ["Commercial Reviewer", "Commercial Reviewer"],
    ["Commercial Manager", "Commercial Manager"],
    ["Commercial Approver", "Commercial Approver"],
  ]) {
    const stage = requiredRole.startsWith("Commercial") ? "commercial" : "technical";
    const result = validateReviewDecisionSubmission({ requiredRole, currentRole, decision: decisionFor(stage) });
    assert.equal(result.permitted, true, `${requiredRole} must be able to decide a review requiring ${requiredRole} (errors: ${result.errors.join(", ")})`);
  }
});

test("every project role that can approve anything is able to decide at least one review", () => {
  const everyRequiredRole = [
    ...REVIEW_REQUIRED_ROLES_BY_STAGE.technical,
    ...REVIEW_REQUIRED_ROLES_BY_STAGE.commercial,
  ];
  const decidable = (role) => everyRequiredRole.some(
    (requiredRole) => (resolveReviewDecisionRoles(requiredRole) || []).includes(role),
  );
  const approvers = new Set([
    ...TECHNICAL_APPROVAL_ROLES,
    ...COMMERCIAL_APPROVAL_ROLES,
    ...QUOTATION_APPROVAL_ROLES,
  ]);
  const lockedOut = PROJECT_ROLE_VOCABULARY.filter((role) => approvers.has(role) && !decidable(role));
  assert.deepEqual(lockedOut, [], "these roles are trusted to approve work but can never close the review that authorises it");
});

test("an unrecognised review requirement is refused rather than treated as unrestricted", () => {
  const known = [...REVIEW_REQUIRED_ROLES_BY_STAGE.technical, ...REVIEW_REQUIRED_ROLES_BY_STAGE.commercial];
  for (const requiredRole of ["", "Estimator", "Project Manager", "Some Future Role", "  ", "Technical Reviewer"]) {
    if (known.includes(requiredRole.trim())) continue;
    const result = validateReviewDecisionSubmission({
      requiredRole,
      currentRole: "Administrator",
      decision: decisionFor("technical"),
    });
    assert.equal(result.permitted, false, `unknown requirement ${JSON.stringify(requiredRole)} must not be satisfiable`);
    assert.ok(result.errors.includes("REVIEW_REQUIRED_ROLE_UNSUPPORTED"), `unknown requirement ${JSON.stringify(requiredRole)} must be reported as unsupported`);
  }
});

test("a commercial role still cannot decide a technical review, and the reverse", () => {
  const crossStage = [
    { requiredRole: "Technical Reviewer", currentRole: "Commercial Approver", stage: "technical" },
    { requiredRole: "Commercial Approver", currentRole: "Technical Manager", stage: "commercial" },
  ];
  for (const { requiredRole, currentRole, stage } of crossStage) {
    const result = validateReviewDecisionSubmission({ requiredRole, currentRole, decision: decisionFor(stage) });
    assert.equal(result.permitted, false, `${currentRole} must not decide a ${stage} review`);
  }
});

test("a technical review cannot be decided by declaring a commercial required role", () => {
  const result = validateReviewDecisionSubmission({
    requiredRole: "Technical Manager",
    currentRole: "Technical Manager",
    decision: decisionFor("commercial"),
  });
  assert.equal(result.permitted, false, "a review item requiring a technical role does not become commercial by choosing a commercial decision type");
  assert.ok(result.errors.includes("REVIEW_DECISION_ROLE_MISMATCH"));
});

test("the project authority module and the shared role module cannot disagree", () => {
  // project-authority is the server-side resolver; it must delegate to the one
  // shared vocabulary rather than keeping a second copy of the same sets.
  for (const role of PROJECT_ROLE_VOCABULARY) {
    assert.equal(
      canApproveTechnicalSafety(role),
      TECHNICAL_APPROVAL_ROLES.includes(role),
      `technical approval for ${role} differs between the two modules`,
    );
    assert.equal(
      canApproveCommercialPrice(role),
      COMMERCIAL_APPROVAL_ROLES.includes(role),
      `commercial approval for ${role} differs between the two modules`,
    );
    assert.equal(
      canApproveQuotation(role),
      QUOTATION_APPROVAL_ROLES.includes(role),
      `quotation approval for ${role} differs between the two modules`,
    );
  }
});
