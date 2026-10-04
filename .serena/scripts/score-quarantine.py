#!/usr/bin/env python3
"""Stage 4Z — Score quarantined benchmark results."""
import json, re

def norm(v):
    return re.sub(r'[^\w]+', ' ', str(v or '')).lower().strip()

def norm_loose(v):
    return norm(v).replace('°', '').replace(' ', '')

OVER_INFERENCE_RULES = [
    {"name": "brand-from-vendor", "pattern": re.compile(r'notifier|farenhyt', re.I), "allowed": re.compile(r'notifier|farenhyt', re.I), "premise": re.compile(r'honeywell', re.I)},
    {"name": "panel-model-from-role", "pattern": re.compile(r'\b(IFP|NFS|ONYX|AFP|ES-|NCA)[\w-]*\d', re.I), "allowed": None, "premise": re.compile(r'MFACP|FACP|control panel', re.I)},
    {"name": "protocol-owner-from-slc", "pattern": re.compile(r'flashscan|clip\b', re.I), "allowed": re.compile(r'flashscan|clip', re.I), "premise": re.compile(r'SLC|loop', re.I)},
]
STANDARD_AS_TARGET = re.compile(r'(UL|NFPA|EN\s?54|FM|BS\s?\d+|IEC)', re.I)

def detect_over_inference(output, source_text):
    src = str(source_text or "")
    hay = json.dumps(output.get("compatibilityTargets", []))
    hits = []
    for rule in OVER_INFERENCE_RULES:
        if rule["pattern"].search(hay):
            grounded = bool(rule["allowed"].search(src)) if rule["allowed"] else False
            if not grounded and (not rule["premise"] or rule["premise"].search(src)):
                hits.append(rule["name"])
    for c in output.get("compatibilityTargets", []):
        if STANDARD_AS_TARGET.search(c.get("target", "")) and STANDARD_AS_TARGET.search(src):
            hits.append("standard-as-target")
            break
    return list(set(hits))

def detect_hallucinations(output, source_text, context_text=""):
    src = f"{source_text or ''}\n{context_text or ''}"
    def grounded(s):
        if not s:
            return True
        words = norm(s).split()
        return all(len(w) <= 2 or w in norm(src) for w in words if w)
    hits = []
    for m in output.get("manufacturers", []):
        name = m if isinstance(m, str) else m.get("manufacturer", m.get("name", ""))
        if not grounded(name):
            hits.append(f"manufacturer:{name}")
    for a in output.get("attributes", []):
        if not grounded(a.get("value", "")):
            hits.append(f"attribute:{(a.get('name','') + ' ' + a.get('value',''))[:80]}")
    for c in output.get("compatibilityTargets", []):
        if not grounded(c.get("target", "")):
            hits.append(f"compat:{c.get('target','')[:60]}")
    return hits

def score_item(output, truth, source_text):
    if not output:
        return {"schemaValid": False, "error": "no-output"}
    
    fam_out = norm_loose(output.get("equipmentFamily", {}).get("value", ""))
    fam_exp = norm_loose(truth["family"]) if truth.get("family") else None
    fam_ok = None if fam_exp is None else (fam_out == fam_exp or ("detector" in fam_exp and "detector" in fam_out))
    
    scope_ok = output.get("scope", {}).get("value") == truth.get("scope")
    
    role_set = set(output.get("role", []))
    roles_exp = truth.get("roles", [])
    role_ok = None if not roles_exp else any(r in role_set for r in roles_exp)
    
    exp_attrs = truth.get("attributes", [])
    got_attrs = output.get("attributes", [])
    def match_attr(e):
        return any(norm_loose(g.get("name","")) == norm_loose(e.get("name","")) and 
                   (norm_loose(g.get("value","")).find(norm_loose(e.get("value",""))) >= 0 or
                    norm_loose(e.get("value","")).find(norm_loose(g.get("value",""))) >= 0)
                   for g in got_attrs)
    attr_recall = len([a for a in exp_attrs if match_attr(a)]) / len(exp_attrs) if exp_attrs else None
    attr_prec = len([g for g in got_attrs if any(norm_loose(g.get("name","")) == norm_loose(e.get("name","")) for e in exp_attrs)]) / len(got_attrs) if got_attrs else None
    
    std_out = set(norm_loose(s) for s in output.get("standards", []))
    std_exp = [norm_loose(s) for s in truth.get("standards", [])]
    std_recall = len([s for s in std_exp if any(o.find(s) >= 0 or s.find(o) >= 0 for o in std_out)]) / len(std_exp) if std_exp else None
    
    compat_out = [norm_loose(c.get("target","")) for c in output.get("compatibilityTargets", [])]
    compat_exp = [norm_loose(c) for c in truth.get("compat", [])]
    compat_recall = len([c for c in compat_exp if any(o.find(c) >= 0 or c.find(o) >= 0 for o in compat_out)]) / len(compat_exp) if compat_exp else None
    
    compound_ok = output.get("compoundRequirement") == truth.get("compound")
    
    non_match_ok = None
    if truth.get("nonMatching"):
        non_match_ok = output.get("applicability", {}).get("state") == "NON_MATCHING" or \
                       any(r in ["COMMERCIAL", "TESTING", "INFORMATIONAL", "INSTALLATION"] for r in output.get("role", []))
    
    route = output.get("recommendedGovernanceRoute", "")
    app_state = output.get("applicability", {}).get("state", "")
    esc_out = route in ("HUMAN_ENGINEERING_REVIEW", "PROJECT_CLARIFICATION") or app_state == "ENGINEER_DECISION"
    esc_exp = truth.get("escalate", False)
    
    return {
        "schemaValid": True, "famOk": fam_ok, "scopeOk": scope_ok, "roleOk": role_ok,
        "attrRecall": attr_recall, "attrPrec": attr_prec,
        "stdRecall": std_recall, "compatRecall": compat_recall,
        "compoundOk": compound_ok, "nonMatchOk": non_match_ok,
        "escOut": esc_out, "escExp": esc_exp,
        "hallucinations": detect_hallucinations(output, source_text),
        "overInference": detect_over_inference(output, source_text),
    }

def score_model(results, label):
    print(f"\n{'='*60}")
    print(f"=== {label} ===")
    print(f"{'='*60}")
    
    total = len(results)
    valid = sum(1 for r in results if r.get("validation", {}).get("valid"))
    errors = sum(1 for r in results if r.get("error"))
    with_output = sum(1 for r in results if r.get("output"))
    print(f"Total: {total} | Valid JSON: {valid}/{total} ({round(valid/total*100)}%) | With output: {with_output} | Errors: {errors}")
    
    dims = {}
    all_hallucinations = []
    all_over_inference = []
    
    for r in results:
        n = r.get("n")
        out = r.get("output")
        if not out or n not in gt_map:
            continue
        gt = gt_map[n]
        src = req_map.get(n, {}).get("text", "")
        s = score_item(out, gt, src)
        
        for dim in ["famOk", "scopeOk", "roleOk", "compoundOk", "nonMatchOk"]:
            val = s.get(dim)
            if val is None: continue
            if dim not in dims: dims[dim] = [0, 0]
            dims[dim][0] += 1
            if val: dims[dim][1] += 1
        
        for dim in ["attrRecall", "attrPrec", "stdRecall", "compatRecall"]:
            val = s.get(dim)
            if val is None: continue
            if dim not in dims: dims[dim] = [0, 0.0]
            dims[dim][0] += 1
            dims[dim][1] += val
        
        all_hallucinations.extend([(n, h) for h in s.get("hallucinations", [])])
        all_over_inference.extend([(n, o) for o in s.get("overInference", [])])
    
    gt_count = len(gt_map)
    print(f"\nDimension Scores (against {gt_count} ground-truth cases):")
    for dim in ["famOk", "scopeOk", "roleOk", "compoundOk", "nonMatchOk", "attrRecall", "attrPrec", "stdRecall", "compatRecall"]:
        if dim not in dims: continue
        t, c = dims[dim]
        if t == 0: continue
        pct = round(c / t * 100)
        emoji = "🟢" if pct >= 80 else "🔵" if pct >= 60 else "🟡" if pct >= 40 else "🔴"
        if isinstance(c, float):
            print(f"  {emoji} {dim}: {c:.1f}/{t} ({pct}%)")
        else:
            print(f"  {emoji} {dim}: {c}/{t} ({pct}%)")
    
    print(f"\nHallucinations: {len(all_hallucinations)}")
    for n, h in all_hallucinations[:15]:
        print(f"  🔴 #{n}: {h}")
    if len(all_hallucinations) > 15:
        print(f"  ... and {len(all_hallucinations)-15} more")
    
    print(f"Over-inference: {len(all_over_inference)}")
    for n, o in all_over_inference[:15]:
        print(f"  🔴 #{n}: {o}")
    if len(all_over_inference) > 15:
        print(f"  ... and {len(all_over_inference)-15} more")
    
    latencies = sorted([r.get("latencyMs", 0) for r in results if r.get("latencyMs")])
    if latencies:
        print(f"\nLatency: median={latencies[len(latencies)//2]}ms, p95={latencies[int(len(latencies)*0.95)]}ms, mean={round(sum(latencies)/len(latencies))}ms")
    
    # Req 197
    for r in results:
        if r.get("n") == 197 and r.get("output"):
            out = r["output"]
            print(f"\n--- Requirement 197 ---")
            print(f"  Family: {out.get('equipmentFamily',{}).get('value','MISSING')}")
            print(f"  System: {out.get('system',{}).get('value','MISSING')}")
            print(f"  Scope: {out.get('scope',{}).get('value','MISSING')}")
            print(f"  Roles: {out.get('role',[])}")
            print(f"  Compound: {out.get('compoundRequirement','')}")
            for a in out.get("attributes", []):
                print(f"  Attr: {a.get('name')}: {a.get('value')} {a.get('unit','')} ({a.get('origin','')})")
            print(f"  Standards: {out.get('standards',[])}")
            print(f"  Route: {out.get('recommendedGovernanceRoute','')}")
            break
    
    return dims, all_hallucinations, all_over_inference

# Load data
gt_data = json.load(open("tmp/benchmark-ground-truth.json"))
gt_map = {i["n"]: i for i in gt_data["items"]}
req_data = json.load(open("tmp/benchmark-requirements.json"))
req_map = {i["n"]: i for i in req_data["items"]}

results_A = json.load(open("tmp/bench4z-quarantine/benchmark-results-A.json"))
results_B = json.load(open("tmp/bench4z-quarantine/benchmark-results-B.json"))
results_C = json.load(open("tmp/bench4z-quarantine/benchmark-results-C.json"))

# Deduplicate B (has 186 entries due to re-runs; keep first valid per requirement)
seen_B = {}
for r in results_B:
    n = r.get("n")
    if n not in seen_B or (r.get("output") and not seen_B[n].get("output")):
        seen_B[n] = r
results_B_dedup = list(seen_B.values())

dims_A, hall_A, over_A = score_model(results_A, "Model A: Llama 3.1 8B")
dims_B, hall_B, over_B = score_model(results_B_dedup, "Model B: Llama 3.3 70B (deduplicated)")

print(f"\n{'='*60}")
print(f"=== Model C: Qwen 3.8 27B ===")
print(f"{'='*60}")
print(f"Total: 93 | Valid JSON: 0/93 (0%) | Errors: 93")
print(f"ALL ERRORS: Cloudflare Workers AI daily allocation exhausted")
print(f"SCORE: 🔴 UNSAFE / FAILED — could not be evaluated")

# Comparison table
print(f"\n{'='*60}")
print(f"=== COMPARISON SUMMARY ===")
print(f"{'='*60}")
print(f"{'Dimension':<25} {'A (8B)':>10} {'B (70B)':>10} {'C (Qwen)':>10}")
print("-" * 55)

all_dims_list = ["famOk", "scopeOk", "roleOk", "compoundOk", "nonMatchOk", "attrRecall", "attrPrec", "stdRecall", "compatRecall"]
for dim in all_dims_list:
    row = f"{dim:<25}"
    for dims in [dims_A, dims_B]:
        if dim in dims:
            t, c = dims[dim]
            pct = f"{round(c/t*100)}%"
            row += f" {pct:>10}"
        else:
            row += f" {'—':>10}"
    row += f" {'N/A':>10}"
    print(row)

print(f"\n{'Hallucinations':<25} {len(hall_A):>10} {len(hall_B):>10} {'N/A':>10}")
print(f"{'Over-inference':<25} {len(over_A):>10} {len(over_B):>10} {'N/A':>10}")
