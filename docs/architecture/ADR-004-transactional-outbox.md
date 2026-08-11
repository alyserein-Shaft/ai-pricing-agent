# ADR-004: Transactional outbox for asynchronous events

Status: Accepted for foundation design  
Date: 2026-08-01

## Context

Document processing, AI, rendering, notifications, and integrations require asynchronous work without losing events after business transactions commit.

## Decision

Write business state and outbox events in the same relational transaction. Dispatch events asynchronously. Consumers are idempotent, record processed message IDs, use bounded retries, and send exhausted work to a dead-letter queue.

## Consequences

- At-least-once delivery is expected
- Commands are not events; events describe completed facts
- Correlation and causation IDs are required
- Event payloads contain identifiers and minimal safe metadata

