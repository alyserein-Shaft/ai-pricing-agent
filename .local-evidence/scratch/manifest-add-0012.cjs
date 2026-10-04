const fs = require("fs");
const files = ["drizzle-active/manifest.json", "dist/.openai/drizzle/manifest.json"];
const TABLE = "estimator_understanding_field_reviews";
const IDX = [
  { name: "estimator_understanding_field_reviews_interpretation_field_idx", table: TABLE, unique: true, columns: "`interpretation_id`,`field_key`", tail: "" },
  { name: "estimator_understanding_field_reviews_item_idx", table: TABLE, unique: false, columns: "`project_id`,`boq_item_id`", tail: "" },
  { name: "estimator_understanding_field_reviews_decision_idx", table: TABLE, unique: false, columns: "`project_id`,`decision`", tail: "" },
];
const COLUMNS = [
  { name: "id", definition: "text PRIMARY KEY NOT NULL" },
  { name: "project_id", definition: "text NOT NULL" },
  { name: "boq_item_id", definition: "text NOT NULL" },
  { name: "interpretation_id", definition: "text NOT NULL" },
  { name: "field_key", definition: "text NOT NULL" },
  { name: "decision", definition: "text NOT NULL" },
  { name: "proposed_value", definition: "text NOT NULL" },
  { name: "confirmed_value", definition: "text" },
  { name: "source_input_fingerprint", definition: "text NOT NULL" },
  { name: "review_reason", definition: "text NOT NULL" },
  { name: "reviewed_by", definition: "text NOT NULL" },
  { name: "created_at", definition: "text DEFAULT CURRENT_TIMESTAMP NOT NULL" },
];
for (const p of files) {
  if (!fs.existsSync(p)) { console.log("skip (absent)", p); continue; }
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  if (m.tables.some((t) => t.name === TABLE)) { console.log("already present", p); continue; }
  m.tables.push({ name: TABLE, source: "drizzle-active/0012_military_havok.sql", columns: COLUMNS });
  m.tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const i of IDX) {
    m.indexes.push({
      name: i.name, table: i.table, unique: i.unique, columns: i.columns, tail: "",
      sql: `CREATE ${i.unique ? "UNIQUE " : ""}INDEX \`${i.name}\` ON \`${i.table}\` (${i.columns});`,
      source: "drizzle-active/0012_military_havok.sql",
    });
  }
  m.indexes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  m.counts.businessTables = m.tables.length;
  m.counts.namedIndexes = m.indexes.length;
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  console.log("updated", p, JSON.stringify(m.counts));
}
