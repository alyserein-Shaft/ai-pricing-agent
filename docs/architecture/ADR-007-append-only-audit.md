# ADR-007: Append-only application audit events

Status: Accepted for foundation design  
Date: 2026-08-01

## Context

The prototype audit chain is browser-local and mutable. Enterprise quotation decisions require trusted actors, timestamps, ownership, reasons, and revision references.

## Decision

Create append-only server audit events for consequential business actions. Each event records organization/project, actor/session, trusted timestamp, command/action, reason, affected entity/revision, correlation ID, and integrity metadata. Approved and issued revision snapshots are immutable. Operational logs remain separate.

## Consequences

- Client code cannot author authoritative audit events
- Corrections append compensating events rather than editing history
- Sensitive payloads stay in governed entities, not event/log text
- Retention and export policy must be defined before enterprise rollout

