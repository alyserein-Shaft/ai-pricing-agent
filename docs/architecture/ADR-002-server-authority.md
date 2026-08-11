# ADR-002: Server-authoritative tenant and project data

Status: Accepted for foundation design  
Date: 2026-08-01

## Context

Browser localStorage currently contains project, pricing, RFQ, review, approval, and audit state. It cannot provide collaboration, tenant isolation, recovery, or authoritative approvals.

## Decision

The server becomes authoritative for organizations, memberships, projects, workflow inputs, commercial revisions, decisions, and audit creation. Browser state is limited to transient UI drafts and safe caches. Every tenant-owned record carries organization ownership; project resources also carry project ownership.

## Consequences

- Existing local projects require explicit validated import
- Authorization is enforced for every command/query
- Offline mutation is not supported initially
- Optimistic concurrency protects reviews and approvals

