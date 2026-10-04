---
name: structural-code-search
description: Uses ast-grep for AST-aware structural searches across the codebase. Use when investigating code shapes, API call patterns, database mutations, status checks, repeated implementation patterns, unsafe constructs, or cases where plain text search could miss syntactic variants.
---

# Structural Code Search

Use ast-grep when the investigation concerns code structure rather than exact text.

## Runtime

ast-grep is available through `npx`, not as a global binary.

Always invoke it using:

```bash
npx --yes --package @ast-grep/cli ast-grep ...
```

Do not assume `ast-grep` or `sg` exists globally.

## Use This Skill For

- database mutation patterns
- chained method calls
- API invocation shapes
- status and state comparisons
- repeated implementation patterns
- deprecated API usage
- unsafe code constructs
- codemod candidate discovery
- structural verification across many files

## Investigation Discipline

Start read-only.

Do not run rewrite, fix, replace, or codemod operations unless the user explicitly authorizes implementation.

A zero-match result proves only that the exact structural pattern was not found.

It does not prove that the underlying behavior is absent.

When zero matches are unexpected:

1. Inspect likely syntactic variants.
2. Broaden the receiver pattern.
3. Consider helper functions and aliases.
4. Check batch APIs and indirect calls.
5. Separate direct evidence from inference.

## Project-Specific D1 Pattern

This project commonly uses:

```js
env.DB.prepare(sql).bind(...args).run()
```

rather than:

```js
env.DB.prepare(sql).run()
```

When investigating D1 mutations, inspect both direct `env.DB` receivers and generalized receivers where relevant.

Also investigate:

```js
env.DB.batch([...])
```

separately.

Searches for `.run()` do not cover batch-based writes.

## Tool Selection

Use the tools according to the evidence needed.

### Serena

Use Serena for:

- symbols
- definitions
- references
- callers
- implementations
- semantic navigation
- precise code inspection

### ast-grep

Use ast-grep for:

- repeated syntactic structures
- structural patterns across many files
- chained calls
- mutation inventories
- code-shape verification

### Graphify

Use Graphify for:

- architecture
- subsystem relationships
- authority paths
- governance analysis
- cross-component flow

### grep / rg

Use ordinary text search for:

- literal strings
- exact identifiers
- log messages
- comments
- simple text lookup

Do not substitute one tool for another when the question requires a different evidence type.

## Search Strategy

Prefer the narrowest sufficient scope first.

Example:

```bash
npx --yes --package @ast-grep/cli ast-grep run \
  -p 'env.DB.prepare($SQL).bind($$$ARGS).run()' \
  worker/
```

If the direct receiver pattern is insufficient, broaden carefully.

Example:

```bash
npx --yes --package @ast-grep/cli ast-grep run \
  -p '$DB.prepare($SQL).bind($$$ARGS).run()' \
  worker/
```

Do not interpret the broader result as equivalent to direct `env.DB` usage.

Keep direct and generalized matches separate in the report.

## Read-Only Default

Unless implementation is explicitly authorized:

- do not edit source files
- do not apply rewrites
- do not format files
- do not create migrations
- do not mutate databases
- do not commit
- do not push
- do not deploy
- do not restart services

Structural search is evidence collection first.

## Reporting Requirements

For structural investigations report:

- exact pattern searched
- search scope
- language mode if explicitly set
- total match count
- relevant files
- important structural variants
- known blind spots
- whether findings are direct evidence or inference

If multiple patterns are required, report them separately.

Do not collapse different mutation mechanisms into one count unless clearly labeled.

## Evidence Discipline

Distinguish:

1. Direct structural evidence
2. Semantic evidence from Serena
3. Architectural evidence from Graphify
4. Runtime evidence
5. Inference

Never upgrade inference into fact.

When structural evidence conflicts with another source, investigate the discrepancy instead of choosing one silently.

## Completion Rule

A structural investigation is complete only when:

- the requested pattern has been searched,
- obvious syntactic variants have been considered,
- known blind spots are stated,
- and the report does not claim more than the search actually proves.

Stop after the requested investigation unless the user explicitly authorizes implementation.
