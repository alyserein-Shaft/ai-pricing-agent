# ADR-006: Provider-neutral AI gateway with mandatory evaluation

Status: Accepted for foundation design  
Date: 2026-08-01

## Context

Future classification, extraction, requirement analysis, and matching may use multiple models/providers. Direct SDK calls would scatter policy, prompts, cost, logging, and safety behavior.

## Decision

All model calls pass through a provider-neutral gateway controlling approved models, prompt/schema versions, structured outputs, budgets, timeouts, redaction, correlation, storage, and evaluation tags. No model change reaches production without benchmark comparison and rollback reference.

## Consequences

- Domain modules remain provider-independent
- Confidence is calibrated from evaluation data, not model self-report
- Missing citations, required fields, compatibility, lifecycle, and price validity remain deterministic hard gates
- Raw document/prompt logging is disabled by default

