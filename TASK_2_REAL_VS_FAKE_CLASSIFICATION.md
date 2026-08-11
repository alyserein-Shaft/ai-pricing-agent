# AI Pricing Agent — Task 2: Real vs Fake Functionality Classification

**Date:** 1 August 2026  
**Scope:** Current local application and codebase  
**Constraint:** Analysis and classification only. No production code was modified and Task 3 was not started.

## Task list

- [x] Lock the required primary and secondary classifications.
- [x] Trace frontend, browser state, file handling, parsers, services, database, deployment worker, fixtures and tests.
- [x] Build the feature-level Implementation Gap Matrix.
- [x] Inventory verified real processing.
- [x] Inventory fake, simulated, hard-coded and non-functional behavior.
- [x] Map every major workflow transition.
- [x] Identify backend, AI and database requirements.
- [x] Rank immediate blockers.
- [x] Select exactly one next implementation task.

## Evidence baseline

- Task 1 report: `CURRENT_PRODUCT_AUDIT_TASK1.md`.
- Primary live component: `app/page.tsx` (2,946 lines).
- Connected generic parser: `app/boq-csv.mjs`.
- Independently tested but disconnected modules: `app/document-parsers/xlsx.mjs`, `app/document-parsers/pdf-readiness.mjs`, and `app/domain/document-intelligence.mjs`.
- Database foundation: `db/schema.ts`, `db/index.ts`, and `drizzle/0000_tranquil_korg.sql`; not called by the live page or worker workflow.
- Deployment worker: `worker/index.ts`; handles framework routing and image optimization, not application APIs or processing jobs.
- Current automated result: build succeeded and **232/232 tests passed** on 1 August 2026.
- Test limitation: many checks validate pure functions, source guardrails and rendered HTML. They do not prove a connected upload → storage → job → extraction → publication service.

Primary status is assigned using exactly one Task 2 status per row. Browser `localStorage` is identified explicitly and is not treated as durable project storage.

No current feature was assigned **Broken** solely from the earlier screenshots: the previously reported undefined `.trim` and `.filter` runtime crashes are not reproduced by the current build and 232-test run. They remain evidence for the need for a full type-check and browser regression gate. No local-code feature required **Unable to Verify**; production multi-user durability, hosted security and external delivery remain unable to verify as operating qualities because the corresponding services do not exist in the inspected implementation.

## Deliverable 1 — Implementation Gap Matrix

### A. Project management

| Module | Feature | User Action | Expected Behavior | Actual Behavior | Primary Status | Evidence | Data Source | Persistence | Next Stage | Required Implementation Category | Business Impact | Technical Risk | Priority | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Projects | Create project | Submit intake form | Durable project with owner and defaults | Creates isolated `LocalProject` and audit event | Partially Working | `createProject`; `app/page.tsx` | Form input | Browser `localStorage` | Yes, locally | Backend Required; Database Required; Security Required; Audit Required; Testing Required | Can demonstrate setup but cannot support a team | Loss, tampering, duplicate identity | Critical | Create through authenticated project API and transaction |
| Projects | Edit metadata | Change client/code/due date/status | Validate and persist authoritative changes | Validates and updates local project snapshot | Partially Working | metadata handlers; local persistence effect | Form/local state | Browser only | Yes, locally | Backend Required; Database Required; Security Required; Audit Required | No shared source of truth | Concurrent overwrite and role bypass | High | Server-side validation and optimistic versioning |
| Projects | Archive | Archive active project | Retain governed historical record | Marks local project archived; no deletion from portfolio | Partially Working | archive control and tests | Local project record | Browser only | Portfolio locally | Backend Required; Database Required; Security Required; Audit Required | Useful safe behavior on one browser | Archive can be altered/lost | High | Persist lifecycle transition and actor |
| Projects | Delete | Delete project | Controlled deletion/retention policy | Product intentionally provides archive, not deletion | Missing | No delete workflow | None | None | No | Backend Required; Database Required; Security Required; Audit Required | Retention behavior undefined | Accidental permanent retention or future unsafe deletion | Medium | Define retention and privileged deletion policy later |
| Projects | Duplicate scope | Copy project scope | New isolated project without inherited commercial approvals | Creates scope-only local copy and clears prices/RFQs/approvals | Partially Working | copy handlers and guardrail tests | Current local project | Browser only | Yes, locally | Backend Required; Database Required; Audit Required; Testing Required | Good reuse control, not collaborative | Identity collision/concurrency | High | Perform copy transaction server-side |
| Projects | Project list | Open portfolio | Query all permitted projects | Lists local saved projects | Partially Working | `savedProjects`, portfolio render | Local snapshots | Browser only | Yes | Backend Required; Database Required; Security Required | Cannot show organization portfolio | Incomplete/incorrect user scope | High | Permission-filtered project query |
| Projects | Search/switch | Search then open project | Search authorized durable records | Filters/switches local snapshots | Partially Working | workspace switch controls/tests | Local records | Browser only | Yes | Backend Required; Database Required; Search Required; Security Required | Works only for one device | Missing projects and stale state | High | Server query plus stable project URLs |
| Projects | Filters/status | Filter project portfolio | Accurate lifecycle filtering | Client-derived status/filter behavior | Partially Working | portfolio/project-control functions | Local records | Browser only | Yes | Backend Required; Database Required; Rule Engine Required | Local operational aid only | Status not authoritative | Medium | Centralize lifecycle rules |
| Projects | Owner/role | Select responsibility context | Authenticated owner and permissions | Dropdown role with required handoff note; no trusted identity | Simulated | `workingRole`, `requireWorkingRole`; auth helper unused | User-selected string | Browser only | Local gates | Backend Required; Database Required; Security Required; Audit Required | Approvals cannot be trusted | Impersonation and bypass | Critical | Implement authenticated membership and server authorization |
| Projects | Activity | Review project actions | Immutable actor/time/change history | Local hash-chained events are searchable/exportable | Partially Working | audit functions in `app/page.tsx` | Client events | Browser only | Reports/export locally | Backend Required; Database Required; Security Required; Audit Required | Helpful demo accountability | Owner can alter clock/code/storage | Critical | Append-only server event service |

### B. Document upload and control

| Module | Feature | User Action | Expected Behavior | Actual Behavior | Primary Status | Evidence | Data Source | Persistence | Next Stage | Required Implementation Category | Business Impact | Technical Risk | Priority | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Documents | File selection | Choose files | Transfer bytes to controlled storage | Browser reads files; no upload API | Partially Working | `handleFiles` | `FileList` bytes | Metadata only locally | Sometimes | Backend Required; File Storage Required; Security Required; Testing Required | Files appear accepted without durable custody | Evidence loss | Critical | Signed/upload-session API and object storage |
| Documents | Drag/drop | Drop files | Same validated upload path | Opens the same browser handler | Partially Working | upload UI and `handleFiles` | Browser files | Metadata only | Sometimes | Backend Required; File Storage Required; Testing Required | Usable interaction, incomplete system action | Drop success can mislead | Critical | Connect to durable intake |
| Documents | File validation | Upload unsupported/corrupt file | Size/type/content/security checks | Live handler fingerprints and deduplicates; no comprehensive size, malware or parser validation | Partially Working | `handleFiles`; disconnected `validateUploadEnvelope` | Filename/hash | Browser only | Partial | Backend Required; File Storage Required; Security Required; Testing Required | Unsafe/unprocessable inputs can enter register | Resource/security exposure | Critical | Validate envelope and scan server-side |
| Documents | Upload progress | Observe progress | Byte transfer and processing progress | No real transfer; stage-progress contracts exist only in disconnected module | UI Only | no upload API; `document-intelligence.mjs` unused | None | None | No | Backend Required; Queue Required; Frontend Required | Cannot know actual state | False completion expectations | High | Show server-reported transfer/job progress only |
| Documents | File storage | Finish upload | Immutable retrievable source bytes | Original bytes are not stored or included in backup | Missing | backup disclosure; no object store binding | None after handler | None | No | Backend Required; File Storage Required; Security Required; Audit Required | Cannot reprocess or prove evidence | Critical evidentiary failure | Critical | Store immutable object keyed by tenant/version/checksum |
| Documents | Project association | Register file | Bind document/version to project | Filename/hash/role stored in active local project | Partially Working | project-isolated maps | Local metadata | Browser only | Local register | Backend Required; Database Required; Security Required | Isolation works in demo | Association can be changed/lost | Critical | Foreign-keyed document/version records |
| Documents | Metadata | Enter revision/date/transmittal | Governed version metadata | Local form validates before registering revision | Partially Working | revision candidate controls | Manual values/hash | Browser only | Local readiness | Backend Required; Database Required; Audit Required | Good construction control pattern | Non-authoritative metadata | High | Persist version metadata and lock published versions |
| Documents | Classification | Assign document role | Automated/human classification with review | Filename inference or manual role; disconnected deterministic classifier exists | Partially Working | `inferDocumentRole`; `classifyDocument` unused | Filename/manual input | Browser only | Partial fixture routing | Backend Required; Database Required; AI Required; Rule Engine Required; Audit Required | Misclassification can block processing | Wrong parser/routing | High | Server classification with human correction |
| Documents | Duplicate detection | Upload repeated content | Checksum-based dedupe and lineage | SHA-256 duplicate/same-name handling works locally | Partially Working | `crypto.subtle.digest`; collision/revision logic | Live bytes + local hash map | Browser only | Local register/review | Backend Required; Database Required; File Storage Required; Testing Required | Strong demo safeguard | Race conditions across users/devices | High | Enforce checksum/version constraints server-side |
| Documents | Processing status | View register | Truthful uploaded/classified/extracted/reviewed states | Known fixtures show prepared states; generic files say registered only; base fixtures may show extracted/indexed | Partially Working | document register rendering | Local flags/static fixture state | Browser only | Partial | Backend Required; Database Required; Queue Required; Audit Required | Some honest labels, but base fixture claims are not general processing | State divergence | High | Derive state from processing runs/artifacts |
| Documents | Retry/cancel | Retry failed extraction | Requeue/cancel durable job | Contract functions exist but no UI/service/job uses them | Disconnected | `requestProcessingCancellation`, retry logic | Pure module object | None operational | No | Backend Required; Database Required; Queue Required; Audit Required; Testing Required | Failures cannot be recovered operationally | Stuck documents | Critical | Connect commands to job runner |
| Documents | Delete | Remove document | Authorized lifecycle operation preserving audit | No governed delete operation | Missing | no connected document deletion | None | None | No | Backend Required; Database Required; File Storage Required; Security Required; Audit Required | Cannot administer mistakes/retention | Orphaned or unsafe future deletion | Medium | Define soft-delete/retention policy |
| Documents | Download/preview | Open registered file | Retrieve original securely | No source bytes retained, so arbitrary uploaded files cannot be reliably reopened | Missing | metadata-only persistence | None | None | No | Backend Required; File Storage Required; Security Required | Reviewer cannot inspect evidence later | Review/audit failure | Critical | Authorized signed download/preview endpoints |
| Documents | Refresh persistence | Reload page | Recover complete document and processing state | Metadata/derived decisions reload; file bytes do not | Partially Working | local persistence effect | Local serialized project | Browser only | Partial | Backend Required; Database Required; File Storage Required | Visual state returns without source evidence | False durability | Critical | Restore from server records and objects |

### C. Document processing and extraction

| Module | Feature | User Action | Expected Behavior | Actual Behavior | Primary Status | Evidence | Data Source | Persistence | Next Stage | Required Implementation Category | Business Impact | Technical Risk | Priority | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Processing | Queue | Register processable file | Durable asynchronous job | Processing-run contract/schema exist; no producer/consumer | Disconnected | `documentProcessingRuns`; `createProcessingRun`; worker has no job routes | None operational | Schema unused | No | Backend Required; Database Required; Queue Required; Audit Required | No reliable extraction | Lost/stuck work | Critical | Implement one durable BOQ job pipeline |
| Processing | Background execution | Leave page during processing | Worker continues independently | All live work occurs in browser event handlers | Missing | no background worker | None | None | No | Backend Required; Queue Required; File Storage Required | Large tenders cannot process reliably | Browser closure aborts work | Critical | Queue consumer with leases/idempotency |
| Processing | Real progress | Watch processing | Progress from completed stages | Pure stage calculator exists but is not connected | Disconnected | `advanceProcessingRun` unused | Pure run object | None operational | No | Backend Required; Database Required; Queue Required; Frontend Required | UI cannot report truthful progress | Artificial/stale progress if wired naively | High | Persist stage transitions from worker |
| Processing | PDF parsing | Upload normal specification/quote PDF | Extract text/layout/tables with page provenance | No live general PDF parser | Missing | only readiness inspector | None | None | No | Backend Required; File Storage Required; Queue Required; AI Required; Testing Required | Most tender evidence unusable | Core product failure | Critical | Add deterministic PDF text/layout adapter |
| Processing | PDF readiness | Inspect PDF | Detect encrypted/image/native-text routing | Helper works in tests but live upload never calls it | Disconnected | `pdf-readiness.mjs`; parser tests | Provided bytes in tests | None operational | No | Backend Required; Queue Required; Testing Required | Good reusable triage unavailable | Incorrect OCR routing | High | Invoke in worker before extraction |
| Processing | OCR | Upload scanned PDF | Selectively OCR required pages | No OCR implementation/provider | Missing | no OCR service | None | None | No | OCR Required; AI Required; Backend Required; Queue Required; Audit Required | Scanned tender files fail | Cost, latency, hallucination | High | Selective OCR with page confidence and review |
| Processing | XLSX parsing | Upload arbitrary workbook | Parse sheets/cells/merges and map rows | Native OpenXML parser passes tests but is not invoked by UI | Disconnected | `xlsx.mjs`; no import in page/worker | Test buffers only | None operational | No | Backend Required; File Storage Required; Queue Required; Database Required; Testing Required | Real BOQs/price lists do not extract | Disconnected capability | Critical | Connect parser through job and staging tables |
| Processing | CSV parsing | Upload valid BOQ CSV | Parse real rows and stage validation | Live UI calls real generic parser | Partially Working | `parseGenericBoqCsv`; `handleFiles` | Uploaded CSV text | Derived rows in browser | Yes, locally after approval | Backend Required; Database Required; File Storage Required; Audit Required; Testing Required | Only genuine general extraction path | No durable source/result | Critical | Use as first server-side vertical slice |
| Processing | Word parsing | Upload DOCX | Extract paragraphs/tables/headings | No parser | Missing | no DOCX module | None | None | No | Backend Required; File Storage Required; Queue Required; Testing Required | Scope/terms documents ignored | Incomplete evidence | High | Add after BOQ/PDF path |
| Processing | Email parsing | Upload/ingest email | Extract sender/date/body/attachments | No email parser or mailbox integration | Missing | no service/model/UI route | None | None | No | Backend Required; Integration Required; Security Required; Database Required | Inquiry evidence remains manual | Phishing/attachment risk | Medium | Defer until core files work |
| Processing | Failure logs | Parser fails | Persist actionable error and attempt | Error/log schemas and pure fail function exist, live workflow has no jobs/logs | Disconnected | `processingLogs`, `failProcessingRun` | None operational | Schema unused | No | Backend Required; Database Required; Queue Required; Audit Required | Support cannot diagnose failures | Silent/stuck work | Critical | Structured per-run logs and user-safe error codes |
| BOQ | Known XLSX extraction | Upload exact supplied BOQ fingerprint | Read workbook content | Loads embedded 21 candidates representing 90 rows | Hard-Coded | `initialItems`, `almoosaBoqSha256`, `applyKnownBoqExtraction` | Fixed array selected by hash | Browser derived state | Yes locally | Backend Required; Database Required; File Storage Required; Queue Required; Testing Required | Convincing demo, not general capability | Fixture mistaken for parser | Critical | Replace hash branch with connected native parser |
| BOQ | Generic row extraction | Upload CSV | Extract item/description/qty/unit/section | Real field parsing and validation | Partially Working | `boq-csv.mjs` | Uploaded CSV | Browser only | BOQ review locally | Backend Required; Database Required; File Storage Required; Audit Required | Useful seed capability | No durable provenance transaction | Critical | Persist staging rows and source anchors |
| BOQ | Row/merged-cell preservation | Upload XLSX | Preserve sheet/row/cell/merge provenance | Parser supports it in isolation; live workflow does not | Disconnected | `xlsx.mjs` tests | Test workbook | None operational | No | Backend Required; Database Required; Queue Required; Testing Required | Cannot audit arbitrary workbook normalization | Data loss/misread quantities | High | Map parser cells to staged BOQ assertions |
| BOQ | Manual edit/decision | Review candidate | Accept/exclude with required reason and apply valid rows | Works for known fixture and CSV locally | Partially Working | extraction review handlers | Staged local candidates | Browser only | Yes locally | Backend Required; Database Required; Security Required; Audit Required | Good human gate | Decisions can be changed/lost | High | Transactional review decisions and publication |
| Specification | Requirements | Upload exact supplied spec | Extract requirements with clause/page | Loads six embedded requirement groups | Hard-Coded | known spec SHA and fixed requirements | Fixed fixture | Browser only | Technical review locally | Backend Required; Database Required; File Storage Required; AI Required; Audit Required | Demo only for one document | Incorrect scope confidence | Critical | General requirement extraction with citations |
| Specification | Standards/attributes/vendors | Upload arbitrary spec | Extract structured obligations | No live general extraction | Missing | no connected mapper | None | None | No | AI Required; Rule Engine Required; Backend Required; Database Required; Testing Required | Matching lacks requirements | Compliance risk | Critical | Hybrid extraction plus deterministic schema validation |
| Specification | Conflict detection | Compare clauses/BOQ | Identify conflicting requirements | Scope-specific local guardrails exist; no general conflict engine | Partially Working | materials-only conflict and fixed review rules | Fixed/local requirements | Browser only | Quotation gate locally | AI Required; Rule Engine Required; Database Required; Audit Required | One valuable conflict covered, most are not | Missed compliance conflict | High | Generalize after requirements are structured |
| Drawings | Drawing intelligence | Upload drawings | Classify sheets, symbols, quantities, interfaces | Files/fixed package are registered/indexed by metadata only | UI Only | register copy explicitly says cross-check, no parser | Filenames/static tender list | Browser metadata | No extraction | AI Required; OCR Required; Backend Required; File Storage Required; Queue Required; Testing Required | No drawing-derived takeoff | Users may overread “indexed” | High | First implement sheet/page classification, not autonomous takeoff |

### D. Product library, matching and confidence

| Module | Feature | User Action | Expected Behavior | Actual Behavior | Primary Status | Evidence | Data Source | Persistence | Next Stage | Required Implementation Category | Business Impact | Technical Risk | Priority | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Library | Product creation | Add product/model/attributes | Durable normalized product record | No general product CRUD | Missing | no product tables/services | None | None | No | Backend Required; Database Required; Security Required; Audit Required | Cannot build reusable knowledge base | Duplicate/inconsistent catalogue | High | Normalized product service after intake foundation |
| Library | Price-list import | Upload catalogue | Extract and version products/prices | Exact Honeywell fingerprint exposes fixed candidates; arbitrary files stop | Hard-Coded | `candidateLibrary`, known SHA | Six embedded candidates | Browser flags | Matching locally | Backend Required; Database Required; File Storage Required; Queue Required; Rule Engine Required | No general catalogue ingestion | Stale/misattributed prices | Critical | Connect XLSX parser to price-source staging |
| Library | Supplier/currency/validity | Register commercial source | Store governed price source | Manual quote evidence fields exist locally | Partially Working | source review/manual approval/RFQ response | Manual local data | Browser only | Costing locally | Backend Required; Database Required; Security Required; Audit Required | Useful control but not reusable/authoritative | Invalid evidence manipulation | High | Version price-source records and validity |
| Library | Discount | Import/list discount | Apply source-supported discount | Unsupported blanket discount is intentionally blocked; no discount engine | Missing | guardrails reject assumption | None | None | No | Rule Engine Required; Database Required; Audit Required | Avoids unsafe assumption but cannot model agreements | Margin error if manually worked around | High | Evidence-backed discount schedules later |
| Library | Search/filter/versioning | Find products/prices | Search versioned global/project sources | No general persistent library/search | Missing | no search index/entity set | None | None | No | Backend Required; Database Required; Search Required; Security Required | Cannot scale matching | Tenant leakage/stale versions | High | Build after normalized catalogue ingestion |
| Matching | Readiness validation | Open match | Block insufficient BOQ descriptions/specification | Deterministic required-field gate works | Partially Working | `matchReadiness` | Current local BOQ item | Browser state | Candidate view locally | Rule Engine Required; Backend Required; Database Required; Testing Required | Fixes unsafe generic approvals | Client-only bypass | High | Enforce centrally and keep UI explanation |
| Matching | Candidate retrieval | Request match | Retrieve project/global candidates | Filters embedded library by description substring | Hard-Coded | `candidateLibrary`; `item.includes(appliesTo)` | Six fixed candidates | Static source | Price discovery locally | Search Required; Backend Required; Database Required; Rule Engine Required; AI Required | Cannot match arbitrary systems | False negatives/limited demo | Critical | Exact normalized retrieval first |
| Matching | Exact part number | Match known model | Deterministic exact match with provenance | Some lifecycle guard checks exact fixed references; no general index | Partially Working | lifecycle helper/tests | Fixed Honeywell rows | Browser/static | Partial review | Search Required; Backend Required; Database Required; Rule Engine Required | Useful rule pattern only | Incomplete coverage | High | Normalize manufacturer/model/part number keys |
| Matching | Technical compatibility | Evaluate candidate | Check attributes, standards, accessories and ecosystem | No generalized compatibility engine | Missing | no product attribute model/service | None | None | No | Rule Engine Required; Database Required; Search Required; Audit Required; Testing Required | Cannot claim engineering compliance | Safety/compliance failure | Critical | Deterministic compatibility rules over normalized data |
| Matching | Semantic/AI matching | Request alternatives | Rank evidence-backed candidates | No AI model, embeddings or semantic service | Missing | no prompts/model/API/index | None | None | No | AI Required; Search Required; Backend Required; Database Required; Testing Required | No fuzzy discovery across messy descriptions | Hallucination if added without rules | High | Add only after exact/attribute retrieval |
| Matching | Previous projects | Search history | Retrieve authorized historical evidence | Static historical examples only | Hard-Coded | embedded 2023 rows | Fixed data | Static | Discovery only | Backend Required; Database Required; Search Required; Security Required; Audit Required | No organizational learning | Cross-project/tenant leakage | Medium | Versioned authorized historical index |
| Confidence | Score calculation | View confidence | Compute score from match features/source quality/completeness | Candidate confidence labels are predefined; readiness is calculated separately | Hard-Coded | fixed `confidence: "Discovery only"` values | Static label + rule gate | Static/browser | Approval blocked for expired source | Rule Engine Required; Backend Required; Database Required; Testing Required | Labels are not a general confidence model | Misleading confidence if expanded | High | Persist feature-based score and policy outcome separately |
| Confidence | Discovery-only/approval block | View expired candidate | Prevent historical price approval | Correctly blocks expired catalogue values | Partially Working | eligibility/evidence rules | Fixed source date/local item | Browser only | RFQ/manual evidence | Rule Engine Required; Backend Required; Database Required; Audit Required | Strong risk control | Client-only enforcement | High | Centralize evidence policy |
| Confidence | Multiple/conflicting candidates | Review choices | Compare and explain alternatives | Very limited fixed candidates; no generalized conflict resolution | Missing | no candidate-set service | None | None | No | Rule Engine Required; AI Required; Search Required; Audit Required | Analyst cannot resolve real ambiguity | Arbitrary selection | High | Structured ranking and side-by-side evidence |

### E. Pricing, review, RFQ, quotation, dashboard, reports and audit

| Module | Feature | User Action | Expected Behavior | Actual Behavior | Primary Status | Evidence | Data Source | Persistence | Next Stage | Required Implementation Category | Business Impact | Technical Risk | Priority | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Costing | Manual price | Enter price/source/validity/reason | Store governed current evidence | Validates confirmed local supplier-quotation metadata and applies local cost | Partially Working | manual approval handler/tests | Manual input + local document metadata | Browser only | Totals/quotation locally | Backend Required; Database Required; Security Required; Audit Required | Useful controlled fallback | Source bytes absent; role bypass | High | Server evidence/approval transaction |
| Costing | Quantity total | Price item | Quantity × landed unit cost | Real deterministic calculation | Partially Working | totals/item calculations | Local approved cost + qty | Browser/calculated | Quotation locally | Rule Engine Required; Backend Required; Database Required; Testing Required | Arithmetic is meaningful | Not authoritative/versioned | High | Versioned calculation service |
| Costing | Freight | Award supplier offer | Allocate freight pro rata | Real allocation across awarded lines | Partially Working | `confirmSupplierAward` | Manual reviewed offer | Browser only | Unit costs/totals | Rule Engine Required; Backend Required; Database Required; Audit Required | Useful landed-cost logic | Zero qty/concurrency/rounding policy risk | High | Centralize formula and rounding policy |
| Costing | Currency/exchange | Award USD offer | Convert with confirmed rate | Supports SAR or governed USD conversion locally | Partially Working | award validation and formula | Manual exchange-rate evidence | Browser only | Unit costs | Rule Engine Required; Backend Required; Database Required; Audit Required | Supports key case | Rate authority/version may be altered | High | Version exchange-rate evidence |
| Costing | Markup/margin/selling | Edit markup | Calculate selling and margin | Real client-side formulas | Partially Working | totals and fingerprint | Local costs/markup | Browser/calculated | Quotation | Rule Engine Required; Backend Required; Database Required; Security Required; Testing Required | Core commercial calculation works locally | Unauthorized edits; inconsistent rounding | Critical | Authoritative calculation snapshot |
| Costing | VAT | Set VAT | Add VAT separately | Real percentage calculation and disclosure | Partially Working | quotation approval and export | Local VAT setting | Browser | Quotation/export | Rule Engine Required; Backend Required; Database Required; Security Required | Correct presentation locally | Tax setting can be changed without trusted authorization | High | Policy-controlled tax configuration |
| Costing | Risk allowance | Set rate/reason | Apply documented allowance | Local rate/reason included in calculations/fingerprint | Partially Working | pricing settings/fingerprint | Manual local input | Browser | Quotation | Rule Engine Required; Backend Required; Database Required; Audit Required | Supports explicit contingency | Formula/authority not centralized | High | Version policy and approval |
| Costing | Installation/engineering/programming/T&C | Build installed cost | Calculate labor/services from evidence | General cost engines absent; some unpriced service/assembly placeholders | Missing | no productivity/rate model | None/zero lines | None | No complete quote | Rule Engine Required; Database Required; Audit Required; Testing Required | Material-only total may be mistaken for delivered cost | Underpricing | Critical | Define explicit cost-component schema after intake slice |
| Costing | Customs/overheads/warranty cost | Build complete cost | Apply governed formulas/evidence | Not generally implemented | Missing | no complete model | None | None | No | Rule Engine Required; Database Required; Audit Required | Incomplete commercial estimate | Margin loss | High | Add evidence-backed components later |
| Review | Open BOQ/evidence | Select item | Show source, readiness and candidate evidence | Works locally for present data | Partially Working | BOQ/match dialogs | Local/fixture records | Browser | Local decision | Backend Required; Database Required; Audit Required | Useful analyst workspace | Evidence unavailable after source bytes disappear | High | Link every assertion to stored source preview |
| Review | Approve/reject/exclude | Decide item/requirement | Persist actor/reason/version | Local decision gates and reasons work | Partially Working | BOQ/requirement handlers | User input | Browser only | Matching/quotation locally | Backend Required; Database Required; Security Required; Audit Required | Good workflow control | User impersonation/tampering | Critical | Server decision commands |
| Review | Alternative/clarification | Choose alternative/request info | Create governed resolution workflow | Some RFQ routing exists; general alternative/clarification records absent | Partially Working | costing diagnostics/RFQ creation | Local unresolved items | Browser | RFQ locally | Backend Required; Database Required; Audit Required; Integration Required | Partial handoff only | Lost clarification history | High | Explicit issue/clarification entities |
| Review | Bulk actions/filters | Filter/resolve many items | Safe bulk review with exceptions | Search/filter exists in areas; generalized bulk decisions are limited | Partially Working | local filtered lists | Local records | Browser | Partial | Frontend Required; Backend Required; Database Required; Audit Required; Testing Required | Slower large BOQs | Accidental mass approval risk | Medium | Add only with server validation and preview |
| RFQ | Select/group items | Choose unresolved scope | Create nonduplicating supplier-answerable packages | Real local grouping and coverage controls | Partially Working | `prepareRfqPackages`; tests | Local BOQ items | Browser | RFQ draft | Backend Required; Database Required; Audit Required | Useful sourcing workflow | No shared ownership/concurrency | High | Persist RFQ and lines transactionally |
| RFQ | Export RFQ | Export ready package | Generate supplier-return file | Real CSV download for ready RFQ | Fully Working | RFQ export handler/tests | Local RFQ data | Downloaded file | External manual step | No Major Implementation Required; Testing Required | Delivers usable manual artifact | Input state itself not durable | Medium | Retain; later source data from server |
| RFQ | Send email | Send to supplier | Transmit and log delivery | Product does not send | Missing | no email integration/API | None | None | No | Backend Required; Integration Required; Security Required; Audit Required | Manual external step required | False assumption if wording unclear | Medium | Keep explicitly export-only until integrated |
| RFQ | Track deadline | Set due date/status | Notifications and overdue tracking | Due date/status stored locally; no scheduler/notification service | Partially Working | RFQ fields/UI | Manual data | Browser | Local dashboard | Backend Required; Database Required; Queue Required; Integration Required | Local visibility only | Missed deadlines | Medium | Server scheduler later |
| RFQ | Upload supplier reply | Register quote file | Store and associate reply | Registers metadata locally; no durable file | Partially Working | response file association | Browser file metadata | Browser only | Manual normalization | Backend Required; Database Required; File Storage Required; Security Required | Cannot retain quote evidence | Award audit failure | Critical | Store immutable supplier quote version |
| RFQ | Parse supplier quote | Upload quote | Extract header/lines automatically | No quote parser; analyst types normalization | Missing | `saveResponseReview` consumes manual draft | None automated | None | No | AI Required; Rule Engine Required; Backend Required; Queue Required; Database Required | Manual workload/errors | Wrong prices/terms | High | Add after PDF/XLSX intake foundation |
| RFQ | Compare offers | Review offers | Level multiple supplier offers | Real local normalized comparison | Partially Working | response offers/bid leveling | Manual normalized offers | Browser | Award locally | Backend Required; Database Required; Audit Required; Testing Required | Valuable if data entered correctly | Non-authoritative/manual entry | High | Persist normalized offers/provenance |
| RFQ | Award/update pricing | Approve compliant offer | Apply selected current evidence and freight | Real local rules/calculation update BOQ | Partially Working | `confirmSupplierAward` | Reviewed local offer | Browser | Costing/quotation | Backend Required; Database Required; Security Required; Rule Engine Required; Audit Required | Strong prototype integration | Client bypass/concurrency | Critical | Atomic server award and calculation update |
| Quotation | Create/pull items | Open quotation | Use only current approved costs | Client totals use current approved evidence and gates | Partially Working | quotation readiness/fingerprint | Local BOQ/costs | Browser | Preview/approval | Backend Required; Database Required; Rule Engine Required; Audit Required | Correct local linkage | Not authoritative; incomplete cost scope | Critical | Server quotation revision snapshot |
| Quotation | Terms/scope/exclusions | Enter commercial terms | Validate and version terms | Local terms, scope authority and qualifications are fingerprinted | Partially Working | settings/scope approval tests | Manual local input | Browser | Approval/export | Backend Required; Database Required; Security Required; Audit Required | Good controls | Roles/timestamps untrusted | High | Persist governed commercial terms |
| Quotation | Approval workflow | Approve revision | Authorized immutable approval | Local role gate, reason and fingerprint revision | Simulated | `approveQuotationRevision`; user-selected role | Local identity/calculations | Browser only | Export locally | Backend Required; Database Required; Security Required; Audit Required | Looks governed but is not trustworthy approval | Impersonation/tampering | Critical | Server authorization and immutable approval event |
| Quotation | Final CSV/package export | Export approved issue | Generate client-safe revision output | Real local export, guarded by current approval fingerprint | Partially Working | final issue export/tests | Local approved revision | Download + local audit | External | Backend Required; Database Required; Audit Required; Testing Required | Useful artifact, but source approval is untrusted | Reproducibility failure | High | Generate from server snapshot |
| Quotation | PDF/Excel/Word templates | Choose formal format | Produce branded governed documents | Full multi-format template system absent | Missing | no complete rendering service | None | None | No | Backend Required; Integration Required; Testing Required | Not submission-ready | Formatting/version drift | Medium | Add after authoritative quotation snapshot |
| Dashboard | Document count | Open dashboard | Count processed project documents by state | Counts local/base registered sources, not necessarily extracted | Partially Working | `currentDocumentCount` | Local/static metadata | Browser | Dashboard only | Backend Required; Database Required; Rule Engine Required | Can overstate usable evidence | Misleading KPI | High | Split registered/classified/extracted/reviewed/published |
| Dashboard | BOQ/priced/missing counts | Open dashboard | Aggregate current project records | Derived from local BOQ and current evidence rules | Partially Working | `projectControlState`, `pricedCount` | Local project records | Browser | Actions/quotation | Backend Required; Database Required; Rule Engine Required | Useful for current browser | Stale/non-shared KPI | High | Server aggregates from authoritative records |
| Dashboard | Progress/readiness | Open dashboard | Reflect stage completion | Pricing/technical/commercial percentages are deterministic local formulas | Partially Working | readiness calculations | Local flags/fixture data | Browser | Action queue | Backend Required; Database Required; Rule Engine Required; Testing Required | Useful but inherits fake/disconnected inputs | False readiness | Critical | Compute from persisted workflow states |
| Dashboard | Estimated cost/selling/margin | Open dashboard | Use approved current cost snapshot | Real calculations from qualifying local items | Partially Working | totals | Local costs | Browser | Quotation | Backend Required; Database Required; Rule Engine Required | Accurate only within represented local/material scope | Commercial misstatement | Critical | Label scope and use server calculation revision |
| Dashboard | Due soon/actions/RFQs | Open dashboard | Dynamic organization/project queue | Project-specific local rules generate action rows | Partially Working | `actionQueue`, due-date logic | Local records | Browser | Navigation | Backend Required; Database Required; Queue Required | Helpful local triage | No notifications/global view | Medium | Server task/query model later |
| Reports | BOQ/matching/pricing reports | Export report | Generate from authoritative project records | Some table/CSV exports exist; complete report suite absent | Partially Working | local export handlers | Local data | Download | External | Backend Required; Database Required; Testing Required | Limited handoff | Incomplete/unreproducible reports | Medium | Generate from versioned server snapshots |
| Reports | Technical compliance/missing info | Export evidence report | Include decisions and citations | UI decisions exist for fixed fixture; no general report engine | Partially Working | review/activity data | Local/fixed requirements | Browser/download where present | External | Backend Required; Database Required; Audit Required; Testing Required | Cannot support arbitrary tender submission | Missing provenance | High | Implement only after structured requirements persist |
| Activity | Action logging | Perform governed action | Store actor/time/old/new/reason | Many local actions prepend hash-linked event; old/new coverage is incomplete | Partially Working | audit helpers/events | Client-generated events | Browser only | Activity/export | Backend Required; Database Required; Security Required; Audit Required | Valuable pattern, not proof | Tamperable identity/time/history | Critical | Append-only server audit with structured diffs |
| Activity | Extraction/matching logs | Process document/match | Persist machine run/version/features | Processing log schema exists; no live run logs or match log entities | Disconnected | `processingLogs`; no connected match service | None operational | Schema unused | No | Backend Required; Database Required; Queue Required; Audit Required | Cannot explain/reproduce machine output | Support/compliance failure | Critical | Correlated run and match-decision logs |

## Deliverable 2 — Real Processing Inventory

| Process | Trigger | Input | Processing Logic | Output | Storage | Downstream Consumer | Limitations |
|---|---|---|---|---|---|---|---|
| Local project creation | Submit intake | User metadata | Validation, identity collision check, clean project initialization | `LocalProject` | Browser `localStorage` | Portfolio/project workspace | Single browser; no auth/database |
| Project scope copy | Duplicate scope | Existing local project | Copies scope while clearing commercial evidence and approvals | New local project | Browser | New workspace | Not transactional across users |
| File fingerprinting | Select/drop file | Actual file bytes | SHA-256 using Web Crypto | Content hash | Local maps | Dedupe/revision/known-fixture routing | Bytes are discarded afterward |
| Local dedupe/revision staging | Upload | Filename, hash, local register | Detects same content and same-name/new-content | Rejection or revision candidate | Browser | Document review | No global/server uniqueness |
| Generic CSV BOQ parsing | Upload BOQ CSV | Actual CSV text | Header mapping, quoting, row validation, commercial-column exclusion | Staged BOQ candidates/errors | Browser | Extraction review | Only CSV; no durable source/result |
| BOQ review publication | Accept/exclude rows | Staged known/CSV candidates and reasons | Requires explicit decisions and valid accepted rows | Local BOQ items with no assumed prices | Browser | Matching/costing | Known XLSX candidates themselves are fixed fixture |
| Match readiness validation | Open review match | BOQ item fields | Deterministic completeness rules | Ready/blocked result and missing fields | Calculated | Candidate display | Client-only |
| Price evidence validity | View/calculate | Status/source validity date | Deterministic current/expired/missing checks | Evidence state | Calculated | KPIs, quotation gates | Source data not authoritative |
| Manual price validation | Approve manual price | Local confirmed quote metadata, value, validity, reason | Deterministic guards | Costed BOQ line | Browser | Totals/quotation | Original quote absent; role simulated |
| RFQ grouping/export | Select unresolved items | Local BOQ and supplier fields | Nonduplicate grouping and CSV construction | RFQ record/download | Browser + downloaded CSV | Manual supplier process | No send/service persistence |
| Supplier response normalization | Save manual review | Typed quote header/lines | Completeness, date, currency, technical and source-role checks | Reviewed offer | Browser | Bid leveling/award | No automatic quote extraction |
| Supplier award pricing | Award selected offer | Reviewed offer, quantities, freight, currency evidence | Compliance/currentness checks, proportional freight, conversion | Updated landed unit costs and awarded RFQ | Browser | Costing/quotation | Client-side/non-authoritative |
| Commercial calculations | Change cost/markup/settings | Current approved local costs | Quantity totals, selling, margin, VAT and allowance formulas | Live totals/fingerprint | Browser/calculated | Dashboard/quotation | Incomplete installed-cost model |
| Requirement decisions | Review fixed requirement | Status, evidence, note, actor | Evidence/deviation gates | Review decision | Browser | Quotation readiness | Six fixed requirements only |
| Quotation fingerprint | Change represented inputs | Items, evidence, commercial settings and controls | Stable deterministic fingerprint | Revision identity | Browser | Approval/export invalidation | Not server-signed |
| Local backup/restore | Export/import backup | Serialized local projects | Checksum, schema and structural validation | JSON backup/restored projects | File/browser | Local recovery | Excludes all source bytes |
| RFQ/final/audit CSV exports | Click eligible export | Current local records | Deterministic serialization/download | CSV file | User download | External manual use | Underlying state is local |
| Independent native XLSX parsing | Automated test/direct module call | XLSX bytes | OpenXML unzip, sheets/cells/merges/provenance | Workbook model/BOQ candidates | Memory in test/caller | None in live product | Real module but disconnected |
| Independent PDF readiness | Automated test/direct module call | PDF bytes/inspection facts | Routes native text vs OCR and blocks invalid/encrypted input | Readiness decision | Memory in test/caller | None in live product | Not PDF extraction; disconnected |

## Deliverable 3 — Fake and Simulated Processing Inventory

| Location | User-visible behavior | Actual code behavior | Classification | Risk | Recommended replacement |
|---|---|---|---|---|---|
| Known BOQ upload | “90 source rows normalized to 21 candidates” | Exact SHA selects `initialItems`; workbook is not parsed by live flow | Hard-Coded | Demo mistaken for extraction | Connected native XLSX job with stored provenance |
| Known specification upload | Six clause-backed requirement groups appear | Exact SHA opens fixed requirement dataset | Hard-Coded | False confidence for arbitrary specs | General page/clause extraction with review |
| Known Honeywell workbook | 504-row source appears indexed and candidates appear | Exact SHA enables fixed `candidateLibrary` of six items | Hard-Coded | Catalogue capability overstated | Workbook-to-product/price staging pipeline |
| Technical matching | Products appear relevant to BOQ descriptions | Substring check against six embedded `appliesTo` strings | Hard-Coded | Not general matching | Exact normalized search, compatibility rules, then AI ranking |
| Confidence labels | Candidate displays discovery/confidence wording | Labels are predefined, not calculated from a general score | Hard-Coded | Users may infer measured confidence | Persist match features, quality and policy outcome |
| Project role/approval | Role-specific actions and approved revision | User selects a role string locally; no authenticated permission check | Simulated | Impersonation and invalid approvals | Server identity and authorization |
| Drawing register | Drawings show “Indexed”/classification copy | No drawing content parser or takeoff runs | UI Only | “Indexed” may imply understanding | Explicit “registered/classified only” until processing artifact exists |
| General PDF/XLSX/DOCX upload | File appears in intake queue/register | Metadata/hash are recorded; no general extractor runs | UI Only | Accepted-looking file produces no useful data | Durable job state with honest failure/unsupported status |
| Processing progress contracts | Processing stages/progress exist in code/tests | Pure state functions are never driven by a queue/worker | Disconnected | Architecture may be counted as capability | Operational job runner and persisted transitions |
| Database-backed processing | Tables/migration exist | Live page and worker do not call the DB for workflow data | Disconnected | False durability assumption | Repositories/services used by live routes |
| Native XLSX parser | Parser passes provenance tests | No live upload/job imports or invokes it | Disconnected | Tested module mistaken for end-to-end feature | Connect first vertical slice |
| PDF readiness helper | OCR routing tests pass | Live upload does not invoke it; no parser/OCR follows it | Disconnected | Readiness confused with extraction | Connect triage within worker pipeline |
| RFQ sending | RFQ package can be prepared | CSV export only; no email/portal delivery | Missing | User may assume supplier was contacted | Keep “Export draft” wording; later audited send service |
| Supplier reply parsing | Supplier response review form exists | Analyst manually types every value | Missing | Manual errors may look extracted | Quote parser plus side-by-side human verification |
| Local audit chain | Activity appears controlled/checksummed | Client-generated chain, client clock and selected actor | Simulated | Not legally/operationally authoritative | Append-only server audit |
| Dashboard documents/readiness | Counts and percentages look operational | Derived from local flags and fixture/registered records | Partially Working | Can overstate processed evidence | Server states and separate lifecycle counts |
| Installation/service cost | Service scope appears in workflow | General labor/productivity/engineering/T&C engines absent or unpriced | Missing | Materials total may look complete | Explicit cost-component model and completeness gate |

No timer-generated fake extraction progress was found in the live upload flow. The `setTimeout` calls inspected restore local state or supersede stale quotation approval; they do not simulate document processing. This absence is important: the problem is disconnected/missing processing, not a fake timer pipeline.

## Deliverable 4 — Disconnected Workflow Map

```mermaid
flowchart LR
    A["Create Project\nPartially Connected"] --> B["Upload/Register\nPartially Connected"]
    B -. "BREAK: no object storage/API/job" .-> C["Process\nDisconnected/Missing"]
    C -. "BREAK for arbitrary files" .-> D["Extract\nCSV partial; fixtures hard-coded"]
    D -->|"accepted CSV or fixture BOQ only"| E["Match\nHard-coded/partial"]
    E -->|"manual or awarded current evidence"| F["Price\nPartially Connected"]
    F --> G["Review\nPartially Connected locally"]
    G --> H["Quote\nPartially Connected locally"]
    H --> I["Export\nReal local downloads"]
```

| Transition | State | Exact evidence / break point |
|---|---|---|
| Create Project → Upload | Partially Connected | Active local project receives file metadata through `handleFiles`; no server project/document identity |
| Upload → Process | Disconnected | No API, object storage or queue call; processing contracts/schema are unused |
| Process → Extract | Missing for arbitrary documents | No operational processor. CSV bypasses this boundary in-browser; exact hashes load fixtures |
| Extract → Match | Partially Connected | Accepted local BOQ items reach readiness/matching, but arbitrary XLSX/PDF extraction produces nothing |
| Match → Price | Partially Connected | Embedded historical candidates cannot be approved; manual or supplier-awarded current evidence can price items |
| Price → Review | Connected locally | Current evidence and totals feed local review/readiness gates |
| Review → Quote | Connected locally | Decisions/current prices affect alerts and quotation fingerprint |
| Quote → Export | Connected locally | Current locally approved fingerprint gates downloads; approval identity/storage are simulated/non-authoritative |

### Required trace: `BOQ.xlsx`

1. Frontend receiver: upload dialog/drop area in `app/page.tsx`.
2. Handler: `handleFiles`.
3. API called: **none**.
4. File storage: **none**; only name/hash/control metadata in browser state.
5. Parser: for the exact known SHA, **no workbook parser**; it selects the fixed `initialItems`. For arbitrary XLSX, none.
6. Extracted data: 21 prepared candidates for the known hash; no arbitrary workbook rows.
7. Storage: accepted items in serialized local project state.
8. Matching: `matchReadiness` and substring filtering of `candidateLibrary`.
9. Pricing: current manual quote or awarded RFQ evidence feeds deterministic local formulas.
10. Review: BOQ, matching, costing and review modules render the local records.
11. Quotation: locally approved current costs contribute to the calculation fingerprint and export.

**First exact chain break:** step 3—there is no API or durable storage.  
**Processing break:** step 5—live XLSX extraction is replaced by a known-hash fixture or does nothing for arbitrary workbooks.

## Deliverable 5 — Backend Requirement Matrix

| Feature | Required API | Required Service | Required Data Model | Background Job | Validation | Logging | Permissions |
|---|---|---|---|---|---|---|---|
| Projects | project CRUD/search/archive/copy | Project service | Project, membership, version | No | identity, dates, status transitions | create/update/archive/copy diffs | org/project roles |
| Document intake | upload session/complete/list/version/download | Document service + object storage | Document, DocumentVersion | scan/finalize | size, MIME, checksum, project, malware, issue metadata | upload/version/access events | uploader/reviewer/download rights |
| Document processing | enqueue/status/retry/cancel | Orchestrator/worker | ProcessingRun, Artifact, ProcessingLog | Yes | state transition, idempotency, max attempts | stage/error/processor version | process/retry/cancel roles |
| BOQ staging | extraction results/review/publish | BOQ ingestion service | BOQImport, BOQCandidate, BOQItem, Decision, SourceAnchor | Yes for parse/map | schema, quantities, units, row coverage | parser and publication events | estimator/reviewer |
| Requirements | extraction/review/publish | Requirement service | Requirement, Citation, Decision, Conflict | Yes | citations, types, completeness | extraction/review/version | engineer/reviewer |
| Product/price library | import/CRUD/search/version | Catalogue service | Product, Attribute, Compatibility, PriceSource, PriceRecord | Yes for import/index | manufacturer/model/currency/validity | source/import/version events | catalogue admin/project reader |
| Matching | candidates/explain/decide | Retrieval + compatibility service | MatchRun, Candidate, Feature, Decision | Optional async batch | item readiness, source eligibility, score policy | query/model/rule versions | estimator/engineer |
| Pricing | calculate/snapshot/override | Pricing engine | CostComponent, PricingRecord, RateEvidence, CalculationRevision | Optional batch | formulas, currency, validity, rounding | inputs/formula version/override | estimator/commercial approver |
| RFQ | create/issue/offers/award | Sourcing service | RFQ, Line, Supplier, Offer, Award | send/reminders/import | scope, dates, currency, compliance | issue/delivery/review/award | procurement separation |
| Quotation | create/revise/approve/render/export | Quotation service | Quotation, Revision, Line, Term, Approval, Artifact | render/export | readiness, fingerprint, approval policy | revision/approval/export | commercial approval |
| Activity/audit | query/export | Audit service | AuditEvent/outbox | Optional export | append-only structure/correlation | itself plus integrity monitoring | scoped read; no ordinary mutation |
| Dashboard/reports | project/portfolio metric queries | Reporting service | Derived views/snapshots | Scheduled aggregates if needed | metric definitions/version | query/refresh failures | tenant/project scope |

## Deliverable 6 — AI Requirement Matrix

AI is not recommended for arithmetic, required-field checks, evidence validity, permissions, workflow state transitions, currency formulas or approval gates.

| AI Task | Input | Output | AI Model Role | Deterministic Validation | Human Review | Risk |
|---|---|---|---|---|---|---|
| Document classification | Filename, sampled text/layout, declared role | Ranked document types with evidence | Classify ambiguous construction documents | Allowed taxonomy, confidence threshold, human override | Required when ambiguous | Medium |
| OCR assistance | Selected scanned page images | Tokens, boxes, confidence | Recognize page content | Page count, coordinate bounds, numeric/table checks | Required for low-confidence/critical values | High |
| Layout interpretation | PDF page tokens/geometry | Regions, headings, tables, notes | Interpret complex layouts | Geometry/schema consistency and source anchors | Required for exceptions | High |
| Table understanding | Extracted cells/regions | Header mapping, row groups, normalized candidate fields | Resolve irregular tables/merged semantic headers | Totals, types, row coverage, no hidden price import | Required before publication | High |
| Requirement extraction | Specification text/layout | Structured obligations and citations | Identify engineering requirement candidates | Citation existence, page/clause bounds, ontology/schema | Engineer approval required | High |
| Specification understanding | Requirements across clauses | Attributes, standards, approvals, accessories, services | Relate and summarize requirements | Deterministic standards/product rules | Engineer approval required | High |
| Product matching | Normalized BOQ + requirements + candidates | Ranked candidate set and evidence explanation | Semantic candidate generation/ranking | Exact keys, compatibility rules, source validity and exclusions | Required before approval | High |
| Alternative recommendation | Required attributes + compatible products | Potential equals/alternatives and deviations | Find non-obvious candidates | Mandatory attribute/compatibility comparison | Engineering approval mandatory | Critical |
| Conflict detection | BOQ/spec/drawing/client/supplier assertions | Potential contradictions with citations | Surface cross-document conflicts | Rule checks, source/version scope, citation validation | Human resolution mandatory | High |
| Explanation generation | Match/rule features and citations | Readable rationale | Convert structured evidence to narrative | Must only reference supplied features/citations | Reviewer sees before decision | Medium |
| Clarification generation | Missing/conflicting structured facts | Draft RFI/clarification questions | Draft precise questions | Required fields, no invented claim, source links | Human sends | Medium |

## Deliverable 7 — Database Requirement Matrix

| Entity | Current Storage | Required Storage | Missing Fields / Controls | Relationships | Versioning | Audit Needs |
|---|---|---|---|---|---|---|
| Projects | Browser object | Relational authoritative table | organization, owner user, lifecycle, optimistic version, timestamps | org, client, members, documents, quotations | metadata revisions or version counter | create/update/archive/copy |
| Project memberships | Selected local role string | Relational join | user, role, scope, effective dates | project + user | permission history | grants/revocations/handoffs |
| Documents | Local filename/role/hash maps; partial schema exists | Existing `documents` expanded/connected | tenant, lifecycle, active version, classification provenance | project, versions | logical document lineage | classification/correction/access |
| Document versions | Local metadata; schema exists unused | Existing `documentVersions` + object storage | uploader, content disposition, scan result, supersession | document, processing runs | immutable versions | upload/supersede/download |
| Processing jobs | None operational; schema exists | Existing run table plus lease/idempotency fields | queue key, lease, heartbeat, adapter/version, correlation | document version, artifacts/logs | immutable attempts | every transition/retry/cancel |
| Artifacts/assertions | None operational; schema exists | Existing tables plus publication/version fields | schema name, validation result, superseded status | run, source anchors, review decisions | processor/schema versions | creation/validation/publication |
| BOQ items | Browser array | Relational BOQ/line tables | project, revision, item number, section/system, normalized unit, source assertion | project/import/matches/pricing | immutable import + controlled line revisions | create/edit/publish/exclude |
| Requirements | Browser fixed array/decisions | Relational requirements/citations | type, normalized attributes, mandatory flag, conflict state | document assertion, BOQ/system, decisions | source/review revisions | extraction and engineering decision |
| Products | Fixed array | Relational catalogue | manufacturer/family/model/part number/status/certifications | attributes, compatibility, price records | catalogue/source effective versions | create/change/import |
| Product attributes | None | Typed attribute/value/unit tables or validated JSON plus definitions | datatype, unit, source, confidence | product/requirement | effective versions | changes and source |
| Price sources/records | Strings embedded in BOQ/RFQ and fixtures | Relational source + price records | supplier, currency, list/net, discount, validity, region, project/global scope | document version, product, supplier | effective-dated immutable records | import/review/expiry/override |
| Suppliers | Manual RFQ strings | Relational supplier and contacts | legal name, region, status, contacts, approved status | RFQs/offers/price sources | profile history | create/change/deactivate |
| Matches | Transient/local candidate state | Relational match run/candidate/decision | query inputs, feature evidence, rule/model versions, score, exclusions | BOQ, requirements, product, reviewer | rerun history | generation/review/approval |
| Pricing records | Embedded on local item | Relational calculation and cost components | source record, formula version, rate, rounding, validity, override | BOQ line, match/award, quotation revision | immutable calculation revisions | recalc/override/approval |
| Review decisions | Browser arrays/events | Relational decision entity | object type/id, outcome, reason, actor, role, timestamp, supersedes | assertion/match/price/quotation | append/supersede | complete decision history |
| RFQs/offers/awards | Browser arrays | Relational sourcing model | issue/delivery status, supplier contact, attachments, normalized terms | project, lines, supplier, documents, awards | RFQ/offer revisions | issue/receipt/review/award |
| Quotations | Browser calculations/approval array | Relational quotation/revision/line/artifact | number, template, scope, terms, totals, fingerprint, status | project, pricing snapshot, approvals | immutable issued revisions | approve/supersede/export |
| Audit logs | Browser hash chain | Append-only relational/event store | trusted actor/time, request/correlation, old/new, reason, IP/session as policy allows | every aggregate | immutable | integrity monitoring/export |

## Deliverable 8 — Immediate Blockers

Ranked in dependency order:

1. **Critical — Original files are not durably stored.** Without source bytes, no real parser, reprocessing, preview, evidence chain or audit can be reliable.
2. **Critical — No upload/process API or durable job execution.** The browser cannot provide resilient construction-document processing.
3. **Critical — General XLSX/PDF extraction is not connected.** The native XLSX and PDF readiness modules terminate in tests instead of feeding product review.
4. **Critical — Browser state is the system of record.** Projects, BOQ, prices, reviews, RFQs and quotation approvals are neither shared nor authoritative.
5. **Critical — Identity and authorization are simulated.** Role-restricted commercial and engineering decisions can be impersonated locally.
6. **Critical — Known tender extraction and catalogue matching are fixtures.** A different real project cannot traverse the demonstrated workflow.
7. **Critical — Matching has no normalized product/attribute/compatibility index.** Safe readiness gates exist, but general engineering selection does not.
8. **Critical — Complete installed-cost modeling is absent.** A materials-led total cannot safely represent full delivery scope.
9. **High — Approval and audit records are local.** Fingerprints/checksums are useful integrity hints, not trusted approvals.
10. **High — Connected-path tests are absent.** Current 232 tests pass, but do not validate object storage, APIs, jobs, database transactions, authorization or end-to-end recovery.

## Deliverable 9 — Recommended Next Task

### Select exactly one: Implement a durable BOQ intake vertical slice

Build only this connected path:

**Project BOQ upload → immutable file storage → document/version record → queued processing run → existing CSV/native XLSX parser → staged candidate rows with source provenance → human accept/exclude review → published BOQ items.**

This is the single best next task because it replaces the earliest and largest workflow break, reuses the current upload UX, CSV parser, native XLSX parser, processing contracts, database schema and BOQ review UI, and does not require premature AI.

### Measurable acceptance criteria

1. A user uploads an arbitrary valid CSV or XLSX BOQ to an authenticated project.
2. Original bytes are stored immutably and can be downloaded by an authorized project member.
3. A document and immutable version record store checksum, size, MIME type, object key and project association.
4. A durable job records queued, running, completed or failed stages, attempts and actionable errors.
5. The existing real parser processes the stored bytes; exact file hashes do not select prepared BOQ data.
6. Staged rows persist item number, description, quantity, unit, sheet/row/cell provenance and validation errors.
7. No staged row reaches the project BOQ until a permitted reviewer accepts it; exclusions require a reason.
8. Publishing is idempotent and cannot duplicate rows on retry or refresh.
9. The project dashboard distinguishes uploaded, processing, review required, failed and published states.
10. Automated integration and browser tests prove success, invalid workbook failure, retry, duplicate upload, refresh recovery, unauthorized access denial and published-row idempotency.

### Explicit exclusions

- No OCR in this task.
- No general PDF extraction.
- No AI requirement extraction.
- No semantic matching.
- No product-library redesign.
- No quotation redesign.

## Final classification

The platform contains substantial **real deterministic frontend logic**, several **valuable tested domain controls**, and two **real parser/readiness modules**. Nevertheless, the major platform promise remains blocked because its live document workflow is dominated by **browser-only persistence**, **hard-coded known-file results**, **disconnected processing foundations**, and **missing backend execution**.

Under the strict Task 2 definition, very few platform workflows qualify as Fully Working. The RFQ CSV download is a verified self-contained example. Most meaningful end-to-end business functions are Partially Working because their logic is real but their storage, identity, evidence or next-stage integration is not authoritative.

Task 2 stops here. No implementation and no Task 3 work has begun.
