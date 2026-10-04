import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  canApproveTechnicalSafety,
  canApproveCommercialPrice,
  canApproveQuotation,
  resolveProjectAuthority,
} from "../worker/project-authority.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
});

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE project_members(
      id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, role TEXT,
      status TEXT, revoked_at TEXT
    );
    INSERT INTO projects VALUES ('p1', 'owner-1');
    INSERT INTO project_members VALUES
      ('m1', 'p1', 'member-1', 'Commercial Approver', 'Active', NULL),
      ('m2', 'p1', 'revoked-1', 'Project Manager', 'Revoked', '2026-01-01T00:00:00Z');
  `);
  return { raw, db: d1(raw) };
};

test("project authority uses the active project member role before owner fallback", async () => {
  const { raw, db } = fixture();
  const owner = await resolveProjectAuthority(db, {
    projectId: "p1",
    actor: { id: "owner-1", fullAccess: true, role: "Administrator" },
  });
  const member = await resolveProjectAuthority(db, {
    projectId: "p1",
    actor: { id: "member-1", fullAccess: false, role: "Administrator" },
  });
  assert.deepEqual(owner, { projectId: "p1", role: "Project Manager", source: "owner" });
  assert.deepEqual(member, { projectId: "p1", role: "Commercial Approver", source: "project_member" });
  assert.equal(await resolveProjectAuthority(db, { projectId: "p1", actor: { id: "revoked-1" } }), null);
  raw.close();
});

test("fullAccess is an explicit administrator fallback, not a generic project role", async () => {
  const { raw, db } = fixture();
  const admin = await resolveProjectAuthority(db, {
    projectId: "p1",
    actor: { id: "not-a-member", fullAccess: true, role: "Administrator" },
  });
  const nonAdmin = await resolveProjectAuthority(db, {
    projectId: "p1",
    actor: { id: "not-a-member", fullAccess: true, role: "Estimator" },
  });
  assert.deepEqual(admin, { projectId: "p1", role: "Administrator", source: "application_admin" });
  assert.equal(nonAdmin, null);
  raw.close();
});

test("material approval capabilities use only existing project vocabulary", () => {
  for (const role of ["Technical Reviewer", "Senior Technical Reviewer", "Engineering Reviewer", "Project Manager", "Management", "Administrator"]) {
    assert.equal(canApproveTechnicalSafety(role), true, role);
  }
  for (const role of ["Estimator", "Commercial Approver"]) {
    assert.equal(canApproveTechnicalSafety(role), false, role);
  }
  for (const role of ["Commercial Reviewer", "Commercial Manager", "Commercial Approver", "Project Manager", "Management", "Administrator"]) {
    assert.equal(canApproveCommercialPrice(role), true, role);
    assert.equal(canApproveQuotation(role), true, role);
  }
  for (const role of ["Estimator", "Technical Reviewer"]) {
    assert.equal(canApproveCommercialPrice(role), false, role);
    assert.equal(canApproveQuotation(role), false, role);
  }
});
