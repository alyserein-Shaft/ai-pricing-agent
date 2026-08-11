# Task 12 — Pricing and Costing Engine

Status: Complete. Migration, build, lint, focused verification and the full regression suite pass. Task 13 was subsequently completed without changing this engine's authority boundaries.

## 1. Current Pricing Audit

The previous Costing screen calculated `quantity × unit cost`, line markup, VAT and a project allowance in browser state. It already had useful safeguards for locked costs, exchange-rate evidence, supplier-award provenance, quotation fingerprints and contingency rationale. It lacked authoritative server calculations, explicit price-source selection, detailed components, scoped discount chains, scenarios, immutable pricing history and server approval.

## 2. Target Pricing Architecture

The deterministic domain engine performs calculations. The pricing API loads current project-owned BOQ, candidate, safety, technical approval, Product Library prices, exchange rates and scenario rules; calculates server-side; persists immutable inputs, versions, formulas and outputs; and exposes breakdown, history, comparison, approval, summary and export operations. The browser displays results but is not authoritative.

## 3. Price Source Selection Model

Sources are ranked by configurable precedence, then checked for product, project, region, quantity, approval, downstream use and validity. Ranking produces a recommendation only. A user must explicitly select a source ID; no source is silently chosen and the stored explanation records why it was eligible.

## 4. Discount Model

Sequential and additive chains preserve order, base, percentage, amount and remaining balance. Rules may be scoped by component, project, manufacturer, source and validity. Exclusive or conditional behavior is represented by scenario-controlled rule inclusion.

## 5. Material Cost Model

Original list price and currency are preserved. Approved conversion is applied without overwriting the original value. Material-only discounts produce net material unit cost, which is multiplied by validated quantity using controlled rounding.

## 6. Accessory Cost Model

Accessories are independent cost components with their own description, quantity, method, formula, source, assumptions and approval status. They are never hidden in material unless the controlled source explicitly models inclusion.

## 7. Service Cost Model

Installation, engineering, programming, testing, commissioning, integration, training, documentation, warranty, maintenance, supervision, management and authority support use fixed, per-item, hourly or percentage methods with persisted formulas.

## 8. Installation Cost Model

Installation is a traceable component evaluated from scenario inputs and a controlled rule. Unsupported methods fail closed instead of returning a guessed cost.

## 9. Freight and Logistics Model

Freight, customs, shipping, delivery, handling and related logistics are explicit components. Fixed and percentage bases are supported and source evidence is retained.

## 10. Overhead Model

Line overhead is explicit. Shared project overhead uses a separate shared-cost record and allocation table, preventing the same amount from being counted at both line and project level.

## 11. Risk and Contingency Model

Risk and contingency are explicit components requiring a basis, source, assumptions and approval state. No percentage is added silently.

## 12. Currency and Exchange Rate Model

Original and project currencies, direction, rate, source, effective dates, validity, approval and version are stored. Conversion blocks when a current approved project rate is missing. Project owners or Commercial Managers approve rates; previous rate versions remain available.

## 13. Margin and Markup Model

Margin is `(selling − cost) / selling`; markup is `(selling − cost) / cost`. Both are independently calculated and stored in basis points.

## 14. Selling Price Model

Target-margin, markup and authorized fixed-price methods are supported. Division-by-zero and margins at or above 100% fail safely.

## 15. Customer Discount Model

Customer discount is applied after gross selling price. The result is recalculated against the minimum margin; a breach blocks pricing unless a controlled exception exists.

## 16. VAT Model

VAT is scenario/project driven, supports non-applicable lines, validates 0–100%, and is calculated on net selling price. No global VAT constant controls persisted pricing.

## 17. Scenario Model

Named project scenarios retain mode, currency, settings, assumptions, version, creator and status. Scenario comparison exposes differences without overwriting another case.

## 18. Shared Cost Allocation Model

Even, quantity, material-value and manual weighting are supported. The last allocation receives rounding residue so allocated amounts reconcile exactly to the source cost.

## 19. Pricing Approval Model

Commercial approval is server-only, uses durable project roles, requires the current pricing version and a substantive reason, and rejects blocked lines. Technical approval and the latest safety decision are reloaded from durable records before every calculation.

## 20. Database Changes

Migration `0010_fair_bill_hollister.sql` adds project membership plus pricing scenarios, runs, lines, cost components, discount applications, exchange rates, shared costs, allocations, approvals, exceptions, audit events and run comparisons. Monetary amounts are stored in minor units; original calculation output is retained as structured JSON.

## 21. API Specification

Implemented operations include scenario list/create/compare, exchange-rate list/approve, item calculate/recalculate, breakdown, source list, manual-price validation, item/project history, project summary, run summary, comparison, commercial approval/rejection and cost-breakdown export. Every route authenticates, checks project ownership/membership, validates input, and uses prepared database statements.

## 22. Processing Changes

Single-line calculations are synchronous and idempotent by input fingerprint. Runs expose real calculated/blocked status. The schema is ready for bulk queue orchestration without simulating progress; bulk queue execution is intentionally not used for a single line.

## 23. Frontend Changes

The existing Costing screen now lists persistent scenarios, creates a controlled scenario, explicitly asks the estimator to select an eligible price source, starts governed calculation, and displays version, status, blockers, total cost, selling value and margin. Existing local demo totals remain visually separate and cannot approve persistent pricing.

## 24. Security Review

Project ownership or active membership is required. Commercial-sensitive operations require Estimator, Commercial Manager or Admin roles as appropriate. Roles come from `project_members`, not a client-provided header. Records are project scoped, prepared statements are used, approvals lock versions, audit events identify the actor and request, and browser totals are ignored.

## 25. Test Plan

Unit coverage includes source validity, explicit selection, sequential/additive discounts, Honeywell material-only scope, quantity, currency, components, margin/markup, minimum margin, customer discount, VAT, rounding, allocation, manual pricing and aggregation. Integration/static coverage verifies authentication, schema, route order, durable roles, API controls and Costing UI consumption. The full Tasks 3–11 regression suite is part of the release gate.

## 26. Implementation Summary

Key implementation files are `app/domain/pricing-engine.mjs`, `worker/pricing-api.mjs`, `worker/index.ts`, `db/schema.ts`, `drizzle/0010_fair_bill_hollister.sql`, `app/page.tsx`, `app/globals.css`, `tests/pricing-engine.test.mjs` and `tests/pricing-api.test.mjs`. Task 11 authorization was also completed with durable roles and controlled override decisions.

## 27. Known Limitations

- Bulk project pricing currently uses safe per-line synchronous calculation; a durable bulk queue can be added when project size demonstrates the need.
- Scenario rule editing is API-backed but the initial UI exposes only scenario creation and governed line calculation; detailed component editing remains deliberately constrained to avoid unsafe browser authority.
- The Task 12 CSV breakdown is an internal trace export. The professional multi-sheet Excel workbook belongs to Task 14.
- The subsequently completed Task 13 workflow consumes these versioned pricing records and approvals without replacing this engine.

## Acceptance and mandatory regressions

The implementation blocks pricing without technical approval, blocks expired/unselected sources, scopes Honeywell discounts to approved material rules, preserves project-specific discounts, differentiates margin and markup, blocks missing exchange rates, controls manual prices, protects minimum margin, uses project VAT, ignores frontend totals, preserves immutable versions and reconciles shared allocations.
