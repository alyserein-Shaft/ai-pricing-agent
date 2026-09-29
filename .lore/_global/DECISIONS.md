# Global Decisions

- [DEC-2026-09-29-4999] Chose smallest-sufficient-slice execution over broad refactors; reason: shared dirty tree with concurrent agents and governance risk. Alternatives: large rewrite, opportunistic cleanup. #added:2026-09-29
- [DEC-2026-09-29-bf91] Chose authority-first investigation (UI -> selector/state -> API -> handler -> domain -> SQL/audit -> downstream readers) over UI-only fixes; reason: prevents hiding governance divergence. Alternatives: frontend-only warning suppression. #added:2026-09-29
- [DEC-2026-09-29-7f14] Chose narrowest-relevant test suite first, expanding only when behavior/contracts/shared modules change; reason: cost and dirty-tree safety. Alternatives: always run full suite. #added:2026-09-29
