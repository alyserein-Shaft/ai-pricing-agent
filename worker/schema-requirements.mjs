const schemaError = (missing) => {
  const error = new Error(`DATABASE_SCHEMA_MISSING: required migration tables are absent: ${missing.join(", ")}. Apply the ordered Drizzle migrations before starting the application.`);
  error.code = "DATABASE_SCHEMA_MISSING";
  error.missingTables = missing;
  return error;
};

export const requireMigratedTables = async (db, tableNames) => {
  const expected = [...new Set(tableNames)].sort();
  if (!expected.length) return;
  const placeholders = expected.map(() => "?").join(",");
  const result = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`,
  ).bind(...expected).all();
  const present = new Set((result.results || []).map((row) => row.name));
  const missing = expected.filter((name) => !present.has(name));
  if (missing.length) throw schemaError(missing);
};
