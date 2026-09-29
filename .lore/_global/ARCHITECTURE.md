# Global Architecture

- [ARCH-2026-09-29-77cd] Use Node.js >=22.13.0 with ESM (`"type": "module"`) in single-package repo `ai-pricing-agent`; see `package.json`. #added:2026-09-29
- [ARCH-2026-09-29-a0b3] Use Next.js 16.2.6 + React 19 + Vite 8 + Cloudflare vite-plugin/wrangler/vinext for web app; see `package.json`. #added:2026-09-29
- [ARCH-2026-09-29-5812] Keep deterministic domain engines in `app/domain/` (extraction, matching, pricing, workflow, safety); web app in `app/`, API handlers in `worker/`, Drizzle schema in `db/` + `drizzle/`. #added:2026-09-29
- [ARCH-2026-09-29-a5ae] Keep governance invariants: deterministic extraction/matching, approval/review/audit/provenance trails, separation of detected vs approved evidence vs pricing inputs vs quotation outputs; see `AGENTS.md`. #added:2026-09-29
- [ARCH-2026-09-29-fdec] Use Golden project `Al Mousa School — Clean Golden Run` for project-level experiments; preserve older Al Mousa project as historical reference; see workflow skill section 10. #added:2026-09-29
