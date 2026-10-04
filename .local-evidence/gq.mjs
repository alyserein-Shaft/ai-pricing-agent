// Knowledge-architecture graph query helper. READ-ONLY over graphify-out/graph.json.
// Usage: node .local-evidence/gq.mjs <mode> [arg]
import { readFileSync } from "node:fs";

const g = JSON.parse(readFileSync("graphify-out/graph.json", "utf8"));
const N = g.nodes;
const L = g.links;
const byId = new Map(N.map((n) => [n.id, n]));

const KNOWN = [
  "knowledge", "fact", "promotion", "taxonomy", "compat", "product", "identity",
  "supplier", "price", "quotation", "requirement", "profile", "matching", "source",
  "register", "library", "engineering", "lifecycle", "certification", "attribute",
];

const mode = process.argv[2] || "communities";
const arg = process.argv[3] || "";

if (mode === "communities") {
  const c = new Map();
  for (const n of N) {
    const k = n.community_name || "(none)";
    c.set(k, (c.get(k) || 0) + 1);
  }
  [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log(String(v).padStart(6), k));
} else if (mode === "filetypes") {
  const c = new Map();
  for (const n of N) c.set(n.file_type || "(none)", (c.get(n.file_type || "(none)") || 0) + 1);
  [...c.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(6), k));
} else if (mode === "relations") {
  const c = new Map();
  for (const l of L) c.set(l.relation, (c.get(l.relation) || 0) + 1);
  [...c.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(6), k));
} else if (mode === "find") {
  const q = arg.toLowerCase();
  const hits = N.filter((n) => (n.label || "").toLowerCase().includes(q) || (n.source_file || "").toLowerCase().includes(q));
  console.log("hits:", hits.length);
  const byFile = new Map();
  for (const h of hits) byFile.set(h.source_file, (byFile.get(h.source_file) || 0) + 1);
  [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([f, c]) => console.log(String(c).padStart(5), f));
} else if (mode === "symbols") {
  const q = arg.toLowerCase();
  const hits = N.filter((n) => (n.label || "").toLowerCase().includes(q));
  console.log("hits:", hits.length);
  hits.slice(0, 40).forEach((h) =>
    console.log(`  ${h.label}  [${h.file_type}] ${h.source_file}${h.source_location ? ":" + h.source_location : ""}`),
  );
} else if (mode === "files") {
  const q = arg.toLowerCase();
  const files = [...new Set(N.map((n) => n.source_file).filter((f) => f && f.toLowerCase().includes(q)))];
  console.log("files:", files.length);
  files.forEach((f) => console.log("  " + f));
} else if (mode === "edges") {
  // show relations touching nodes whose label matches arg
  const q = arg.toLowerCase();
  const ids = new Set(N.filter((n) => (n.label || "").toLowerCase().includes(q)).map((n) => n.id));
  const out = L.filter((l) => ids.has(l.source) || ids.has(l.target));
  console.log("edges touching", ids.size, "nodes:", out.length);
  const c = new Map();
  for (const l of out) c.set(l.relation, (c.get(l.relation) || 0) + 1);
  [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, v]) => console.log(String(v).padStart(5), k));
  console.log("--- sample ---");
  out.slice(0, 12).forEach((l) =>
    console.log(`  ${(byId.get(l.source)?.label || l.source).slice(0, 40)} -[${l.relation}]-> ${(byId.get(l.target)?.label || l.target).slice(0, 40)}  (${l.source_file})`),
  );
} else if (mode === "hyper") {
  for (const h of g.hyperedges) console.log(`${h.relation}: ${h.label}  (${(h.nodes || []).length} nodes) ${h.source_file}`);
}
