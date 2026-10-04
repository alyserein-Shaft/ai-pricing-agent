# Fire Alarm Brand Strategy & Pre-Sales Policy

**Status:** authoritative company/business process knowledge
**Scope:** Fire Alarm only
**Canonical source:** this file. Do not copy this policy into other documents; add a pointer instead.

This file is the single source of truth for two things:

1. which Fire Alarm brand the company prefers (the **Brand Strategy layer**), and
2. how much detailed technical selection must happen **before** a supplier RFQ (the **Pre-Sales workflow**).

Both exist to stop an agent from jumping straight from project requirements to product
matching. The mandatory order is:

```text
project requirements
→ mandatory-brand check
→ standards regime
→ total-point scale
→ in-house brand strategy
→ THEN BRANCH on the brand's commercial relationship:
     IN-HOUSE  → internal detailed selection → internal BOM → internal pricing → costing → quotation
     EXTERNAL  → preliminary selection → supplier RFQ → supplier solution → engineer review → costing → quotation
```

See §4 for both chains in full. **The branch is mandatory**: applying the supplier-assisted
workflow to an in-house brand is a policy error, not a shortcut.

---

## 1. The company's three in-house / preferred Fire Alarm brands

| Regime and scale | Preferred brand | Commercial relationship |
| --- | --- | --- |
| UL / FM projects, total Fire Alarm system points **<= 2000** | **Honeywell Farenhyt** | `IN_HOUSE` |
| UL / FM projects, total Fire Alarm system points **> 2000** | **Gamewell** | `IN_HOUSE` |
| European / EN projects | **Gent by Honeywell** | `IN_HOUSE` |

These are the company's three in-house/preferred Fire Alarm brands. Being *in-house* also
determines the **commercial workflow** (§4a): selection, pricing and costing are performed
internally, and a supplier RFQ is not the normal path.

### Why Farenhyt is preferred at <= 2000 UL/FM points

- the company already carries stock;
- an active partnership / vendor relationship exists;
- strong commercial access;
- good support and familiarity;
- a strong competitive pricing position.

These are commercial-access reasons, not a technical-superiority claim. Do not present
Farenhyt as technically better than an alternative; the preference is commercial.

---

## 2. A mandatory project brand overrides company preference

Before applying the in-house strategy, always establish whether the Client / Consultant /
tender documents **mandate** a specific brand.

Decision precedence, highest first:

```text
1. Contractually mandatory Client/Consultant brand
2. Governing standards regime
3. Project scale / total Fire Alarm points
4. Company in-house brand preference
5. Technical suitability
6. Commercial/vendor considerations
```

Therefore:

```text
mandatory brand → use/evaluate the mandatory brand
```

**even if it is not an in-house brand.** The in-house preference is ranked *below* a
contractual mandate, so a mandated NOTIFIER project stays NOTIFIER.

### Do not infer a mandatory brand

> Do **not** infer a mandatory brand merely because a manufacturer is mentioned in a
> specification.

A named manufacturer in a specification is *not* proof of a contractual mandate. A mandate
requires positive evidence of an actual requirement to use that brand (a "shall be",
an approved-vendor list, an approved-equipment clause, a client instruction). This
distinction is the single most common way an agent will get this policy wrong.

---

## 3. Other brands remain valid alternatives

The company may work with other brands, **NOTIFIER** being the main one. But:

- they are **not automatically preferred**;
- sourcing/vendor leverage may be weaker;
- they may require an external RFQ;
- they are typically used where the project requires them, or where justified on
  technical/commercial grounds.

Vocabulary:

```text
NOTIFIER = potentially TECHNICALLY_VALID_ALTERNATIVE
          not automatically PREFERRED_PROJECT_BRAND
```

**Do not delete existing NOTIFIER knowledge or previous technical work.** Prior NOTIFIER
work stands as a technical benchmark / technically valid alternative.

---

## 4. The correct Pre-Sales workflow — it BRANCHES by brand relationship

Brand Strategy does not lead to one workflow. It leads to **two distinct commercial
workflows**, selected by the brand's relationship to the company.

```text
Project Requirements
→ Mandatory Brand Check
→ Standards Regime
→ Project Scale / Total Fire Alarm Points
→ Brand Strategy
```

### 4a. IN-HOUSE brand — Farenhyt, Gamewell, Gent by Honeywell

```text
→ Internal Detailed Technical Selection
→ Internal BOM
→ Internal Commercial Pricing
→ Costing
→ Quotation
```

The company performs selection, detailed BOM, commercial pricing and costing
**internally**, using its own:

- stock position;
- partnership / commercial arrangements;
- internal price data;
- governed price lists;
- existing commercial knowledge.

**The company does NOT normally issue a supplier RFQ for product selection or pricing
on these brands. The supplier is NOT the normal selection authority.**

If an exact component cannot be resolved from governed internal evidence, then either
resolve it internally or **expose the exact gap**. A gap must **not** be silently
converted into an external supplier-selection workflow just because the supplier could
paper over it.

### 4b. EXTERNAL / non-in-house brand — e.g. NOTIFIER

```text
→ Preliminary Technical Selection
→ Preliminary BOM
→ Supplier RFQ
→ Supplier Detailed Technical Solution / BOM
→ Engineer Review
→ Approved BOM
→ Price Approval
→ Costing
→ Quotation
```

This is the only workflow in which `SUPPLIER_PROPOSED_TECHNICAL_SOLUTION` applies. **Do
NOT apply this workflow automatically to Farenhyt, Gamewell or Gent.**

### 4c. What this permits

For an **EXTERNAL** brand, the internal engineer / agent does not need to resolve 100% of
exact part numbers and accessories before RFQ. The supplier may complete detailed
selection for items such as:

- exact P/N variants;
- accessories;
- bases;
- power supplies;
- sync components;
- panel accessories / configuration;
- other detailed BOM components.

### 4d. Supplier proposals are not approvals

Where a supplier proposal does occur (EXTERNAL workflow), it must be treated as:

```text
SUPPLIER_PROPOSED_TECHNICAL_SOLUTION
```

It does **not** become automatically approved. **Engineer review remains required**, and
only after that review does the BOM become the approved BOM that price approval and
costing consume.

This is a governance boundary, not a formality: a supplier-authored selection that skips
review would launder unverified manufacturer claims into governed project state. In the
normal **IN-HOUSE** flow this state should not arise at all, because there is no supplier
selection step.

---

## 5. Preliminary loop-sizing policy

If final SLC loop distribution is not clear in the drawings, **do not block preliminary
pricing.**

Calculate a reasonable preliminary number of loops sufficient for the currently selected
device quantities and manufacturer capacity, and **mark it explicitly as an assumption.**

Quotation / dossier language should carry semantics equivalent to:

```text
SLC loop quantities are preliminary and based on the current BOQ/device count.
Final loop and panel quantities are subject to revision after the detailed Fire Alarm
design is completed/received.
```

> Do **not** represent a preliminary loop allocation as final detailed design.

This policy does not weaken the existing technical gates. A governed panel-sizing snapshot
is still produced by `createFireAlarmPanelSizingSnapshot` from real governed evidence; what
changes is only that an unresolved *final* loop distribution is reported as a stated
preliminary assumption instead of blocking the quotation.

---

## 6. Definition — "total Fire Alarm system points"

The `<= 2000` / `> 2000` threshold refers to:

```text
total Fire Alarm system points
```

**not** raw BOQ quantity.

Do not inflate the count with passive / non-addressable items such as:

- conventional NAC appliances;
- passive firefighter telephone jacks;
- mechanical accessories;
- duct housings;
- sampling tubes;
- included hardware.

Addressable detectors, modules, MCPs and other genuine system points **should** be counted
according to the applicable platform architecture.

If the exact company definition needs further refinement later: **preserve this policy and
flag the counting definition separately** rather than changing the brand rule. The brand
rule is stable; the point-counting definition is the open question.

The governed classifier that decides which items are genuine system points is
`app/domain/fire-alarm-slc-resource-classifier.mjs` (`DETECTOR_FAMILIES`,
`MODULE_FAMILIES`, `NOT_SLC_FAMILIES`). Use it rather than a raw quantity sum.

---

## 7. Scope limit — Fire Alarm only

This policy is specific to **Fire Alarm**.

Do **not** automatically apply the Farenhyt / Gamewell / Gent strategy to CCTV, PA/VA,
Access Control or any other system. Those systems keep whatever policy they already have.

---

## 8. Al Mousa implication

Existing NOTIFIER work remains valid as a **technical benchmark / technically valid
alternative** and **must not be deleted**.

However Al Mousa must now pass through the **Brand Strategy layer** before NOTIFIER can
remain the preferred project basis. Project evidence establishes:

```text
no mandatory conflicting brand
+ UL/FM regime
+ total Fire Alarm addressable points 1,877  (<= 2000)
```

Company policy therefore prefers **FARENHYT**. Al Mousa is on the **IN-HOUSE** path
(section 4a): internal detailed selection, internal BOM, internal commercial pricing,
costing, quotation. **A supplier RFQ is not the Al Mousa path.**

### 8a. Al Mousa protocol interpretation (human decision, 2026-09-30)

An authoritative engineer decision has been recorded:

```text
FLASHSCAN_MANDATORY = NO
```

The FlashScan / CLIP references in the Al Mousa specification are **not** interpreted as a
mandatory project protocol or brand constraint. Conditional FlashScan *feature* wording
(for example "1-159 on FlashScan systems") must **not** be reinterpreted as a mandatory
ecosystem requirement.

This closes the earlier `PENDING_CONSULTANT_CLARIFICATION` on that question. Al Mousa
therefore has:

```text
MANDATORY_FIRE_ALARM_BRAND = NONE
MANDATORY_FLASHSCAN_PROTOCOL = NO
```

### 8b. Implementation status

The Brand Strategy layer **is implemented** in code:

```text
app/domain/fire-alarm-brand-strategy.mjs
```

It resolves `preferredBrand`, `brandRelationship` (`IN_HOUSE` | `EXTERNAL`) and
`commercialWorkflow` (`INTERNAL_SELECTION_AND_PRICING` | `SUPPLIER_RFQ_AND_ENGINEER_REVIEW`).
The relationship is read from the governed company-brand registry
(`companyBrandRegistry.IN_HOUSE`), **not** inferred from parent-company identity — NOTIFIER
is a Honeywell brand and is still routed `EXTERNAL`.

Do **not** run an unnecessarily exhaustive selection, and do **not** open a supplier RFQ
on an in-house brand merely because some exact components still need selecting.

---

## 9. Related documents (pointers, not duplicates)

- `docs/GOLDEN-5-GOVERNED-FIRE-ALARM-ECOSYSTEM-SELECTION-POLICY.md` — governed
  ecosystem-selection policy (downstream of this Brand Strategy layer).
- `docs/GOLDEN-7A3B-HONEYWELL-BRAND-REGISTRY.md` — canonical brand *identity* registry.
- `.lore/_global/DECISIONS.md` — the atomic decision records for §1–§3 and §4.
- `.lore/_global/CONVENTIONS.md` — the scope limit, the preliminary-sizing labelling rule,
  and the engineer-review requirement.
- `app/domain/fire-alarm-slc-resource-classifier.mjs` — governed system-point classifier
  referenced by §6.
- `app/domain/fire-alarm-brand-strategy.mjs` — the implemented Brand Strategy engine
  (§4 routing, §8b), including the governed company-brand registry that decides
  `IN_HOUSE` vs `EXTERNAL`.
