#!/usr/bin/env python3
"""
Regenerate drizzle-active/manifest.json so it describes the POST-0010 target
object inventory of the active chain.

DETERMINISTIC SOURCES OF TRUTH
------------------------------
1. Object inventory (table / named-index / trigger / view NAMES) and per-table
   COLUMN NAMES come from a DISPOSABLE sqlite database built by applying the
   canonical drizzle-active/*.sql 0000..0010 in order. The live D1 is not touched.
2. Every object that 0008/0009/0010 creates: its `source` path and its verbatim
   `sql` text are parsed out of the canonical
   drizzle-active/0009_*.sql and drizzle-active/0010_*.sql files.
3. Everything else is carried over byte-identical from the existing manifest.
4. Serialization = json.dumps(indent=2, ensure_ascii=True), which is a byte-exact
   round trip of the current canonical file.

DERIVATION RULE (the whole patch, and nothing else)
--------------------------------------------------
R1  target.cutoffMigration := the last active migration. The manifest is the
    TARGET object inventory of the active chain; the chain's own gate comment
    states the rule ("a repair migration entering without moving [the cutoff],
    the manifest counts and the manifest object list would leave the disposable-
    database verifier report it as an extra object").
R2  counts.* := recomputed from the four object arrays.
R3  The two tables that 0008/0009/0010 rebuild get their column list re-based on
    the chain (names + physical order). A column that still carries the same
    nullability keeps its existing `definition` verbatim; requirement_id, which
    0008/0010 made nullable, becomes "text"; the two columns those migrations
    add are described as "<type> [DEFAULT <expr>] [NOT NULL]" in the same style
    as the sibling columns of the same table.
R4  For each table and index an active migration creates or rebuilds, `source` :=
    that active migration and `sql` := its verbatim statement -- the manifest's
    established convention (0003/0004/0005/0006 already own the objects they
    rebuild, e.g. review_decisions).
R5  An object a later active migration DROPS is absent from the target inventory
    (profile_applicability_drawing_ref_idx, dropped by 0009).
R6  sourceSchema.dbSchemaSha256 := sha256(db/schema.ts), the same live-fingerprint
    rule that already makes sourceSchema.legacyJournalSha256 equal the current
    drizzle/meta/_journal.json digest.

The script REFUSES to write unless the pre-patch delta against the post-0010
chain is exactly the expected 0008..0010 delta.

DELIBERATELY NOT PATCHED (reported, not silently blessed)
---------------------------------------------------------
W1  requirement_intelligence_facts.evidence_snippet is NOT NULL in db/schema.ts
    and in the manifest, but migration 0010's table rebuild declares it
    nullable, and the LIVE D1 agrees with 0010 (PRAGMA notnull = 0). That is an
    unintended constraint loss inside 0010, not a documented 0008..0010 intent.
W2  requirement_intelligence_facts.review_status lost its DEFAULT 'Needs Review'
    in 0010's rebuild the same way (live D1 dflt_value = NULL).
W3  Nine tables list the same columns in a different order than the chain's
    physical order (pre-existing manifest ordering drift).
None of these are corrected here: fixing W1/W2 would mean editing 0010 or
db/schema.ts, and blessing them in the manifest would hide an unintended
constraint loss. They are escalated instead.
"""
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ACTIVE = os.path.join(ROOT, "drizzle-active")
CANON_MANIFEST = os.path.join(ACTIVE, "manifest.json")
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "manifest.regenerated.json"))

M9 = "drizzle-active/0009_profile_applicability_device_identity_authority.sql"
M10 = "drizzle-active/0010_requirement_intelligence_source_authority.sql"
M10_TAG = "0010_requirement_intelligence_source_authority.sql"
REBUILT = ("profile_requirement_applicability", "requirement_intelligence_facts")
TABLE_SOURCE = {"profile_requirement_applicability": M9, "requirement_intelligence_facts": M10}

problems = []
warnings = []


def check(cond, msg):
    print(("PASS  " if cond else "FAIL  ") + msg)
    if not cond:
        problems.append(msg)


def warn(msg):
    warnings.append(msg)
    print("WARN  " + msg)


def dumps(obj):
    return json.dumps(obj, indent=2, ensure_ascii=True)


# ---------------------------------------------------------------- 1. chain db
def build_disposable_chain():
    path = os.path.join(tempfile.gettempdir(), "laneA-manifest-chain.sqlite")
    if os.path.exists(path):
        os.remove(path)
    names = sorted(f for f in os.listdir(ACTIVE) if re.fullmatch(r"\d{4}_.+\.sql", f))
    for f in names:
        with open(os.path.join(ACTIVE, f)) as fh:
            subprocess.run(["/usr/bin/sqlite3", path], stdin=fh, check=True)
    return path, names


def inventory(db):
    rows = db.execute(
        "SELECT type, name FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'"
    ).fetchall()
    return {
        kind: sorted(r[1] for r in rows if r[0] == kind and not r[1].startswith("sqlite_autoindex_"))
        for kind in ("table", "index", "trigger", "view")
    }


def columns_of(db, table):
    return [
        {"name": name, "type": ctype, "notNull": bool(notnull), "default": dflt}
        for _cid, name, ctype, notnull, dflt, _pk in db.execute(f'PRAGMA table_info("{table}")')
    ]


# ------------------------------------------------------- 2. create-statement parser
def index_statements(migration_relpath):
    text = open(os.path.join(ROOT, migration_relpath)).read()
    out = {}
    for m in re.finditer(
        r"CREATE\s+(UNIQUE\s+)?INDEX\s+(`?\w+`?)\s+ON\s+(`?\w+`?)\s*\((.*?)\)\s*(WHERE\s+.*?)?;",
        text,
        re.S | re.I,
    ):
        unique, name, table, cols, where = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        out[name.strip("`")] = {
            "name": name.strip("`"),
            "table": table.strip("`"),
            "unique": bool(unique),
            "columns": cols.strip(),
            "tail": (where or "").rstrip(";").strip(),
            "sql": " ".join(m.group(0).split()),
            "source": migration_relpath,
        }
    return out


def definition_from(chain_column):
    parts = [chain_column["type"].lower()]
    if chain_column["default"] is not None:
        parts.append("DEFAULT " + chain_column["default"])
    if chain_column["notNull"]:
        parts.append("NOT NULL")
    return " ".join(parts)


# ---------------------------------------------------------------- 3. run
chain_path, chain_files = build_disposable_chain()
db = sqlite3.connect(f"file:{chain_path}?mode=ro", uri=True)
chain = inventory(db)
manifest = json.loads(open(CANON_MANIFEST, "rb").read().decode("utf-8"))

print("=== PRE-PATCH DELTA (manifest vs post-0010 chain) ===")
check(len(chain_files) == 11, f"canonical active chain has 11 SQL files ({len(chain_files)})")
check(manifest["counts"]["businessTables"] == len(manifest["tables"]) == len(chain["table"]), "table count agrees between manifest and chain")
check(sorted(t["name"] for t in manifest["tables"]) == chain["table"], "manifest table name set == chain table name set")
check(sorted(v["name"] for v in manifest["views"]) == chain["view"], "manifest view name set == chain view name set")
check(sorted(t["name"] for t in manifest["triggers"]) == chain["trigger"], "manifest trigger name set == chain trigger name set")
check(
    sorted(i["name"] for i in manifest["indexes"]) == sorted(set(chain["index"]) - {"profile_applicability_device_identity_idx"}),
    "the ONLY index missing from the manifest is profile_applicability_device_identity_idx (created by 0009)",
)

missing_cols = {}
for t in manifest["tables"]:
    want = {c["name"] for c in columns_of(db, t["name"])}
    have = {c["name"] for c in t["columns"]}
    if want != have:
        missing_cols[t["name"]] = (sorted(want - have), sorted(have - want))
check(
    missing_cols == {
        "profile_requirement_applicability": (["device_identity_ref", "requirement_source"], []),
        "requirement_intelligence_facts": (["device_identity_ref", "requirement_source"], []),
    },
    f"the ONLY columns missing from the manifest are the 0008/0010 discriminator pair on the two rebuilt tables ({missing_cols})",
)

# Nullability / default drift, scoped to the two rebuilt tables.
drift = []
for tname in REBUILT:
    t = next(x for x in manifest["tables"] if x["name"] == tname)
    for c in t["columns"]:
        meta = next((a for a in columns_of(db, tname) if a["name"] == c["name"]), None)
        if meta is None:
            continue
        if c["definition"].endswith(" NOT NULL") != meta["notNull"]:
            drift.append((tname, c["name"], "notNull", c["definition"], meta["notNull"]))
        has_default = " DEFAULT " in c["definition"]
        if has_default != (meta["default"] is not None):
            drift.append((tname, c["name"], "default", c["definition"], meta["default"]))
check(
    drift == [
        ("profile_requirement_applicability", "requirement_id", "notNull", "text NOT NULL", False),
        ("requirement_intelligence_facts", "requirement_id", "notNull", "text NOT NULL", False),
        ("requirement_intelligence_facts", "evidence_snippet", "notNull", "text NOT NULL", False),
        ("requirement_intelligence_facts", "review_status", "default", "text DEFAULT 'Needs Review' NOT NULL", None),
    ],
    f"definition drift on the two rebuilt tables is exactly the expected set ({drift})",
)
warn("W1 requirement_intelligence_facts.evidence_snippet: manifest+db/schema.ts say NOT NULL, but 0010's rebuild and the LIVE D1 have it NULLABLE. Unintended constraint loss inside 0010 -- NOT patched here (would require editing 0010 or db/schema.ts).")
warn("W2 requirement_intelligence_facts.review_status: 0010's rebuild and the LIVE D1 dropped DEFAULT 'Needs Review'. NOT patched here.")

# ---------------------------------------------------------------- 4. patch
m9_idx = index_statements(M9)
m10_idx = index_statements(M10)
check(
    set(m9_idx) == {"profile_applicability_requirement_idx", "profile_applicability_device_identity_idx", "profile_applicability_status_idx"},
    f"0009 creates exactly the three applicability indexes ({sorted(m9_idx)})",
)
check(
    set(m10_idx) == {"requirement_intelligence_profile_key_idx", "requirement_intelligence_review_idx"},
    f"0010 creates exactly the two intelligence indexes ({sorted(m10_idx)})",
)

out = json.loads(open(CANON_MANIFEST, "rb").read().decode("utf-8"))
# The only existing definitions this regeneration is allowed to rewrite: the two
# requirement_id columns that 0008/0010 made nullable. W1/W2 stay as they are.
REWRITE = {("profile_requirement_applicability", "requirement_id"), ("requirement_intelligence_facts", "requirement_id")}

# R1
out["target"]["cutoffMigration"] = M10_TAG

# R3 + R4 for tables
for t in out["tables"]:
    if t["name"] not in TABLE_SOURCE:
        continue  # not rebuilt by 0008/0009/0010 -> byte-identical carry-over
    known = {c["name"]: c for c in t["columns"]}
    columns = []
    for c in columns_of(db, t["name"]):
        prev = known.get(c["name"])
        if prev is not None and (t["name"], c["name"]) not in REWRITE:
            columns.append(prev)  # existing definition carried over verbatim
        else:
            columns.append({"name": c["name"], "definition": definition_from(c)})
    t["columns"] = columns
    t["source"] = TABLE_SOURCE[t["name"]]

# R4 + R5 for indexes
reassigned = {**m9_idx, **m10_idx}
for i in out["indexes"]:
    if i["name"] in reassigned:
        i.update(reassigned[i["name"]])
for name, entry in reassigned.items():
    if name not in {i["name"] for i in out["indexes"]}:
        out["indexes"].append(dict(entry))
out["indexes"].sort(key=lambda e: e["name"])

# R2
out["counts"] = {
    "businessTables": len(out["tables"]),
    "namedIndexes": len(out["indexes"]),
    "triggers": len(out["triggers"]),
    "views": len(out["views"]),
}

# R6
out["sourceSchema"] = {
    "dbSchemaSha256": hashlib.sha256(open(os.path.join(ROOT, "db", "schema.ts"), "rb").read()).hexdigest(),
    "legacyJournalSha256": hashlib.sha256(open(os.path.join(ROOT, "drizzle", "meta", "_journal.json"), "rb").read()).hexdigest(),
}

# ---------------------------------------------------------------- 5. post-conditions
print("\n=== POST-PATCH VERIFICATION ===")
check(sorted(t["name"] for t in out["tables"]) == chain["table"], "post-patch table name set == chain")
check(sorted(i["name"] for i in out["indexes"]) == chain["index"], f"post-patch index name set == chain ({len(chain['index'])})")
check(sorted(t["name"] for t in out["triggers"]) == chain["trigger"], "post-patch trigger name set == chain")
check(sorted(v["name"] for v in out["views"]) == chain["view"], "post-patch view name set == chain")
check(
    out["counts"] == {"businessTables": 314, "namedIndexes": 457, "triggers": 43, "views": 2},
    f"post-patch counts == chain counts ({out['counts']})",
)
bad_names = [t["name"] for t in out["tables"] if {c["name"] for c in columns_of(db, t["name"])} != {c["name"] for c in t["columns"]}]
check(bad_names == [], f"post-patch column NAME set == chain for all 314 tables ({bad_names})")
order_drift_before = sorted(t["name"] for t in manifest["tables"] if [c["name"] for c in columns_of(db, t["name"])] != [c["name"] for c in t["columns"]])
order_drift_after = sorted(t["name"] for t in out["tables"] if [c["name"] for c in columns_of(db, t["name"])] != [c["name"] for c in t["columns"]])
check(
    order_drift_after == sorted(set(order_drift_before) - set(REBUILT)) and set(REBUILT) <= set(order_drift_before),
    f"W3 pre-existing column-ORDER drift is untouched, and the two rebuilt tables are now in chain order (before={order_drift_before}, after={order_drift_after})",
)
for kind in ("tables", "indexes", "triggers", "views"):
    names = [e["name"] for e in out[kind]]
    check(names == sorted(names) and len(set(names)) == len(names), f"post-patch {kind} are sorted and unique")
missing_source = [e["source"] for key in ("tables", "indexes", "triggers", "views") for e in out[key] if not os.path.exists(os.path.join(ROOT, e["source"]))]
check(missing_source == [], f"every post-patch manifest source path exists on disk ({missing_source[:3]})")
check(out["manifestVersion"] == 1, "manifestVersion stays 1 (the shape is unchanged)")
check(out["sourceSchema"]["legacyJournalSha256"] == manifest["sourceSchema"]["legacyJournalSha256"], "legacyJournalSha256 is unchanged (it already matched the live legacy journal)")
check(
    hashlib.sha256(open(os.path.join(ROOT, "db", "schema.ts"), "rb").read()).hexdigest() == out["sourceSchema"]["dbSchemaSha256"],
    "dbSchemaSha256 now equals the live sha256(db/schema.ts)",
)
check(old := all(manifest[key] == out[key] for key in ("triggers", "views", "legacyMigrations")), "triggers, views and legacyMigrations are carried over byte-identical")
old_by_name = {t["name"]: t for t in manifest["tables"]}
touched_tables = {t["name"] for t in out["tables"] if old_by_name[t["name"]] != t}
check(touched_tables == set(REBUILT), f"exactly the two rebuilt table entries changed ({sorted(touched_tables)})")
old_by_name = {i["name"]: i for i in manifest["indexes"]}
touched_indexes = {i["name"] for i in out["indexes"] if i["name"] not in old_by_name or old_by_name[i["name"]] != i}
check(
    touched_indexes == {
        "profile_applicability_requirement_idx",
        "profile_applicability_device_identity_idx",
        "profile_applicability_status_idx",
        "requirement_intelligence_profile_key_idx",
        "requirement_intelligence_review_idx",
    },
    f"exactly five index entries changed/added ({sorted(touched_indexes)})",
)
check(not (set(old_by_name) - {i["name"] for i in out["indexes"]}), "no index was removed")
check("profile_applicability_drawing_ref_idx" not in {i["name"] for i in out["indexes"]}, "R5 profile_applicability_drawing_ref_idx (created by 0008, dropped by 0009) is absent from the target inventory")
coldef = {t["name"]: {c["name"]: c["definition"] for c in t["columns"]} for t in out["tables"]}
check(
    all(coldef[t]["requirement_source"] == "text DEFAULT 'Specification' NOT NULL" for t in REBUILT),
    "the two new requirement_source definitions match the sibling column style",
)
check(all(coldef[t]["device_identity_ref"] == "text" for t in REBUILT), "the two new device_identity_ref definitions match the sibling column style")
check(all(coldef[t]["requirement_id"] == "text" for t in REBUILT), "R3 requirement_id is recorded as nullable on both rebuilt tables")
check(
    all(coldef[t]["evidence_snippet"] == "text NOT NULL" and coldef[t]["review_status"] == "text DEFAULT 'Needs Review' NOT NULL" for t in ("requirement_intelligence_facts",)),
    "W1/W2 left visible in the manifest (NOT silently blessed)",
)

db.close()
os.remove(chain_path)

if problems:
    print(f"\n{len(problems)} PROBLEM(S); manifest NOT written")
    sys.exit(1)

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(dumps(out))
print(f"\nALL CHECKS PASSED ({len(warnings)} warning(s)) -> {OUT}")
print(f"target.cutoffMigration : {out['target']['cutoffMigration']}")
print(f"counts                 : {out['counts']}")
print(f"dbSchemaSha256         : {out['sourceSchema']['dbSchemaSha256']}")
