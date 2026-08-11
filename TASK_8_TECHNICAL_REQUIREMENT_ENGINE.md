# Task 8 — Technical Requirement Engine

## 1. Current logic audit

The existing client showed a small hard-coded requirement checklist. It did not derive per-item profiles from the canonical BOQ, specification, knowledge links, or project rules. Task 8 adds the authoritative path and leaves the showcase isolated.

## 2. Architecture

Approved BOQ item + approved requirement links + canonical facts/relationships → deterministic applicability → consolidation with source precedence → conflicts/missing data → clarifications/derived candidates/assumptions → component confidence → matching readiness → immutable reviewed profile.

## 3. Applicability model

Applicability stores requirement/item IDs, status, method, evidence, confidence, priority and review state. Suggested links never become confirmed automatically. Human-confirmed links are the only source of Confirmed Applicable requirements.

## 4. Priority model

Supported priorities are Critical Mandatory, Mandatory, Conditional Mandatory, Preferred, Optional, Informational, Prohibited, Derived, Assumed and Clarification Required. Safety-critical voltage, capacity, compatibility and standards constraints become Critical Mandatory.

## 5. Source precedence

Default precedence is approved clarification/addendum, latest specification, drawing, BOQ, approved vendor list, manufacturer evidence, previous project, organization rule, then AI inference. The map is explicit and project-overridable. Critical conflicts remain visible regardless of precedence.

## 6. Consolidation

Equivalent requirements consolidate by structured category/attribute or normalized statement. The governing source follows precedence while every supporting source and confidence remains attached.

## 7. Conflicts

Distinct normalized values for the same required attribute create blocking conflicts. Voltage and capacity conflicts are Critical. Technical impact, commercial impact, source values, recommended action and resolution state are retained.

## 8. Missing information

Category-specific rules evaluate identity, system, category, description, unit, quantity, product family, standards, compatibility and applicable technical fields. Missing values remain null and create source-based impacts, owners and clarification questions.

## 9. Clarifications

Questions cite the BOQ item and exact missing field or conflict. Generic unsupported questions are not generated.

## 10. Derived requirements

Derived outputs retain rule ID, inputs, logic, output, confidence and Needs Review status. Detector bases and outdoor environmental protection are supported without inventing ratings or approved products.

## 11. Assumptions

Non-blocking gaps can create zero-confidence Proposed assumptions. They require approval and expire when source evidence or an approved clarification is recorded.

## 12. Manufacturer and standards profile

Profiles aggregate structured manufacturer and standard records from confirmed consolidated requirements without inferring unstated editions or approval status.

## 13. Compatibility profile

Specification compatibility plus approved canonical relationships are retained separately with target, relationship, evidence, confidence and review state. Missing Fire Alarm panel/protocol targets block matching.

## 14. Accessories and quantities

Explicit and approved relationship accessories remain separate from derived accessories. Quantity logic is stored as a reviewable rule; derived quantities are never silently applied to the BOQ.

## 15. Matching readiness

Statuses are Ready for Matching, Ready with Warnings, Needs Technical Review, Missing Critical Information, Conflict Blocking, Classification Required, Not Applicable and Rejected. Readiness approval is a separate human decision and is rejected unless the computed state is Ready for Matching.

## 16. Confidence

The profile exposes item classification, extraction, applicability, attribute completeness, standards, compatibility, accessories and overall confidence. Overall uses the weakest component so missing safety evidence cannot be hidden by stronger unrelated signals.

## 17. Rule engine

Rules are typed, scoped, versioned and effective-dated with structured conditions/actions, priority, source fact, approver, status and test cases. Each execution stores input, output, rule version, status and duration.

## 18. Database changes

Migration `drizzle/0006_goofy_karma.sql` adds profile versions, applicability, consolidated requirements, issues, rules, executions, decisions and comparisons. All seven migrations apply cleanly: 60 tables and 152 indexes.

## 19. APIs

Item APIs generate/recalculate, retrieve current profile and history, compare versions, list applicability/missing/conflicts/clarifications/assumptions/derived/standards/manufacturers/compatibility/accessories, and approve readiness. Applicability and issue endpoints support audited review actions.

## 20. Queue and processing

Generation creates a durable processing run and history, then reports real stages: Collecting Sources, Resolving Applicability, Consolidating Requirements, Saving Profile and Completed/Needs Review/Failed. Input fingerprints make unchanged recalculation idempotent.

## 21. Frontend

The existing BOQ review workflow now offers profile generation and current-profile access for approved BOQ rows. Unapproved extraction rows cannot enter the requirement engine. Unrelated screens were not redesigned.

## 22. Security

Every route checks project ownership. Only approved source requirements are loaded. Human decisions require identity and reason. Global rules are not editable through project APIs. Assumptions, derived records and AI suggestions cannot self-approve. Historical versions remain immutable.

## 23. Tests and real-file evidence

Six focused Task 8 tests pass. The complete suite passes 280/280; build and lint pass. Direct validation used the supplied 90-item BOQ and 31-page/458-requirement specification. For “Smoke detectors (above ceiling),” 12 relevant source requirements produced six standards and eight accessory records. Matching was correctly blocked because the panel/protocol compatibility target is absent.

## 24. Implementation summary

- `app/domain/technical-requirement-engine.mjs`: deterministic profiles, consolidation, conflicts, missing data, derivation, confidence and readiness.
- `worker/technical-requirement-api.mjs`: processing, persistence, APIs, reviews, audit and comparison.
- `db/schema.ts` and migration 0006: immutable profile storage.
- `app/page.tsx`: focused generation/review entry points.
- `tests/technical-requirement-engine.test.mjs`: safety and integration contracts.

## 25. Known limitations

Drawing-derived applicability awaits structured drawing intelligence. No vector/AI semantic service is configured; structured deterministic signals remain authoritative. Rules are stored and core deterministic rules execute, but an administrative global-rule editor is deliberately absent. Matching, confidence/safety decisions and pricing are not implemented here.
