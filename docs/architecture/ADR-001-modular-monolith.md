# ADR-001: Modular monolith before microservices

Status: Accepted for foundation design  
Date: 2026-08-01

## Context

The current product is one browser-local client component with no production backend or proven independently scaling domains. Premature microservices would distribute transactions, authorization, testing, and operations before domain boundaries are stable.

## Decision

Build one deployable server application with explicit project, document, engineering, product, matching, pricing, sourcing, workflow, quotation, and audit modules. Modules expose typed commands, queries, events, and repository ports. Split deployment only when measured scale, security, availability, data ownership, or team ownership requires it.

## Consequences

- Simple initial transactions and operations
- Enforced modular boundaries are mandatory
- Outbox/events prepare future service extraction
- Shared-table shortcuts across modules are prohibited

