# GOLDEN-7A3R — Governed Knowledge Observation → Product Identity Materialization

## 1. Verdict

```
PARTIAL — KNOWLEDGE OBSERVATION ARCHITECTURE TRACED;
END-TO-END MATERIALIZATION PROOF INCOMPLETE
```

This is the mission's own third option, and I am not claiming `CLOSED` from
source inspection alone (§38 forbids it).

**Most importantly, this slice corrects a material error in GOLDEN-7A3.**

## 2. Correction to GOLDEN-7A3

GOLDEN-7A3 concluded that the missing upstream input was "knowledge-file
observations" and that none existed for the target ecosystems, so the 14 candidates
could not materialize. **That diagnosis was wrong, in two ways.**

| GOLDEN-7A3 said | Reality |
|---|---|
| "no knowledge documents exist for Gamewell-FCI / Gent / Simplex" | **Three directly relevant governed documents exist and are fully extracted** (§5) |
| `product_identities_observations` is the input table | The real table is **`product_identity_observations`** (singular), and it is an **output** of analysis, not its input. The input is `knowledge_files` + `knowledge_facts`. |

The error came from querying `knowledge_facts` for part numbers *containing*
"SIMPLEX"/"GAMEWELL"/"4100" — manufacturer part numbers do not contain manufacturer
names. The correct probe is by **source document**.

## 3. §40.1 — Exact knowledge-document → observation architecture trace

```
knowledge_files (29)  +  knowledge_facts (6,660)
        ↓  relevantFacts(): 17 governed fact_types, joined, ordered by (file, created_at, id)
        ↓  buildProductIdentityAnalysis()  [app/domain/product-identity-engine.mjs, ruleset product-identity-v1.1]
product_identities (1,881)  +  product_identity_observations (5,853)  +  product_identity_aliases
        ↓  review (Library Reviewer, guard + reason)
product_identity_reviews (status='Active')  →  PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL
        ↓  promote (Library Manager)
library_products / canonical_library_products
```

`relevantFacts` fact types: `Part Number, Product Description, Manufacturer, Brand,
Product Family, Category, Unit, Lifecycle, Alias, Price, Product Relationship,
Standard, Certification, Protocol, Country of Origin, Document Date, Region`.

**The grouping contract (read from the engine, §40.2).** A `Part Number` fact and
its related facts form one observation set via `attributes.observationKey`. Without
that attribute each fact is its own set and its own identity. Manufacturer is
resolved from `attributes.manufacturer` on the part number, **or** from a
document-level `Manufacturer` fact whose distinct count for that file is exactly
one. Otherwise the identity materializes with `manufacturer = NULL` and carries the
automatic blocker `"Manufacturer is not explicitly established for this observation
set."`

## 4. §40.2 — Observation schema and provenance

`product_identity_observations` (16 columns, present in the active chain and live
D1): `id, organization_id!, product_identity_id!, knowledge_file_id!,
knowledge_fact_id!, observation_key!, observation_type!, original_value!,
normalized_value!, attributes!, source_location!, confidence!, observed_date,
region, source_type, created_at!`.

Every observation therefore answers which document, which exact fact row, what
original text, what extraction produced it, and which organization owns it (§40.2
satisfied by the schema itself).

## 5. §40.5 — Current target knowledge-document inventory (live, read-only)

**29 `knowledge_files`, all `processing_status = Completed`.** Three are directly
on-target:

| Document | `detected_type` | Part Numbers | Descriptions | Lifecycle | Observations produced |
|---|---|---|---|---|---|
| `GW-FCI - Price List 2026 Jan 4 - KSA [2025.12.28].xlsx` | Price List | **429** | 425 | 0 | **1,140** |
| `KSA Gent Fire Price list Ver 22.3 Oct 2022 (1).xlsx` | Price List | **517** | 513 | **253** | **1,786** |
| `FA-RFQ-Farenhyt.xlsx` | **Supplier RFQ** | 52 | 53 | 0 | **112** |

Also contributing: `1.HCS MEA Partner Pricebook 2024 V12.xlsx` (2,177 obs),
`2.HCS MEA HIS Pricebook 2024 V12` (111), `83833 - Quote.xlsx` (172),
`SO26-06-17-01.pdf` (140), `MCC__KAFD__V1_Deal_ID_85575734.xlsx` (197).

Sample part numbers prove real, exact fire-alarm identities: `1100-0450`,
`1100-0460`, `2151` (GW-FCI); `013590`, `013608` (Gent); `5815rmk`, `6815`,
`ecs-int50w` (Farenhyt).

## 6. §40.4 — Positive-control trace: identities already exist

The pipeline has **already run**. Real materialized identities from those documents:

| Identity | Description | review_status |
|---|---|---|
| `COMPACT-24-N` | Vigilon Plus Compact One to two Loop Panel | Needs Review |
| `COMPACT-NODE` | Terminal Node For Vigilon Panel Networks | Needs Review |
| `COMPACT-PLUS` | Vigilon Compact 1-2 loop Control Panel | Needs Review |
| `1100-0450` | COMMAND CENTER, BLANK PLATE, SINGLE SIZE | Needs Review |
| `2151` | PHOTOELECTRIC HEAD ONLY, REQUIRES BASE | Needs Review |
| `013590` | Software Universal Gateway for PC | Needs Review |

**So Gent (Vigilon) and Gamewell-FCI panel identities are materialized today.**
That also revises §5 of the previous mission: Gent **Vigilon** is *not* blocked on
"third-party-only evidence" for *identity* purposes — a governed KSA Gent price list
supplies 517 part numbers. Third-party evidence still cannot establish *technical*
truth; that distinction is unchanged.

### The single real defect

| Manufacturer value on `product_identities` | Count |
|---|---|
| `NULL` | **1,040** (55%) |
| Honeywell | 675 |
| Cisco | 83 |
| Gamewell-FCI / Gent / Simplex | **0** |

Every identity produced by the two fire price lists and the Farenhyt RFQ has
`manufacturer = NULL` (1,786 + 1,140 + 110 observations). The GW-FCI and Gent files
emit `Manufacturer` facts, but the engine only accepts a **document-level** manufacturer
when exactly one distinct value exists for the file; otherwise the identity stays
unattributed and carries the `"Manufacturer is not explicitly established"` blocker.

**This is exactly the gap `reviewProductIdentity` exists to close**: it records
`manufacturer_reviewed=1` + `resolved_manufacturer`, and
`PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL` then stamps `manufacturer` onto the identity.
No schema change and no new subsystem is required.

## 7. §40.6 — Target product observation matrix

| Ecosystem | Candidate | Exact identity? | Knowledge observation? | Analyze outcome |
|---|---|---|---|---|
| Gamewell-FCI | E3 / S3 / GFP / 7075 (as families) | **No — family only** | 429 part numbers available in the GW-FCI price list | `REQUIRES_MORE_IDENTITY_EVIDENCE` for the family names; exact part numbers resolve to existing identities |
| Gamewell-FCI | `1100-0450`, `1100-0460`, `2151` | Yes | Yes | **Materialized**, `manufacturer=NULL` |
| Gent | Vigilon panels (`COMPACT-24-N`, `COMPACT-PLUS`, `COMPACT-NODE`) | Yes | Yes (517 part numbers) | **Materialized**, `manufacturer=NULL` |
| Gent | Nano | Yes (manufacturer page) | **No observation** | `NO_GOVERNED_KNOWLEDGE_DOCUMENT` |
| Gent | 32022 | Yes (manufacturer manual) | **No observation** | `NO_GOVERNED_KNOWLEDGE_DOCUMENT` |
| Simplex | 4100ES / 4010ES / 4007ES / 4100ESi / 4100U | Yes (catalog) | **No observation — no Simplex document** | `NO_GOVERNED_KNOWLEDGE_DOCUMENT` |
| Farenhyt | 10 panels + `5815rmk`, `6815`, `ecs-int50w` | Yes | Yes (Supplier RFQ) | Materialized / already governed |

**Simplex is the only ecosystem with no knowledge document at all.** Gent is
partially covered (Vigilon, not Nano/32022).

## 8. §40.21 — Source evidence is a *later* stage

`product_source_evidence` is **not** created by observation or analyze. It is attached
at promotion (`PRODUCT_SOURCE_EVIDENCE_REQUIRED` otherwise, per GOLDEN-7A3 §4).
**Precise missing stage for GOLDEN-7A3P:** a `product_sources` row plus
`product_source_evidence` rows must exist for the promoted `library_products` id.

## 9. §40.3 / §40.10 — Separation preserved

Manufacturer evidence and knowledge observation are **complementary, not
interchangeable** (§7): the manufacturer page establishes *technical* truth; the
knowledge document is the *identity materialization input*. No channel merges into
the other without canonical product linkage, and no identity was created from a
manufacturer page in this slice.

## 10. §40.3 / §40.9 — Real-schema runtime proof: what is and is not proven

**Proven (real schema, real engine, real data):**
- the full active chain applies; `product_identity_observations` exists with 16
  columns and **5,853 live rows**;
- the fact-selection join returns real rows (verified by direct query);
- `buildProductIdentityAnalysis` — the **real production engine** — correctly
  materializes an identity from a Part Number + Product Description carrying a shared
  `observationKey`, with `identityKey: "source:k1|E3-PANEL"`, description carried
  through, 2 observations, and the exact blocker
  `"Manufacturer is not explicitly established for this observation set."` (verified
  by direct execution);
- live identities demonstrably exist for Gent and Gamewell-FCI (§6).

**Not proven:** the assembled end-to-end harness (schema-introspection fixture →
`relevantFacts` → analyze → persist). I authored an 11-case real-schema suite; 5
passed and 4 database-backed cases failed. Diagnosis to the last verified point: the
seeded rows are correct in the database (dumped and inspected) and the engine is
correct in isolation, so the fault lies in my test harness's D1 wrapper
`prepare/bind/all` path, which I could not isolate within my remaining context. **I
deleted the file rather than leave a red suite in a shared tree.**

This is why the verdict is `PARTIAL` and not `CLOSED`.

## 11. Files changed

**None.** No production file, test file, schema, migration or route was modified or
added. Investigation only.

## 12. Tests / lint / build

| Check | Result |
|---|---|
| `npm test` | **519/519** |
| `npm run build` | passes |
| new runtime suite | **not landed** (red; removed) — see §10 |
| no red test left in the tree | confirmed |

## 13. Business-state no-write declaration

None. Live D1 opened read-only. No live analyze, no review, no promotion, no product
creation, no `approved_for_discovery` mutation, no pricing, matching, selection or
quotation mutation; no deploy, restart, commit or push. All runtime work used
disposable in-memory databases.

## 14. Remaining missing knowledge documents (§40.16)

1. 🔴 **No Simplex document of any kind.** Required: a Simplex price list, supplier
   quotation or technical submittal covering 4100ES, 4010ES, 4007ES, 4100ESi, 4100U.
   Until then GOLDEN-5's Simplex large-system candidate has no identity.
2. 🔴 **No Gent document for Nano or 32022.** The KSA list covers Vigilon only.
3. 🔴 **1,040 identities have `manufacturer = NULL`**, including every GW-FCI, Gent
   and Farenhyt fire identity. This is the dominant blocker and it is *reviewable
   today* — no new document is needed.
4. 🟠 Four Gamewell-FCI targets are family names; exact part numbers must be selected
   from the 429 available rather than invented.
5. 🟠 **CSFM** remains outside the certification vocabulary (§33 honored — not
   modified).
6. 🟠 No `product_source_evidence` yet for the new identities (a GOLDEN-7A3P stage).

## 15. §40.17 / §39 — Gate recommendation for GOLDEN-7A3P

**Partial YES for Gamewell-FCI and Gent; NO for Simplex.**

- **Gamewell-FCI, Gent (Vigilon): real materialized identity candidates exist** and
  can enter governed review. The next action is attribution review, not ingestion:
  a Library Reviewer runs `POST /api/product-identities/{id}/review` with
  `manufacturer_reviewed=1` and `resolved_manufacturer` from the document header,
  then a Library Manager promotes.
- **Gent Nano / 32022 and all Simplex: `NO_GOVERNED_KNOWLEDGE_DOCUMENT`.** Do not
  skip to GOLDEN-7A4.

**Recommended order:**
1. **GOLDEN-7A3M — Manufacturer attribution review** for the 1,040 NULL-manufacturer
   identities, prioritising the GW-FCI (1,140 obs) and Gent (1,786 obs) fire
   identities. This is the single highest-leverage action available and needs no new
   document.
2. **Acquire a Simplex knowledge document** (price list / quotation / submittal) —
   external dependency, so it starts now and runs in parallel.
3. **GOLDEN-7A3P — review + promotion** (Library Reviewer → Library Manager) for
   identities that pass reconciliation, attaching `product_source_evidence`.
4. **GOLDEN-7A4 — capacity evidence** on Gamewell-FCI E3 and the Gent Vigilon panels
   (`SYSTEM_POINT_CEILING`, `MAX_SLC_LOOPS`, per-loop limits).
5. **GOLDEN-7B** only when identity **and** capacity coverage exist for every
   ecosystem GOLDEN-5 can resolve.

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
