from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "outputs/historical-boq-learning/historical_boq_learning.json"
DB_PATH = ROOT / ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
RECOVERED_ROOT = ROOT / "outputs/historical-boq-learning/recovered/dialysis"
ARCHIVE_PATH = Path("/Users/serein-b/Downloads/projects/Dialysis Center Building -Makkah/Data/BOQ DIALYSIS CENTER MAKKAH - R03.rar")
ACTOR = "local-development-user"


def stable(prefix: str, value: str) -> str:
    return f"{prefix}_{hashlib.sha256(value.encode()).hexdigest()[:24]}"


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def norm(value) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def numeric_equal(left, right) -> bool:
    def parsed(value):
        try:
            return float(str(value).replace(",", "").strip())
        except (TypeError, ValueError):
            return None
    a, b = parsed(left), parsed(right)
    return a is not None and b is not None and abs(a - b) < 1e-9


def candidate_score(source: dict, final: dict) -> dict:
    source_desc, final_desc = norm(source.get("description")), norm(final.get("description"))
    similarity = SequenceMatcher(None, source_desc, final_desc).ratio() if source_desc and final_desc else 0.0
    source_terms, final_terms = set(source_desc.split()), set(final_desc.split())
    shared_terms = sorted(source_terms & final_terms)
    technical = [term for term in shared_terms if len(term) >= 4]
    item_equal = bool(norm(source.get("item"))) and norm(source.get("item")) == norm(final.get("ref"))
    unit_equal = bool(norm(source.get("unit"))) and norm(source.get("unit")) == norm(final.get("unit"))
    quantity_equal = numeric_equal(source.get("quantity"), final.get("quantity"))
    score = round(similarity * 35 + item_equal * 25 + unit_equal * 10 + quantity_equal * 10 + min(len(technical), 5) * 2, 2)
    independent_signals = sum((item_equal, unit_equal, quantity_equal, bool(technical)))
    if similarity >= .96 and independent_signals >= 3:
        label = "Likely Exact"
    elif score >= 68 and independent_signals >= 2:
        label = "Likely Strong"
    elif score >= 35:
        label = "Possible"
    else:
        label = "No Candidate"
    return {
        "score": score,
        "label": label,
        "descriptionSimilarity": round(similarity, 4),
        "itemEqual": item_equal,
        "unitEqual": unit_equal,
        "quantityEqual": quantity_equal,
        "unitDifference": None if unit_equal else f"{source.get('unit') or 'Unknown'} -> {final.get('unit') or 'Unknown'}",
        "quantityDifference": None if quantity_equal else f"{source.get('quantity') if source.get('quantity') is not None else 'Unknown'} -> {final.get('quantity') if final.get('quantity') is not None else 'Unknown'}",
        "sharedTechnicalTerms": technical[:12],
    }


def main() -> None:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    projects = {project["id"]: project for project in data["projects"]}
    dialysis = next(project for project in data["projects"] if "Dialysis" in project["name"])
    dialysis["pairBeforeRecovery"] = dialysis["pair"]
    dialysis["pair"] = "Partial Pair"
    dialysis["completion"].update({
        "sourceArchiveRecovered": True,
        "rowTraceableReviewedOutput": False,
        "pairEvidence": "Five source BOQ workbooks recovered from the RAR; issued quotation PDF exists but no reliably parsed final row-level output is available.",
    })

    recovered = []
    for path in sorted(RECOVERED_ROOT.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(RECOVERED_ROOT).as_posix()
        role = "Original Client BOQ" if "BOQ" in path.name.upper() else "Supporting Document"
        recovered.append({
            "id": stable("historicalFile", f"{dialysis['id']}|archive|{relative}"),
            "project_id": dialysis["id"],
            "path": str(path),
            "name": path.name,
            "checksum": checksum(path),
            "size": path.stat().st_size,
            "extension": path.suffix.lower(),
            "sheets": [],
            "role": role,
            "side": "Source",
            "revision": next(iter(re.findall(r"(?i)(?:rev|r)[ _-]?(\d+)", path.name)), None),
            "evidence": "Recovered from the Dialysis RAR using local archive extraction; role based on workbook content/name and requires human authority confirmation.",
            "confidence": 80,
            "human_review": 1,
            "readability": "Recovered / Readable Excel",
            "containerPath": str(ARCHIVE_PATH),
            "containerChecksum": checksum(ARCHIVE_PATH),
            "archiveMember": relative,
        })
    existing_checksums = {row["checksum"] for row in data["inventory"]}
    data["inventory"].extend(row for row in recovered if row["checksum"] not in existing_checksums)
    data["recoveredFiles"] = recovered

    blocked_paths = [
        "/Users/serein-b/Downloads/projects/Bab Al khair - Makkah/Data/Data-RFQ/Q1064-626-LCU-Bab Al khair - Makkah.xlsx",
        "/Users/serein-b/Downloads/projects/Bab Al khair - Makkah/Data/Data-RFQ/Q977-626-Data-.xlsx",
        "/Users/serein-b/Downloads/projects/Opera Block Townhouses-Diriyah/Data/Low Current/28.06 - Access Control System/Q545-226-ACS - NEDAP -ديوان المظالم.xlsx",
        "/Users/serein-b/Downloads/projects/Construction of The BTS Multifamily Plots for MARAFY Commercial Core- ICT-Jeddah/Data/Rev02/Quotation/Q1048-426-LCU - Construction of The BTS Multifamily Plots for MARAFY Commercial Core- ICT-Jeddah.xlsx",
    ]
    data["blockedFiles"] = [{
        "path": path,
        "project": next((project["name"] for project in data["projects"] if str(path).startswith(project["root"])), "Unknown"),
        "reason": "CDFV2 encrypted workbook; password required. Encryption was not bypassed.",
        "alternateEvidence": "Readable issued quotation PDF exists in the same historical project." if "Q1048" in path or "Q1064" in path else "No verified readable equivalent final cost sheet identified.",
    } for path in blocked_paths]

    source_by_id = {row["id"]: row for row in data["sourceRows"]}
    final_by_id = {row["id"]: row for row in data["finalRows"]}
    final_use = Counter(row["final_row_id"] for row in data["alignments"])
    source_use = Counter(row["source_row_id"] for row in data["alignments"])
    reviews = []
    split_merge = []
    for alignment in data["alignments"]:
        source, final = source_by_id[alignment["source_row_id"]], final_by_id[alignment["final_row_id"]]
        evidence = candidate_score(source, final)
        duplicate_final = final_use[final["id"]] > 1
        duplicate_source = source_use[source["id"]] > 1
        conflicts = []
        if not evidence["unitEqual"]: conflicts.append("Unit conflict")
        if not evidence["quantityEqual"]: conflicts.append("Quantity conflict")
        if duplicate_final: conflicts.append(f"Final row proposed for {final_use[final['id']]} source rows")
        if duplicate_source: conflicts.append(f"Source row has {source_use[source['id']]} proposed final rows")
        if duplicate_final:
            suggestion = "Possible Merge"
        elif duplicate_source:
            suggestion = "Possible Split"
        else:
            suggestion = "Needs Engineer Review"
        reviews.append({
            "alignmentId": alignment["id"], "projectId": alignment["project_id"],
            "sourceRowId": source["id"], "finalRowId": final["id"],
            "originalOutcome": alignment["outcome"], "reviewSuggestion": suggestion,
            "conflictingSignals": conflicts, "scoreComponents": evidence,
            "sameProject": source["project_id"] == final["project_id"] == alignment["project_id"],
            "humanDecision": "", "reviewerNotes": "", "reviewer": "", "reviewDate": "",
        })
        if suggestion in ("Possible Merge", "Possible Split"):
            split_merge.append(reviews[-1])
        alignment["eligible"] = 0
        alignment["reviewSuggestion"] = suggestion

    aligned_sources = {alignment["source_row_id"] for alignment in data["alignments"]}
    finals_by_project = defaultdict(list)
    for final in data["finalRows"]:
        finals_by_project[final["project_id"]].append(final)
    assistance = []
    for source in data["sourceRows"]:
        if source["id"] in aligned_sources or source["row_type"] == "Blank / Formatting":
            continue
        ranked = []
        for final in finals_by_project[source["project_id"]]:
            basis = candidate_score(source, final)
            if basis["score"] >= 25:
                ranked.append({"finalRowId": final["id"], "finalDescription": final.get("description"), "finalUnit": final.get("unit"), "finalQuantity": final.get("quantity"), **basis})
        ranked.sort(key=lambda row: (-row["score"], row["finalRowId"]))
        candidates = ranked[:5]
        assistance.append({
            "sourceRowId": source["id"], "projectId": source["project_id"], "fileId": source["file_id"],
            "sheet": source["sheet"], "row": source["row"], "section": source.get("section"),
            "sourceDescription": source.get("description"), "sourceUnit": source.get("unit"), "sourceQuantity": source.get("quantity"),
            "assistanceOutcome": candidates[0]["label"] if candidates else "No Candidate", "candidates": candidates,
            "reviewerSelectedCandidate": "", "alignmentDecision": "", "reviewerNotes": "", "reviewer": "", "reviewDate": "",
        })
    data["alignmentReviews"] = reviews
    data["splitMergeCandidates"] = split_merge
    data["unresolvedAssistance"] = assistance
    data["approvedGroundTruth"] = []
    data["activePatterns"] = []
    data["holdout"] = {
        "status": "Blocked", "completeGroundedProjects": 0,
        "reason": "No alignment has explicit human approval. Holdout requires at least three complete grounded pairs.",
    }

    before = data["liveTableCountsBefore"]
    connection = sqlite3.connect(DB_PATH)
    with connection:
        connection.execute("UPDATE historical_boq_projects SET learning_pair_status=?, completion_evidence=? WHERE id=?", (dialysis["pair"], json.dumps(dialysis["completion"]), dialysis["id"]))
        for row in recovered:
            connection.execute(
                "INSERT OR IGNORE INTO historical_boq_files (id,historical_project_id,path,file_name,checksum,size_bytes,extension,sheet_names,file_role,source_or_output,revision,role_evidence,role_confidence,human_review_required,readability) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (row["id"], row["project_id"], row["path"], row["name"], row["checksum"], row["size"], row["extension"], "[]", row["role"], row["side"], row["revision"], row["evidence"] + f" Container: {row['containerPath']}; member: {row['archiveMember']}", row["confidence"], 1, row["readability"]),
            )
        for review in reviews:
            connection.execute("UPDATE historical_boq_alignments SET eligible_for_learning=0, reviewer_status=? WHERE id=?", (review["reviewSuggestion"], review["alignmentId"]))
            connection.execute("UPDATE historical_boq_decisions SET eligible_for_boq_learning=0, eligible_for_product_learning=0 WHERE alignment_id=?", (review["alignmentId"],))
            audit_id = stable("histAudit", "alignment-review|" + review["alignmentId"])
            connection.execute(
                "INSERT OR IGNORE INTO historical_boq_audit_log (id,historical_project_id,entity_type,entity_id,action,new_value,reason,actor_user_id) VALUES (?,?,?,?,?,?,?,?)",
                (audit_id, review["projectId"], "Historical Alignment", review["alignmentId"], "Prepared for human review", json.dumps(review), "Deterministic safety revalidation; no approval granted.", ACTOR),
            )
        connection.execute("UPDATE historical_boq_patterns SET active_status='Inactive', human_review_status='Needs Review'")
    after = {table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in before}
    if before != after:
        raise RuntimeError(f"Live project tables changed: {before} -> {after}")
    data["liveTableCountsAfter"] = after
    DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")
    print(json.dumps({
        "recovered": len(recovered), "reviews": len(reviews),
        "reviewSuggestions": dict(Counter(row["reviewSuggestion"] for row in reviews)),
        "unresolvedQueue": len(assistance), "withCandidates": sum(bool(row["candidates"]) for row in assistance),
        "blocked": len(data["blockedFiles"]), "approved": 0, "activePatterns": 0,
    }))


if __name__ == "__main__":
    main()
