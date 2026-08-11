# ADR-005: Versioned REST/JSON application API

Status: Accepted for foundation design  
Date: 2026-08-01

## Context

The product has no application API. Its primary operations are explicit workflow commands, governed revisions, and paginated resource queries.

## Decision

Use `/api/v1` REST/JSON endpoints with OpenAPI, schema validation, server authorization, idempotency keys for consequential commands, optimistic concurrency, cursor pagination, rate limits, and stable error envelopes. Defer GraphQL until a proven configurable-query need exists.

## Consequences

- Command semantics remain explicit and auditable
- Integrations receive stable contracts
- Read-specific endpoints/read models are acceptable
- Breaking changes require a new version or compatible migration

