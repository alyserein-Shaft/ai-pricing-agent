# AI Pricing Agent — Engineering Assurance Audit

Status: Verified audit of the current local prototype  
Date: 1 August 2026  
Perspective: Chief Pre-Sales Engineering and Technical Estimation  
Pilot discipline: Fire Detection and Alarm

## Implementation status

Engineering Release E1 has started in the local app. The first completed increment adds a domain-level engineering assurance policy, classifies the six controlled fire-alarm requirements, defines the exact evidence and deliverable expected for each, hard-blocks incomplete/deviation decisions, and presents a consolidated Engineering Review Dossier. Automated tests cover missing source baselines, missing drawings, missing rationale, deviations, and the fully controlled passing case.

## 1. Executive engineering judgment

The current application is a strong governed estimation prototype, but it is not yet capable of producing quotations that a senior pre-sales engineer should approve without substantial human engineering work.

Its strongest achievement is restraint. It prevents incomplete BOQ descriptions, historical catalogue prices, stale supplier evidence, unresolved technical requirements, unauthorized materials-only scope, document revisions, obsolete product references, and cross-project commercial records from silently becoming an approved quotation. These controls should remain non-negotiable.

Its principal weakness is depth of engineering understanding. The current fire-alarm intelligence consists of six embedded requirement groups and a small historical Honeywell discovery set. It does not yet create a complete design basis, system architecture, loop/loading calculation, device/accessory schedule, standards matrix, drawing takeoff, interface schedule, cause-and-effect compliance review, battery calculation, cable calculation, installation assembly, or commissioning plan. Matching is safe but narrow; it is not yet a generalized semantic engineering engine.

Engineering readiness: controlled prototype, not tender-production automation.

## 2. Current estimation workflow

### Verified workflow

Project setup → document registration and issue control → BOQ extraction review → technical requirement review → product discovery → supplier RFQs → cost review → validation controls → commercial approval → client-safe export.

### Engineering assessment

The sequence is correct. The system appropriately separates extraction, technical compliance, price evidence, supplier award, and commercial approval. The workflow should remain, but each stage requires deeper discipline-specific engineering artifacts.

### Missing engineering stage outputs

- Tender design-basis summary
- Applicable codes and standards matrix
- Scope inclusions, exclusions, qualifications, and interfaces register
- BOQ/drawing/specification reconciliation
- System architecture and topology
- Equipment, device, accessory, license, and spare-parts schedules
- Capacity, loop, power, battery, bandwidth, storage, cable, and thermal calculations as applicable
- Compliance and deviations schedule
- Clarification/RFI register
- Installation and service work breakdown
- Technical risk register
- Approved technical solution revision

## 3. Module-by-module engineering audit

| Module | Current state | Engineering problem / missing logic | Business impact | Technical risk | Recommendation | Priority |
|---|---|---|---|---|---|---|
| Project creation | Captures identity, location, discipline, document availability, and declared scope | No design criteria, authority jurisdiction, project phase, environmental conditions, approved brands, deliverable requirements, or scope responsibility matrix | Poor project setup causes downstream rework | Requirements may be interpreted against the wrong jurisdiction or project phase | Add discipline-aware engineering brief with controlled unknowns and clarification actions | Critical |
| Document upload | Role-first registration, hashes, issue metadata, revision candidates | Rich understanding only for exact known fingerprints; original bytes are not durable | New tenders require manual processing | Missing/superseded evidence may support a decision | Use immutable versions, document classification, extraction status, citations, and issue hierarchy | Critical |
| BOQ extraction | Known workbook normalizes 90 rows into 21 lines; generic CSV is safely staged | No generalized Excel/PDF table extraction, hierarchy, alternates, provisional sums, duplicated scope, or cross-sheet relationships | Limited customer coverage | Quantities or scope boundaries may be lost | Create versioned BOQ candidate model with row/cell provenance and reconciliation totals | Critical |
| Specification analysis | Six clause-linked fire-alarm requirements | Not a complete clause model; no general obligations, submittals, installation, testing, spares, training, coordination, or execution requirements | Under-scoped quotations and qualifications | Technically noncompliant offer | Extract atomic requirements with type, applicability, source, mandatory/optional status, relationship, and reviewer decision | Critical |
| Drawing analysis | Registers 13 drawings and identifies drawing categories | Does not interpret devices, zones, floors, loops, risers, interfaces, routes, revisions, legends, or BOQ conflicts | Manual takeoff remains dominant | Missing devices/accessories and incorrect topology | Build drawing title-block/legend/symbol/schedule extraction, followed by human-verified takeoff | High |
| Product library | Six historical product clues and lifecycle mappings | No complete catalogue, datasheet, certificate, accessory, compatibility, firmware, license, regional approval, or revision model | Low automation and vendor coverage | False equivalence or incomplete assemblies | Build versioned product ontology and evidence-backed manufacturer catalogue ingestion | Critical |
| Technical matching | Completeness gates, discovery-only historical candidates, six compliance reviews | Retrieval is description/application oriented; no complete requirement-to-attribute comparison or assembly compatibility | Estimator still performs product engineering manually | Wrong panel/device/accessory combination | Implement hard gates plus explainable attribute matching and deviation analysis | Critical |
| Cost management | Current supplier source requirement, validity, currency, VAT, allowance, markup, freight | No complete labor productivity, installation method, engineering/programming/testing hours, tools, travel, supervision, overhead allocation, escalation, wastage, logistics, retention, bonds, or cash-flow cost | Margin leakage | Profitable-looking quotation may be loss-making | Introduce versioned installed-cost assemblies and commercial scenario engine | Critical |
| Supplier RFQs | Project-bound packages, response normalization, technical result, award | CSV download only; RFQ technical schedules are incomplete and generic | Slow sourcing and incomparable bids | Award based on non-equivalent scope | Generate discipline-specific supplier return schedules and completeness/deviation checks | High |
| Review | Strong blockers, owners, evidence routes, scope and lifecycle controls | Review shows control groups but not one complete solution dossier; no engineering risk ranking, alternative comparison, or calculation register | Senior reviewer must navigate many screens | Reviewer may approve without seeing system-level incompatibility | Create consolidated Engineering Review Dossier with drill-down | Critical |
| Quotation | Revision fingerprint, client terms, qualifications, scope boundary, source-backed totals | CSV-oriented output; no approved product schedule, compliance statement, options, clarifications, exclusions, accessory/service scope, or technical attachments | Client output is not tender-ready | Ambiguous offer and contractual exposure | Generate governed proposal package from approved technical and commercial revisions | Critical |
| Reports | Readiness, commercial summaries, audit export | No compliance matrix, design basis, takeoff reconciliation, technical risk, supplier comparison, or variance reporting | Poor management visibility | Repeated engineering mistakes remain hidden | Add engineering, sourcing, commercial, and AI-quality reports from authoritative data | Medium |

## 4. Specification and compliance audit

### Correctly represented in the current fire-alarm prototype

- Intelligent analogue addressable system requirement
- Saudi Civil Defense acceptance evidence
- NFPA 72:2019 and UL/EN54 evidence requirement
- Network capacity requirement of up to 99 additional nodes
- 24-hour standby plus 30-minute alarm duty with 20% battery margin
- Minimum three-year equipment warranty
- Requirement citations and evidence-backed human review

### Missing or incomplete fire-alarm engineering requirements

#### Codes, approvals, and certifications

- Exact UL product standards by component, not only a general UL reference
- FM approval where tender/authority requires it
- EN54 part number by device/panel/function
- Civil Defense listing validity, manufacturer, model, and regional scope
- Local electrical/building/fire code hierarchy and conflicts
- Certificate expiry and product revision applicability

#### Electrical and environmental

- Input voltage/frequency and allowable variation
- Power-supply loading and spare capacity
- Device current in standby/alarm
- Auxiliary power and notification appliance loading
- Battery type, derating, ageing, temperature, and charger compatibility
- Operating/storage temperature and humidity
- IP/IK rating by location
- Indoor/outdoor, hazardous, dusty, wet, corrosive, and high-temperature environments
- Earthing, surge/lightning protection, EMC, and isolation requirements

#### Panel, loop, and network

- Loop count, device capacity, isolator spacing, loading, distance, cable resistance/capacitance
- Addressing method and duplicate-address controls
- Network topology, media, distance, redundancy, nodes, gateways, and fault tolerance
- Cause-and-effect capacity and programming tools/licenses
- Graphics workstation, printers, annunciators, mimic panels, and protocol interfaces
- Expansion slots/modules and future capacity
- Firmware/software versions and compatibility
- Cybersecurity and remote-access requirements for connected systems

#### Devices and accessories

- Detector type/application and spacing basis
- Bases, sounder bases, isolators, backboxes, guards, weatherproof boxes, labels
- Manual station type, key/reset, mounting, weather protection
- Notification candela/output, synchronization, audibility/visibility design
- Duct detector sampling tubes, relays, remote indicators, access arrangements
- Modules, relays, supervised circuits, end-of-line devices, interface isolation
- Firefighter telephone equipment and accessories
- Door-holder, damper, elevator, BMS, smoke control, and suppression interfaces
- Spare devices, consumables, test tools, keys, and licenses

#### Installation, testing, and handover

- Cable type, fire rating, segregation, containment, support, voltage drop, and identification
- Installation method and access assumptions
- Programming and cause-and-effect verification
- Testing procedures, witness requirements, integrated systems testing
- Authority inspection and certification
- As-built drawings, O&M manuals, training, software backups, passwords/licenses
- Defects liability, maintenance, warranty response, and spare-parts support

No product should be marked compliant until the applicable requirements above are either evidenced, declared not applicable with reason, or formally clarified.

## 5. Drawing engineering audit

The current system knows that drawings exist and distinguishes schematics, cause-and-effect drawings, coordination drawings, and Fire Command Center details. It does not yet perform engineering interpretation.

### Required drawing intelligence

- Title block: project, discipline, document number, revision, issue status, date
- Legend: symbol-to-device/product category mapping
- Location model: site, building, floor, zone, room, riser
- Device instances with coordinates and source citation
- Loops/circuits, panel association, isolators, branches, risers, network nodes
- Cable routes and approximate lengths with scale confidence
- Interfaces to HVAC, smoke control, elevators, doors, BMS, suppression, and power
- Cause-and-effect rows, initiating events, outputs, delays, reset/latch behavior
- Drawing-to-BOQ quantity comparison
- Drawing-to-specification conflicts
- Revision differences: added/removed/moved devices and changed notes
- Missing legend, unreadable scale, ambiguous symbols, duplicated tags, disconnected devices

### Safety policy

Drawing extraction may propose takeoff candidates. It must never silently change BOQ quantities or design topology. A reviewer must approve the drawing basis, symbol mapping, scale, and reconciliation decision.

## 6. Matching audit

### Current strengths

- Generic items cannot receive safe approval without system, description, unit, quantity, and specification.
- Historical candidates are discovery-only.
- Current supplier evidence is required for commercial cost.
- Obsolete product references require engineering disposition.
- Deviations and missing requirement evidence block approval.

### Current limitations

- Embedded candidate set is small and discipline-specific.
- Matching does not build a complete normalized requirement profile.
- Part compatibility, required accessories, certificates, licenses, and system topology are not modeled.
- There is no evaluated multi-vendor equivalence logic.
- No previous approved project or manufacturer rule base is queried.
- No alternative comparison explains which requirements improve or degrade.

### Required matching basis

Every recommendation must compare:

1. Project and location applicability
2. Mandatory specification clauses and standards
3. Drawing-derived topology/location/environment
4. BOQ function, unit, and quantity
5. Product datasheet attributes and certificates
6. Manufacturer compatibility and lifecycle rules
7. Required accessories, modules, software, licenses, and services
8. Previous approved project decisions under the same controlled taxonomy
9. Supplier availability and current commercial evidence

Part number and keyword similarity may retrieve candidates, but cannot establish compliance.

## 7. Engineering recommendation contract

Every product or solution recommendation must contain:

- Recommended manufacturer, product, revision, and configuration
- Intended BOQ line(s), locations, and quantities
- Engineering reason
- Compliance reason
- Matching basis with matched attributes
- Clause, drawing, datasheet, certificate, and catalogue citations
- Confidence band and calibrated score components
- Missing requirements and unavailable evidence
- Conflicts and deviations
- Required accessories, modules, software, licenses, and services
- Compatibility rules evaluated
- Environmental and installation suitability
- Lifecycle/obsolescence status
- Alternative products with comparative advantages/deviations
- Technical risks and required clarifications
- Current price evidence state kept separate from technical compliance
- Reviewer, decision, reason, and exact evidence revision

## 8. Confidence policy

Confidence is permitted only when calibrated against reviewed engineering outcomes. The model may not assign “high confidence” because its explanation sounds convincing.

### Hard blockers regardless of score

- Missing mandatory specification/drawing evidence
- Unresolved required attribute
- Missing source citation
- Incompatible protocol, loop, voltage, power, environment, certificate, or accessory
- Obsolete product without approved lifecycle disposition
- Product/certificate revision mismatch
- Current supplier price evidence absent or expired for commercial approval
- Unresolved clarification affecting compliance, quantity, or scope

### Confidence components

- Source authority and revision
- Requirement completeness
- Exact normalized attribute coverage
- Compatibility-rule pass rate
- Citation correctness
- Conflict/deviation severity
- Retrieval/ranking calibration
- Catalogue/datasheet/certificate consistency
- Reviewer outcome history under the same taxonomy

## 9. Costing audit

### Current commercial controls worth preserving

- Source/reference and validity date
- Supplier response normalization and explicit award
- Currency conversion with dated evidence
- Freight capture and allocation
- VAT separated from subtotal
- Risk allowance with reason
- Markup review and revision fingerprint
- Explicit client payment, delivery, location, freight, warranty, validity, and qualifications
- Materials-only scope conflict against tender service obligations

### Missing installed-cost model

Each priced solution should support:

- Equipment and accessories
- Consumables and wastage
- Software and licenses
- Panels/racks/enclosures/power/batteries
- Cable and containment
- Installation labor by activity and productivity
- Engineering, shop drawings, calculations, submittals
- Programming/configuration
- Factory/site acceptance testing
- Integrated testing and commissioning
- Training, documentation, as-builts
- Authority approvals and attendance
- Project management, supervision, HSE, QA/QC
- Mobilization, travel, accommodation, tools, lifting/access
- Freight, customs, insurance, storage, handling
- Warranty/maintenance obligation and spare parts
- Overheads, escalation, contingency/risk
- Bonds, retention, financing/cash-flow cost where applicable
- Margin, selling price, VAT, and rounding policy

Internal supplier discounts and procurement economics must not leak into client outputs unless explicitly intended by commercial policy.

## 10. Supplier workflow audit

Supplier comparison is only valid when every supplier receives and returns an equivalent scope.

### Required RFQ return schedule

- Manufacturer and exact part number
- Description and included accessories
- Quantity, unit, unit price, currency
- List price, discount, net price when commercially required
- Freight, customs, tax basis, delivery location
- Quote date and validity
- Lead time and partial delivery
- Warranty and support
- Country of origin
- Certificate/approval references
- Datasheet and compliance response for each technical requirement
- Deviation/exclusion/assumption
- Software/license and recurring fee
- Obsolescence/replacement statement
- Payment terms
- Supplier contact and quotation reference

Incomplete supplier responses remain non-awardable. Award must consider technical compliance, total landed cost, delivery, validity, warranty, risk, and scope completeness—not unit price alone.

## 11. Review page audit

### Current strengths

- Prioritized blockers and named owners
- Direct routes to evidence owners
- No zero-value reconciliation pass
- Scope conflict, source lifecycle, technical evidence, exchange rate, client terms, project ownership, and audit integrity checks
- Human approval tied to a calculation fingerprint

### Missing information

- Approved design basis and system architecture
- Complete compliance matrix with mandatory/optional/not-applicable status
- Product and assembly configuration
- Accessory and license completeness
- Calculation register and pass/fail state
- BOQ/drawing/specification reconciliation
- Alternatives and deviation comparison
- Clarification/RFI register
- Top technical and commercial risks
- Supplier bid completeness and normalized comparison
- Cost-build completeness by material/labor/service/overhead

### Recommended review experience

Create one Engineering Review Dossier with five sections:

1. Scope and evidence baseline
2. Technical solution and compliance
3. Quantities, calculations, and interfaces
4. Supplier and installed-cost comparison
5. Risks, clarifications, deviations, and approval

The default view should show only prioritized exceptions. Reviewers can expand the complete evidence trail. Approval remains impossible while any mandatory exception is open.

## 12. Quotation engineering audit

A client quotation should be generated only from an approved technical solution revision and approved commercial revision.

### Mandatory quotation content

- Project/client/reference and quotation revision
- Clear scope of supply and services
- Product/equipment schedule with manufacturer and model when approved for disclosure
- Quantities and units
- Included accessories, software, licenses, and services
- Technical compliance statement and listed deviations
- Alternates/options clearly separated from base offer
- Price summary and tax basis
- Delivery, validity, payment, freight, and warranty
- Installation/programming/testing/commissioning boundary
- Assumptions, qualifications, exclusions, and clarifications
- Client responsibilities and interface boundaries
- Referenced technical attachments
- Approval and issue metadata

### Blocking quotation defects

- Unknown product or configuration
- Missing required accessory/service
- Unresolved quantity discrepancy
- Unapproved deviation or clarification
- Expired/undated commercial evidence
- Inconsistent currency/tax/rounding
- Warranty below tender requirement without authorized deviation
- Scope exclusion conflicting with tender obligations
- Client terms copied from supplier terms without review
- Quotation totals not tied to the approved revision

## 13. Engineering risk assessment

| Risk | Severity | Current exposure | Required mitigation |
|---|---|---|---|
| Incomplete specification understanding | Critical | Six requirements do not represent the full tender | Atomic requirement extraction and mandatory compliance matrix |
| Incomplete product assembly | Critical | Candidate products lack accessory/license/system configuration | Assembly and compatibility model with hard gates |
| Drawing/BOQ mismatch | Critical | Drawings registered but not interpreted | Human-verified takeoff and reconciliation |
| Underestimated services | Critical | Current prototype centers materials-only economics | Installed-cost assemblies and formal scope authority |
| Unsafe equivalence | Critical | No evaluated multi-vendor equivalent engine | Requirement/attribute comparison and deviation approval |
| Authority/certificate mismatch | Critical | Evidence fields exist but complete certificate model does not | Versioned certificate and jurisdiction applicability |
| Stale supplier pricing | Controlled | Current expiry guard blocks it | Preserve as server-authoritative policy |
| Margin erosion | High | Labor/engineering/overhead/cash costs are incomplete | Complete cost model and estimate-vs-actual feedback |
| Review overload | High | Evidence spread across modules | Consolidated exception-first Engineering Review Dossier |
| Unsupported AI confidence | High | Current app avoids most unsafe confidence, but lacks calibration | Evaluation datasets and calibrated task confidence |
| Cross-discipline expansion | High | Fire-alarm rules cannot be copied to CCTV/BMS/MEP | Shared engineering ontology plus discipline packs |

## 14. Engineering gap plan

### Release E1 — Engineering control foundation

Objective: define what “technically reviewable” means before adding more automation.

- Engineering recommendation contract
- Requirement taxonomy and compliance decision model
- Design-basis, clarification, deviation, calculation, and risk registers
- Product/assembly/accessory/compatibility data model
- Installed-cost category model
- Consolidated validation and approval policy
- Fire-alarm benchmark and senior-review checklist

Definition of Done: a senior engineer can review one fire-alarm project using complete structured registers, even if extraction remains partly manual.

### Release E2 — Generalized fire-alarm intelligence

Objective: process new fire-alarm tenders beyond exact fingerprints.

- Specification and BOQ extraction with citations
- Drawing title-block, legend, device, loop, and cause/effect candidates
- Fire-alarm requirement and product ontology
- Loop, panel, battery, network, and interface calculation support
- Catalogue/datasheet/certificate ingestion
- Explainable matching and alternatives
- Discipline-specific supplier return schedule

Definition of Done: benchmark accuracy and citation thresholds are met; no recommendation bypasses hard engineering gates.

### Release E3 — Complete estimation and client issue

Objective: produce a technically and commercially defensible pilot quotation.

- Installed-cost assemblies and scenarios
- Supplier bid leveling and award
- Engineering Review Dossier
- Professional quotation and technical attachment package
- Estimate-versus-award feedback
- Engineering and AI quality reporting

Definition of Done: a senior pre-sales engineer approves the pilot through the platform with no offline control spreadsheet required for the agreed scope.

### Release E4 — Multi-discipline expansion

Objective: add CCTV, Access Control, Structured Cabling, AV, BMS, Electrical, and MEP using discipline packs.

Each discipline pack must define requirements, standards, calculations, product attributes, compatibility, accessories, installed-cost assemblies, review rules, and evaluation datasets. Fire-alarm assumptions must never be copied as universal engineering logic.

## 15. Immediate engineering decisions

Before implementing generalized AI matching, approve:

1. The fire-alarm engineering requirement taxonomy
2. Mandatory versus optional versus not-applicable decision rules
3. Product and assembly configuration model
4. Accessory completeness rules
5. Certificate and jurisdiction applicability model
6. Calculation register and required calculation types
7. Installed-cost work breakdown
8. Supplier return schedule
9. Engineering Review Dossier structure
10. Fire-alarm benchmark acceptance thresholds

## 16. Non-negotiable approval policy

A recommendation or quotation cannot be approved unless:

- The applicable source baseline and revisions are controlled.
- Every mandatory technical requirement has an evidence-backed outcome.
- Product configuration and required accessories/services are complete.
- Compatibility and applicable calculations pass.
- Quantity discrepancies are resolved or formally qualified.
- Deviations and clarifications have authorized decisions.
- Price evidence is current and scope-equivalent.
- Installed cost includes the approved scope boundary.
- Commercial terms and warranty meet the tender or have authorized deviations.
- The reviewer identity, reason, and exact technical/commercial revisions are recorded.

An AI confidence score never overrides any of these conditions.
