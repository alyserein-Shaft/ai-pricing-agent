# ADR-003: Immutable object storage and document versioning

Status: Accepted for foundation design  
Date: 2026-08-01

## Context

The prototype stores filenames and hashes but not original evidence. Construction documents, supplier quotations, extraction citations, and issued packages must remain reproducible.

## Decision

Store every accepted upload as an immutable document version in object storage. Keep logical document, binary version, construction issue metadata, processing run, and approval revision as distinct entities. Mutations create new versions; they never replace reviewed evidence.

## Consequences

- Requires upload quarantine, malware/type/size validation, retention, and authorized downloads
- Citations reference exact document versions and coordinates/cells
- Storage lifecycle policy must preserve approved/issued evidence

