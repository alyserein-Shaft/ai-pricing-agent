import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { analyzeConflict } from "../app/domain/identity-resolution-engine.mjs";
import { actorCanAccessScope, productScope, resolvePairScope } from "../worker/library-scope.mjs";

const global = (id) => ({ id, library_scope: "Global Library", organization_id: null, library_project_id: null });
const organization = (id, owner) => ({ id, library_scope: "Organization Library", organization_id: owner, library_project_id: null });
const project = (id, owner, organizationId = null) => ({ id, library_scope: "Project Library", organization_id: organizationId, library_project_id: owner });

test("scope resolution permits only identical ownership boundaries", () => {
  assert.equal(resolvePairScope([global("a"), global("b")]).scope.libraryScope, "Global Library");
  assert.equal(resolvePairScope([organization("a", "org-a"), organization("b", "org-a")]).scope.organizationId, "org-a");
  assert.equal(resolvePairScope([project("a", "p-a"), project("b", "p-a")]).scope.projectId, "p-a");
  for (const pair of [
    [global("a"), organization("b", "org-a")],
    [global("a"), project("b", "p-a")],
    [organization("a", "org-a"), organization("b", "org-b")],
    [project("a", "p-a"), project("b", "p-b")],
  ]) assert.equal(resolvePairScope(pair).error.code, "IDENTITY_SCOPE_CONFLICT");
  assert.equal(productScope({ id: "bad", library_scope: "Organization Library" }).error.code, "PRODUCT_SCOPE_MISMATCH");
});

test("scope conflict terminates identity analysis as Needs Review", async () => {
  const conflict = { id: "c", conflict_type: "Identity Collision", left_value: JSON.stringify({ partNumber: "MODEL-1." }), right_value: JSON.stringify({ partNumber: "MODEL-1" }), source_ids: "{}" };
  const products = [
    { ...global("a"), part_number: "MODEL-1", normalized_part_number: "MODEL-1", description: "Same product", manufacturer: "Honeywell", brand: "Farenhyt", attributes: "[]", standards: "[]" },
    { ...organization("b", "org-a"), part_number: "MODEL-1.", normalized_part_number: "MODEL-1.", description: "Same product", manufacturer: "Honeywell", brand: "Farenhyt", attributes: "[]", standards: "[]" },
  ];
  const result = await analyzeConflict(conflict, products, { scopeConflict: true });
  assert.equal(result.outcome, "Needs Review");
  assert.equal(result.classification, "Scope Conflict");
  assert.equal(result.terminalRule, "IR-001");
});

const dbAdapter = (raw) => ({ prepare(sql) { const op = (args = []) => ({ first: async () => raw.prepare(sql).get(...args) }); return { ...op(), bind(...args) { return op(args); } }; } });

test("organization and project membership enforce immediate server-side isolation", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE organization_memberships (id text,organization_id text,user_id text,status text,revoked_at text);
    CREATE TABLE projects (id text,organization_id text,owner_user_id text);
    CREATE TABLE project_members (id text,project_id text,user_id text,status text,revoked_at text);
    INSERT INTO organization_memberships VALUES ('ma','org-a','user-a','Active',NULL);
    INSERT INTO projects VALUES ('project-a','org-a','owner-a');
    INSERT INTO project_members VALUES ('pa','project-a','user-a','Active',NULL);
  `);
  const db = dbAdapter(raw), actor = { id: "user-a" };
  assert.equal(await actorCanAccessScope(db, actor, { libraryScope: "Organization Library", organizationId: "org-a", projectId: null }), null);
  assert.equal((await actorCanAccessScope(db, actor, { libraryScope: "Organization Library", organizationId: "org-b", projectId: null })).code, "ORGANIZATION_ACCESS_DENIED");
  assert.equal(await actorCanAccessScope(db, actor, { libraryScope: "Project Library", organizationId: "org-a", projectId: "project-a" }), null);
  raw.prepare("UPDATE organization_memberships SET status='Revoked',revoked_at=CURRENT_TIMESTAMP WHERE id='ma'").run();
  assert.equal((await actorCanAccessScope(db, actor, { libraryScope: "Organization Library", organizationId: "org-a", projectId: null })).code, "ORGANIZATION_ACCESS_DENIED");
  assert.equal((await actorCanAccessScope(db, actor, { libraryScope: "Project Library", organizationId: "org-a", projectId: "project-a" })).code, "ORGANIZATION_ACCESS_DENIED");
  raw.close();
});
