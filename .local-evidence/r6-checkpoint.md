# R6 CHECKPOINT — Fire Alarm/CCTV URL-restore fix — 🟢 CLOSED

Canonical repo HEAD `029b426...` · runtime :4183 · no commits made.

## Defect proven (per slice)

At the RE-EVALUATION gate, probe `kn-r6-probe.mjs` confirmed **0/4** URL forms
restored — all four fell to Dashboard Overview (`h1="BD-Shaft Internal Pilot"`,
"Projects needing attention" present):

1. `?workspace=Knowledge&section=Fire+Alarm` (canonical)
2. `?workspace=Knowledge&section=CCTV` (canonical)
3. `?workspace=Fire+Alarm+Knowledge` (legacy)
4. `?workspace=CCTV+Knowledge` (legacy)

Root cause chain (verified by reading current bytes):

- `resolveGlobalDestination` correctly resolves all four forms to workspace
  `Fire Alarm Knowledge` / `CCTV Knowledge` with `canonicalWorkspace: "Knowledge"`
  (application-navigation.mjs 68–81), and `canonicalizeGlobalSearch` correctly
  keeps/rewrites the URL to `?workspace=Knowledge&section=Fire+Alarm|CCTV` (125–136).
- `globalWorkspacePresentation` (project-navigation.mjs 42–56) had NO case for
  `"Fire Alarm Knowledge"` / `"CCTV Knowledge"` → returned **null** →
  `restoreLocation` (page.tsx 3460–3466) took the `!presentation` branch →
  Dashboard Overview. The render branches for these modules already existed in
  page.tsx (`activeModule === "Fire Alarm Knowledge"` → `<FireAlarmKnowledgeWorkspace/>`,
  same for CCTV at 18255–18258).
- Secondary defect: `globalNavigationSelection` only mapped Manufacturers and
  Prices as Knowledge children — Standards/Search/Product Identities/Review fell
  through to default `"Knowledge Files"` → sidebar highlighted **Files** while
  another section's content was shown (mis-highlight).
- Tertiary defect: with activeModule `Fire Alarm Knowledge`, the AppShell
  received `globalSection={knowledgeSection}` (stale default "Files") → nav
  would highlight the wrong child even after the presentation fix.

Stale test: `tests/release-1-app-shell.test.mjs` asserted a superseded **7-child**
Knowledge nav (`Files, Products, Manufacturers, Prices, Case Studies, Fire Alarm,
CCTV`) while `GLOBAL_DESTINATIONS` has **11 children** (adds Standards, Search,
Product Identities, Review). This was the sole red test at the gate (41/42).

## Implementation (smallest sufficient — backend untouched)

### app/lib/project-navigation.mjs — `globalWorkspacePresentation`
Added:
```js
if (workspace === "Fire Alarm Knowledge" || workspace === "CCTV Knowledge") {
  return { topLevelArea: "Dashboard", activeModule: workspace, showAllProjects: false };
}
```
`restoreLocation` already sets `knowledgeSection` only for the Knowledge Library
module; these modules render their own workspace from `activeModule`.

### app/lib/application-navigation.mjs — `globalNavigationSelection`
Replaced the nested section ternaries with the uniform, truthful mapping
`Knowledge ${resolved.section || "Files"}` (every Knowledge child id is
`"Knowledge " + section`; Product Library and Case Studies keep their explicit
branches). Fixes Standards/Search/Product Identities/Review mis-highlight and
covers Fire Alarm/CCTV from either workspace form.

### app/page.tsx — AppShell `globalSection`
```tsx
globalSection={activeModule === "Fire Alarm Knowledge" ? "Fire Alarm"
  : activeModule === "CCTV Knowledge" ? "CCTV"
  : knowledgeSection}
```
Sidebar highlight derives from the active module, not stale section state.

### tests/release-1-app-shell.test.mjs
Stale 7-child assertion → the real 11-child contract:
`["Files","Products","Manufacturers","Standards","Search","Product Identities",
"Review","Prices","Case Studies","Fire Alarm","CCTV"]`; test renamed to "every
Knowledge child keeps URL, content section, and active navigation aligned". The
per-child loop (href round-trip, `selection.child === child.id`, resolved
workspace) now validates ALL 11 children — this is the truthful nav contract,
not a Golden mutation.

## Evidence

- Focused contract test `tests/knowledge-fire-alarm-cctv-restore-contract.test.mjs`:
  6/6 PASS (presentation maps both workspaces; canonical+legacy destinations
  resolve; buildGlobalLocation round-trips for all 11 children; selection
  highlights exact child for all sections; canonicalizeGlobalSearch keeps
  canonical form; page.tsx AppShell section mapping present).
- Guards: KN-UX + release-1-app-shell + R1–R5 contracts + workflow-reconciliation +
  release-0-1-product-truth = **86/86 PASS** (gate baseline was 41/42 red).
- `npm test`: 508/508 PASS.
- ESLint: same 6 pre-existing errors only (13056, 20311, 23461, 23581, 23582×2);
  zero in R6 regions. `tsc --noEmit`: exactly 18 errors = baseline pre-existing
  (none in project-navigation/application-navigation/AppShell/page regions).

## Runtime :4183

Playwright **14/14 PASS**:
- All 4 URL forms restore: h1 = "Fire Alarm System Pack" / "CCTV System Pack";
  no "Projects needing attention"; sidebar `aria-current` includes the exact
  child (parent "Knowledge" + child both highlighted, by design of AppShell).
- Mis-highlight regression: Standards, Review, Search, Product Identities,
  Manufacturers, Prices each highlight their own child (previously
  Standards/Search/Identities/Review highlighted "Files").

## Repo safety

R6 changed: `M app/lib/project-navigation.mjs`, `M app/lib/application-navigation.mjs`,
`M app/page.tsx`, `M tests/release-1-app-shell.test.mjs`,
`?? tests/knowledge-fire-alarm-cctv-restore-contract.test.mjs`.
Nothing committed; no live mutation.

## Exit decision

R6 CLOSED 🟢. Next (final slice): R7 — Files source drill-down (no fabricated
`Unclassified` / "Permitted use: Discovery Only").