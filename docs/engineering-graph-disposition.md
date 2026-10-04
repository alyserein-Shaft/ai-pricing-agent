# Engineering Graph Disposition — DEPRECATED (2026-08-31)

## Decision

**DEPRECATE** the Engineering Graph (`app/domain/engineering-knowledge-graph-engine.mjs`,
`worker/engineering-knowledge-graph-api.mjs`) and its only downstream consumer,
Engineering Discovery (`worker/engineering-discovery-api.mjs`), from the active
product workflow. Nothing was deleted — code, schema, migrations, and tests
remain in place. Only the engineer-facing entry point into the Engineering
Graph (the "Engineering Graph" button on the Requirement Profile review panel)
was removed.

## Why

Production data proved this decisively, not speculation:

| Table | Real rows |
|---|---|
| `engineering_graph_versions` / `_nodes` / `_relationships` | 0 / 0 / 0 |
| `engineering_graph_audit_events` | 0 — `/engineering-graph/generate` never once succeeded |
| `engineering_discovery_runs` | 0 — its only consumer never ran either |
| *(for contrast)* `product_accessories` | 211 (live, feeds BOM/Costing) |
| *(for contrast)* `engineering_relationships` | 14 (live, used in matching's compatibility subquery) |
| *(for contrast)* `product_match_candidates` | 1,911 |

Structurally, every node/relationship the graph engine can produce is a
free-text requirement/classification label (e.g. `Product Family`,
`Compatible Base`, `Compatible Panel`) — never a reference to an actual
`canonical_library_products` or `product_match_candidates` row. It has no
product identity linkage of any kind and cannot represent "Family → candidate
Product" or "Panel → Loop → Module → Device → Base" traces without a ground-up
redesign. Everywhere it overlaps in *intent* with `engineering_relationships`
/ `product_accessories` / `requirement_profile_versions`, it does so with a
weaker, unversioned-against-products, free-text mechanism. `engineering-
discovery-api.mjs`, its one downstream reader, has zero frontend consumers of
its own anywhere in the app.

Full audit trace (INPUT → NODE → CONSUMER → USER VALUE map, capability
comparison matrix against active architecture, and the decision options
considered) lives in the phase-5-ai-quotation-engineer session record; this
file is the durable pointer so the deprecation notes in code have somewhere
real to point to.

## What changed

- Removed the "Engineering Graph" button from the Requirement Profile review
  panel in `app/page.tsx` (the "Engineering classification" button stays —
  it's a separate, independently-used feature, not covered by this decision).
- Added deprecation notices to `engineering-knowledge-graph-engine.mjs`,
  `engineering-knowledge-graph-api.mjs`, and `engineering-discovery-api.mjs`.
- No schema, migration, route, or test deletion.

## Constraint for future work

Do not extend the Engineering Graph, wire it into product matching or safety,
or treat it as a source of truth for compatibility/accessory/requirement
relationships without a new, explicitly authorized architecture decision. If a
future need for cross-domain "why this product" explainability arises, prefer
a runtime projection/query over the already-governed tables
(`requirement_profile_versions`, `boq_requirement_links`,
`product_match_candidates`, `product_accessories`, `engineering_relationships`,
`product_source_evidence`) over reviving this graph as a second, persisted
source of truth.
