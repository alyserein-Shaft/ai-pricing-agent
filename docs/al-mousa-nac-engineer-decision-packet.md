# Al Mousa — NAC & Voltage-Drop Engineer Decision Packet

**Status:** AWAITING ENGINEER INPUT
**Prepared:** 2026-10-04
**Project:** Al Mousa School — Fire Detection & Alarm (Al Mousa)
**Ecosystem authority:** FARENHYT (Honeywell Farenhyt) — *not* NOTIFIER
**Governed calculation authority:** `IFP-2100HV`
**Blocked calculators:** `power.nac-load`, `power.voltage-drop`

---

## READ FIRST — what this packet is and is not

**This packet asks for inputs. It does not contain a design.**

The NAC and voltage-drop calculation engines are implemented, verified and closed.
They are blocked **only** because the project evidence does not contain the inputs
they require. This packet collects exactly those inputs from the responsible
engineer.

**Explicitly NOT done here, and NOT to be inferred from this document:**

| Not done | Why |
|---|---|
| No circuit design proposed | Allocation is a design decision |
| No appliances distributed | Even distribution, nearest-panel and quantity ÷ circuit-count are all prohibited |
| No length taken from drawings | The drawings state **"DO NOT SCALE THE DRAWINGS"** |
| 60 m **not** used as a length | It is a project *maximum*, a validation condition only |
| No conductor Ω/km invented | Requires manufacturer data or an authorised standard derivation |
| No auxiliary PSU / extender / transformer | Derived hardware is a later, separate slice |
| No Ω/km, no default, no inference | Every field is either governed or `ENGINEER_INPUT_REQUIRED` |

### Governing manufacturer authority (already closed — do not re-answer)

| Parameter | Value | Source |
|---|---|---|
| Max current per Flexput/NAC circuit | **3 A** | IFP-2100 Data Sheet Doc 351602 Rev C; LS10143-001SK-E Rev E |
| Max total across all circuits | **9 A** | Doc 351602 Rev C |
| Max NAC voltage drop | **3 V** (Class A **and** Class B) | LS10143-001SK-E Rev E, Tables 4.6 / 4.7 |
| Max impedance envelope | 1.0 A→3 Ω · 1.5 A→2 Ω · 2.0 A→1.5 Ω · 2.5 A→1.2 Ω · 3.0 A→1.0 Ω | Tables 4.6 / 4.7 |
| Class A per-circuit impedance cap | 50 Ω | Table 4.7 |
| NAC output | Regulated 24 VDC, power-limited, 4.7 kΩ EOL | LS10143-001SK-E Rev E |
| Flexput circuits available | 8 on-board (Class B = 8 usable; Class A = 4 usable, paired) | Doc 351602 Rev C |

### Governed project context (already established — reference only)

- **7 physical panels:** 1 MFACP + 6 FACP
- **Notification census: 438 appliances** (governed; comprises 324 indoor strobes, 14 with sounder, 100 weatherproof)
- **Class constraint (requirement, not assignment):** *"THE NOTIFICATION CIRCUITS MUST BE IN CLASS A OR LOOP"*
- **Length ceiling (validation only, not a length):** *"POINT MUST NOT TO BE IN EXCESS OF 60 METERS MEASURED HORIZONTALLY ON THE SAME FLOOR"*
- **Scaling prohibited:** *"ALL DIMENSIONS ARE IN MILLIMETERS. DO NOT SCALE THE DRAWINGS"*

> **Note on row labels.** `MFACP-01` and `FACP-01…06` below are **packet-local row
> labels only**, provided so the table is addressable. They are **not** governed
> panel identifiers. Confirm the durable panel identifier in the `panelId` field.

---

## A. CIRCUIT ALLOCATION DECISION

### A.1 Panel register

| Row | Role | Served area (governed) | Durable `panelId` | Notes |
|---|---|---|---|---|
| `MFACP-01` | MFACP | FIRE COMMAND CENTER — ⚠ **two conflicting PRIMARY locations on record**: "FCC ROOM -00-015" vs "FIRE COMMAND CENTER- GROUND FLOOR (02-301) KG BUILDING". Reported, **not resolved**. | `ENGINEER_INPUT_REQUIRED` | Engineer to confirm location and identifier |
| `FACP-01` | FACP | BOYS SCHOOL | `ENGINEER_INPUT_REQUIRED` | — |
| `FACP-02` | FACP | GIRLS SCHOOL | `ENGINEER_INPUT_REQUIRED` | — |
| `FACP-03` | FACP | WELCOME CENTER | `ENGINEER_INPUT_REQUIRED` | — |
| `FACP-04` | FACP | SUB STATION -1 | `ENGINEER_INPUT_REQUIRED` | — |
| `FACP-05` | FACP | SUB STATION -2 | `ENGINEER_INPUT_REQUIRED` | — |
| `FACP-06` | FACP | DG STATION | `ENGINEER_INPUT_REQUIRED` | — |

### A.2 Circuit schedule — TO BE COMPLETED BY ENGINEER

Add one row per Flexput/NAC circuit actually used. Leave unused circuits unlisted.

| Panel | Circuit ID | Circuit Class | Served Area | Assigned Device Group | Device Qty | One-Way Route Length | Cable | Notes |
|---|---|---|---|---|---|---|---|---|
| `MFACP-01` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |
| `FACP-01` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | BOYS SCHOOL | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |
| `FACP-02` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | GIRLS SCHOOL | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |
| `FACP-03` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | WELCOME CENTER | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |
| `FACP-04` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | SUB STATION -1 | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |
| `FACP-05` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | SUB STATION -2 | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |
| `FACP-06` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | DG STATION | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |

*(Duplicate the final row as needed — up to 8 Flexput circuits per panel, or 4 paired circuits where Class A is used.)*

### A.3 Circuit class

Per circuit, state one of:

- `CLASS_A` — requires the panel to be programmed for Class A; **usable circuit count halves to 4** (circuits paired); per-circuit impedance cap is 50 Ω
- `CLASS_B` — default; 8 usable circuits; 4.7 kΩ EOL
- `CLASS_B_LOOPED` — permitted by the project note ("CLASS A OR LOOP"); state the supervision/EOL arrangement

**The project note constrains the class but does not assign it.** The engineer assigns it per circuit.

### A.4 Device groups

State appliance groups with exact governed part numbers where selected, e.g.:

```
deviceAssignments:
  - deviceRef: <exact part number>
    description: <governed description>
    quantity: <integer>
    currentSource: <datasheet / UL listing reference>
```

A governed quantity of **0** is a valid answer. An absent appliance group must be
omitted, never defaulted.

---

## B. ROUTE LENGTH INPUT

### B.1 Rules — these are absolute

1. **Drawing measurement is PROHIBITED.** The drawings state *"DO NOT SCALE THE DRAWINGS"*. Do not scale, do not measure off geometry, do not use a scale bar.
2. **The 60 m note is a MAXIMUM, not a length.** *"POINT MUST NOT TO BE IN EXCESS OF 60 METERS MEASURED HORIZONTALLY ON THE SAME FLOOR"* is a **validation condition**. It will be used to *check* a supplied length. **It must never be entered as, or substituted for, an actual circuit length.**
3. **State the unit explicitly** (`m` or `ft`). Do not leave it implicit.
4. **Length is one-way**, i.e. the panel-to-first-appliance route, not the loop total. For a Class A paired circuit, state which way the measurement refers to.

### B.2 Acceptable length provenance — record one per circuit

| Accepted source | Notes |
|---|---|
| Approved cable schedule | Preferred — carries circuit, route and length together |
| Approved routing / riser schedule | Preferred for vertical distribution |
| Engineer's quantity takeoff from issued documents | Must state the documents used |
| Field measurement | State method and date |
| Other engineer-authorised project source | State explicitly and justify |

**Not accepted:** drawing geometry or scaling; visual estimate off a schematic; the 60 m ceiling; an average or typical value; a value copied from another circuit.

### B.3 Length register — TO BE COMPLETED BY ENGINEER

| Panel | Circuit ID | One-Way Length | Unit | Length Evidence (type + reference) | ≤ 60 m? |
|---|---|---|---|---|---|
| `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | validate after entry |

---

## C. CABLE EVIDENCE REVIEW ITEM

> ### EV-REVIEW-01 — Fire alarm cable specification
>
> **Statement under review**
> *"1.5sq.mm. CWZ CABLE FOR FIRE ALARM CIRCUIT — 1.5sq.mm. CWZ CABLE FOR LOOP POWERED STROBES AND SOUNDERS — 2.5sq.mm, CWZ CABLE FOR FIRE ALARM EVACUATION SYSTEM NETWORK CABLES"*
> with fire-resistance definitions: **C** = resistance to fire at 950 °C for 3 hours · **W** = resistance to fire and water at 650 °C for 30 minutes · **Z** = resistance to fire and mechanical shock at 950 °C for 15 minutes.
>
> **Provenance (retain on decision — do not restate as new)**
> - Drawing: `2401232-PC-AMS-DR-T-00-ZZZ-002`, sheet *"ELV LEGENDS, NOTES AND ABBREVIATIONS"*
> - Legend IDs: `drawingLegend_6c819151-11e0-46fe-a1c8-cbb6d7b27355`, `drawingLegend_9aeec65b-6d47-4b33-ad77-c1e9ea4e495b`
> - Entry type: `Abbreviation`, section *"FIRE ALARM NOTES … FIRE ALARM CABLE DETAILS"*
> - **Current status: `Needs Review`**
>
> **Decision required — exactly one:**
>
> - [ ] **APPROVE** — as written. Retains the provenance above verbatim.
> - [ ] **REJECT** — evidence not valid for this use. State reason.
> - [ ] **REVISE** — state the corrected cable specification and the basis for the correction.
>
> **Consequence of leaving this unreviewed:** the cable specification cannot back a
> voltage-drop calculation, even once length and resistance are supplied. It remains
> `Needs Review` and un-promotable.

⚠️ **Precision note.** 1.5 mm² is a conductor **size**, not a resistance. Even on
`APPROVE`, voltage drop still requires §D.

---

## D. CONDUCTOR RESISTANCE BASIS

### D.1 Current state

`CONDUCTOR_RESISTANCE_UNRESOLVED`

**Do not supply an Ω/km figure from memory, from a catalogue, or by converting
1.5 mm² yourself.** A converted value without a stated material, stranding and
temperature basis is not governed evidence, and the calculators deliberately refuse
an unevidenced conductor.

### D.2 Supply exactly ONE of the following

**Option A — manufacturer data (preferred)**

| Field | Value |
|---|---|
| Cable manufacturer | `ENGINEER_INPUT_REQUIRED` |
| Exact cable type / part number | `ENGINEER_INPUT_REQUIRED` |
| Datasheet reference (document + revision) | `ENGINEER_INPUT_REQUIRED` |
| Conductor resistance (Ω/km or Ω/1000 ft) | `ENGINEER_INPUT_REQUIRED` |
| Unit | `ENGINEER_INPUT_REQUIRED` |
| Conductor material | `ENGINEER_INPUT_REQUIRED` |
| Temperature basis of the figure | `ENGINEER_INPUT_REQUIRED` |

**Option B — authorised standard derivation**

Requires explicit written authorisation to derive, plus:

| Field | Value |
|---|---|
| Authorising decision-maker and date | `ENGINEER_INPUT_REQUIRED` |
| Accepted standard (e.g. IEC 60287, NFPA 70 Table 8) with edition | `ENGINEER_INPUT_REQUIRED` |
| Conductor material (Cu / Al) | `ENGINEER_INPUT_REQUIRED` |
| Conductor construction / stranding | `ENGINEER_INPUT_REQUIRED` |
| Temperature basis | `ENGINEER_INPUT_REQUIRED` |
| Insulation operating temperature | `ENGINEER_INPUT_REQUIRED` |

Until Option A or Option B is supplied and reviewed, every circuit stays
`CONDUCTOR_RESISTANCE_UNRESOLVED` and voltage drop stays blocked.

---

## E. MACHINE-READABLE DECISION CONTRACT

One record per circuit. **No field may be silently defaulted.** Absent input is
`ENGINEER_INPUT_REQUIRED` or `null` with an explicit `*Blocker`, never a substitute value.

```jsonc
{
  "packetVersion": "al-mousa-nac-decision-packet-1.0.0",
  "projectId": "project_ae501b85-9c12-4332-bf8e-787c90f2d388",
  "ecosystemAuthority": "FARENHYT",

  "panels": [
    {
      "panelId": "ENGINEER_INPUT_REQUIRED",   // durable governed identifier
      "rowLabel": "FACP-01",                 // packet-local only
      "role": "FACP",
      "servedArea": "BOYS SCHOOL",           // governed
      "location": "ENGINEER_INPUT_REQUIRED",
      "locationConflictOnRecord": false
    }
  ],

  "circuits": [
    {
      "panelId": "ENGINEER_INPUT_REQUIRED",
      "circuitId": "ENGINEER_INPUT_REQUIRED",
      "circuitClass": "ENGINEER_INPUT_REQUIRED",   // CLASS_A | CLASS_B | CLASS_B_LOOPED
      "servedArea": "ENGINEER_INPUT_REQUIRED",
      "deviceAssignments": [
        {
          "deviceRef": "ENGINEER_INPUT_REQUIRED",
          "description": "ENGINEER_INPUT_REQUIRED",
          "quantity": "ENGINEER_INPUT_REQUIRED",
          "currentSource": "ENGINEER_INPUT_REQUIRED",
          "standbyAmps": "ENGINEER_INPUT_REQUIRED",
          "alarmAmps": "ENGINEER_INPUT_REQUIRED"
        }
      ],
      "oneWayLength": "ENGINEER_INPUT_REQUIRED",
      "lengthUnit": "ENGINEER_INPUT_REQUIRED",      // m | ft — never implicit
      "lengthEvidence": {
        "sourceType": "ENGINEER_INPUT_REQUIRED",     // CABLE_SCHEDULE | ROUTING_SCHEDULE
                                                      // | TAKE_OFF | FIELD_MEASUREMENT
                                                      // | OTHER_AUTHORISED
        "reference": "ENGINEER_INPUT_REQUIRED",
        "decidedBy": "ENGINEER_INPUT_REQUIRED",
        "decisionDate": "ENGINEER_INPUT_REQUIRED"
      },
      "cableSpecification": "ENGINEER_INPUT_REQUIRED",
      "cableEvidence": {
        "statement": "1.5sq.mm. CWZ CABLE FOR LOOP POWERED STROBES AND SOUNDERS",
        "drawingNumber": "2401232-PC-AMS-DR-T-00-ZZZ-002",
        "sheetName": "ELV LEGENDS, NOTES AND ABBREVIATIONS",
        "legendIds": [
          "drawingLegend_6c819151-11e0-46fe-a1c8-cbb6d7b27355",
          "drawingLegend_9aeec65b-6d47-4b33-ad77-c1e9ea4e495b"
        ],
        "reviewStatus": "Needs Review",
        "reviewDecision": "ENGINEER_INPUT_REQUIRED", // APPROVE | REJECT | REVISE
        "reviewedBy": "ENGINEER_INPUT_REQUIRED",
        "reviewDate": "ENGINEER_INPUT_REQUIRED"
      },
      "conductorResistance": "ENGINEER_INPUT_REQUIRED",
      "resistanceUnit": "ENGINEER_INPUT_REQUIRED",   // ohm_per_km | ohm_per_1000ft
      "resistanceEvidence": {
        "basis": "CONDUCTOR_RESISTANCE_UNRESOLVED",  // MANUFACTURER_DATA | STANDARD_DERIVATION
        "manufacturer": "ENGINEER_INPUT_REQUIRED",
        "cableType": "ENGINEER_INPUT_REQUIRED",
        "datasheetReference": "ENGINEER_INPUT_REQUIRED",
        "standard": "ENGINEER_INPUT_REQUIRED",
        "standardEdition": "ENGINEER_INPUT_REQUIRED",
        "conductorMaterial": "ENGINEER_INPUT_REQUIRED",
        "conductorConstruction": "ENGINEER_INPUT_REQUIRED",
        "temperatureBasis": "ENGINEER_INPUT_REQUIRED"
      },
      "decidedBy": "ENGINEER_INPUT_REQUIRED",
      "decidedRole": "ENGINEER_INPUT_REQUIRED",
      "decisionDate": "ENGINEER_INPUT_REQUIRED"
    }
  ],

  "evidenceReviews": [
    {
      "id": "EV-REVIEW-01",
      "subject": "1.5 sq.mm CWZ cable for loop powered strobes and sounders",
      "currentState": "Needs Review",
      "decision": "ENGINEER_INPUT_REQUIRED",   // APPROVE | REJECT | REVISE
      "decidedBy": "ENGINEER_INPUT_REQUIRED",
      "decisionDate": "ENGINEER_INPUT_REQUIRED"
    }
  ]
}
```

### E.1 Readiness classification (specification — not yet implemented)

Applied per circuit after the engineer completes the packet:

| Status | Condition |
|---|---|
| `READY_FOR_NAC_SIZING` | panel known **and** circuit known **and** assigned devices with quantities known (with governed per-device currents) |
| `READY_FOR_VOLTAGE_DROP` | all of the above **and** one-way length known **and** conductor resistance known **and** the 3 V manufacturer threshold resolved (already governed for IFP-2100HV) |
| `NAC_READY_VDROP_BLOCKED` | NAC sizing inputs complete, but length and/or resistance unresolved |
| `NEEDS_REVIEW` | inputs supplied but at least one evidence item is unreviewed |
| `UNKNOWN` | any required input absent |

**Evaluation order is fixed:** supersession and rejection → conductor/evidence validity
→ **NAC sizing** → **voltage drop** → **capacity deficit** → *only then* derived hardware.

---

## F. WHAT HAPPENS AFTER APPROVAL

```
1. ENGINEER DECISIONS
   Engineer completes §A allocation, §B lengths, §C EV-REVIEW-01, §D resistance basis,
   and signs §E records with decidedBy / decidedRole / decisionDate.

2. GOVERNED PERSISTENCE            ← human governance step; never skipped, never automated
   Circuit allocations, length evidence, the cable review decision and the resistance
   evidence are written as governed engineering records with provenance, decision actor
   and decision date. Unreviewed evidence is NOT promoted.

3. power.nac-load                  (canonical rule; delegates to NacCircuitCalculator)
   per circuit:  governing = MAX(Σ qty×standby, Σ qty×alarm)  vs  3 A per circuit
   → within capacity, or a governed DEFICIT in amps.
   Panel-level power.capacity (9 A total) is evaluated separately and is NOT a
   substitute for the per-circuit check.

4. power.voltage-drop              (canonical rule)
   R_loop = 2 × oneWayLength × conductorResistance
   Vdrop  = circuitCurrent × R_loop   vs  3 V manufacturer maximum
   plus the published current/impedance envelope (no extrapolation above 3.0 A)
   → within limit, or a governed voltage-drop exceedance.

5. CAPACITY DEFICITS
   Reported as governed numbers only: deficit amps per circuit, exceeding circuits per
   panel, and the campus total. NO hardware is chosen at this stage.

6. ONLY THEN — DerivedElectricalHardwareResolver  (separate, future slice)
   Auxiliary power supply / NAC extender / transformer / battery cabinet may be
   evaluated as governed candidates. Each remains a PROPOSAL requiring human approval.
   A deficit alone never auto-selects hardware.
```

---

## G. MINIMUM TO UNBLOCK

| To unblock | Engineer must supply |
|---|---|
| `power.nac-load` | §A circuit schedule — panel, circuit ID, class, device groups, quantities |
| `power.voltage-drop` | §A + §B one-way lengths with provenance + §D resistance basis + §C `APPROVE` on EV-REVIEW-01 |

**Smallest single unblock:** §A alone enables real NAC sizing and produces the
per-circuit deficits that make every later question answerable.

---

## H. SIGN-OFF

| Role | Name | Date | Signature |
|---|---|---|---|
| Prepared by (agent) | — | 2026-10-04 | — |
| Reviewing Engineer | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |
| EV-REVIEW-01 decision | `ENGINEER_INPUT_REQUIRED` | `ENGINEER_INPUT_REQUIRED` | |

*No project data was written in producing this packet. No calculation was executed.
No design was generated. No fact was promoted.*
