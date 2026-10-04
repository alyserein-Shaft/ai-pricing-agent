// KN-DECISION-1/ACTOR -- who is allowed to make a Knowledge decision, and what
// that authorisation actually means.
//
// WHY THIS IS A SEPARATE FILE. `worker/human-actor.mjs` already guarantees that a
// configured identity is a real human and never a synthetic one. That guarantee
// is necessary but not sufficient, and the gap is the reason this file exists:
//
//   1. The orchestrator takes `humanActor` as a PARAMETER. The route resolves it
//      from server configuration, but the orchestrator is also called directly
//      (by tests, and by anything that imports the module). A parameter that is
//      not itself checked is a parameter that will eventually be passed
//      `local-development-user` by something. So the orchestrator re-verifies
//      the actor rather than trusting its caller.
//   2. `humanActor.synthetic` and `source` are ATTESTATIONS. A caller can pass
//      `synthetic: false` for any id it likes. The only attestation worth
//      anything is `source === "server-config"`, and even that is a claim -- so it
//      is checked for consistency rather than accepted on faith, and the audit
//      row records it so a later reader can tell a config-derived actor from an
//      asserted one.
//   3. The Batch-1 research findings are attributed to `local-development-user`,
//      which is a legitimate DISCOVERY actor. The same id must never be able to
//      APPROVE. "Research authored it" and "a human approved it" are different
//      acts and the audit trail has to be able to say which happened.
//
// The authority-model finding this file documents rather than invents a fix for:
// `worker/library-auth.mjs` has four roles (Library Viewer, Library Reviewer,
// Library Manager, Administrator) and no engineering-authority role. So there is
// no "Technical Manager" to wire. The gap is reported, not papered over with a
// role that does not exist.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resolveHumanActor, requireHumanActor } from "../worker/human-actor.mjs";
import { HUMAN_ACTOR_SOURCE, isHumanDecisionActor } from "../app/domain/human-authority.mjs";
import {
  LIBRARY_CAPABILITIES,
  hasLibraryCapability,
  requireLibraryCapability,
} from "../worker/library-auth.mjs";
import {
  confirmKnowledgeDecisionPacket,
  PACKET_DECISION_ERRORS,
} from "../worker/knowledge-decision-orchestration.mjs";
import { reviewSourceAuthority, SOURCE_AUTHORITY_REVIEW_STATUSES } from "../app/domain/knowledge-source-authority-review.mjs";
import {
  HUMAN as HUMAN_FIXTURE,
  asD1,
  createMigratedDatabase,
  seedKnowledgeFile,
  seedManufacturer,
  seedOrganization,
  seedProduct,
  seedResearchFact,
  testIds,
} from "./helpers/decision-packet-db.mjs";

const ORG = "org_decision_packets";
const DOC = "knowledgeFile_actor_1";
const PART = "IFP-2100HVB";
const PRODUCT = "product_actor_1";

const HUMAN = HUMAN_FIXTURE;

const seed = () => {
  const raw = createMigratedDatabase();
  seedOrganization(raw, ORG);
  seedManufacturer(raw, { id: "man_honeywell", name: "Honeywell" });
  seedProduct(raw, { id: PRODUCT, partNumber: PART, manufacturerId: "man_honeywell" });
  // Seeded stale: the correction path only ever repairs an Unknown, so anything
  // else would be answered by the class guard before the actor guard is reached.
  seedKnowledgeFile(raw, {
    id: DOC,
    organizationId: ORG,
    fileName: "honeywell-350286-datasheet.pdf",
    authorityClass: "Unknown Source Authority",
    targetContext: { sourceUrl: "https://prod-edam.honeywell.com/content/dam/honeywell/350286.pdf" },
  });
  seedResearchFact(raw, {
    id: "fact_actor_1",
    fileId: DOC,
    factType: "Address Model",
    value: "the detector head occupies one loop address of its own",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "obs_actor_1",
  });
  return { raw, db: asD1(raw) };
};

const decide = (db, overrides = {}) => {
  const { newId, stamp } = testIds();
  return confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: "PLACEHOLDER",
    decision: "confirm",
    reason: "First-party datasheet states the head occupies one loop address of its own.",
    humanActor: HUMAN,
    idempotencyKey: `actor-${Math.random()}`,
    newId,
    stamp,
    ...overrides,
  });
};

/** Resolve the single real packet in a seeded database. */
const packetIdOf = async (db) => {
  const { loadKnowledgeDecisionPackets } = await import("../app/domain/knowledge-decision-packet.mjs");
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  return packets[0]?.packetId;
};

// ---------------------------------------------------------------------------
// A. The orchestrator re-verifies the actor; it does not trust its caller
// ---------------------------------------------------------------------------
test("KN-DECISION-1/ACTOR/A every synthetic identity is refused as a decision-maker", async () => {
  const { raw, db } = seed();
  const packetId = await packetIdOf(db);
  // These are the ids `resolveHumanActor` itself rejects, plus the ones an
  // unconfigured local environment falls back to. Each is the id a real
  // deployment has actually used in place of a human, so each is worth pinning.
  for (const id of [
    "local-development-user",
    "LOCAL-DEVELOPMENT-USER",
    "system",
    "administrator",
    "admin",
    "unknown",
    "anonymous",
  ]) {
    const result = await decide(db, {
      packetId,
      humanActor: { id, name: "Batch 1 Research", source: HUMAN_ACTOR_SOURCE },
    });
    assert.equal(
      result.code,
      PACKET_DECISION_ERRORS.HUMAN_ACTOR_REQUIRED,
      `${id} must never be able to approve canonical truth`,
    );
  }
  // Nothing was written by any of them.
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_facts WHERE review_status='Reviewed'").get().c, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_attributes").get().c, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c, 0);
});

test("KN-DECISION-1/ACTOR/A an actor with no server-config source is refused", async () => {
  const { raw, db } = seed();
  const packetId = await packetIdOf(db);
  // The id looks like a real human and `synthetic: false` is asserted, so only
  // the missing provenance source distinguishes this from a genuine decision.
  for (const source of [undefined, null, "", "request", "client", "local-development-user"]) {
    const result = await decide(db, {
      packetId,
      humanActor: { id: "omair-primary", name: "Omair", source, synthetic: false },
    });
    assert.equal(
      result.code,
      PACKET_DECISION_ERRORS.HUMAN_ACTOR_REQUIRED,
      `source "${source}" is not a server-configured identity`,
    );
  }
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c, 0);
});

test("KN-DECISION-1/ACTOR/A the same check applies to the source-authority correction", async () => {
  const { raw, db } = seed();
  const { newId, stamp } = testIds();
  for (const humanActor of [
    { id: "local-development-user", name: "Batch 1 Research", source: HUMAN_ACTOR_SOURCE },
    { id: "omair-primary", name: "Omair", source: "request" },
    null,
  ]) {
    const result = await reviewSourceAuthority(db, {
      organizationId: ORG,
      fileId: DOC,
      proposedAuthorityClass: "Manufacturer Technical Document",
      reason: "Opened the stored PDF; it is a first-party Honeywell product datasheet for the detector.",
      humanActor,
      supportingProvenance: { documentNumber: "350286", revision: "Rev D" },
      newId,
      stamp,
    });
    assert.equal(
      result.status,
      SOURCE_AUTHORITY_REVIEW_STATUSES.HUMAN_ACTOR_REQUIRED,
      `source-authority elevation must refuse ${JSON.stringify(humanActor)}`,
    );
  }
  // The file's authority is untouched: this is the write that decides whether a
  // document may mint canonical truth unattended, so a refused actor must leave
  // no trace at all.
  assert.equal(
    JSON.parse(raw.prepare("SELECT summary FROM knowledge_files WHERE id=?").get(DOC).summary).sourceAuthority
      .authorityClass,
    "Unknown Source Authority",
  );
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c, 0);
});

test("KN-DECISION-1/ACTOR/A the audit row records the actor's provenance, not just its id", async () => {
  const { raw, db } = seed();
  const packetId = await packetIdOf(db);
  const result = await decide(db, { packetId });
  assert.equal(result.ok, true, result.message);
  const event = raw
    .prepare("SELECT actor_user_id, details FROM knowledge_file_events WHERE event_type='Knowledge Decision Packet'")
    .get();
  assert.equal(event.actor_user_id, HUMAN.id);
  const details = JSON.parse(event.details);
  assert.equal(details.decidedBy, HUMAN.id);
  assert.equal(details.decidedByName, HUMAN.name);
  assert.equal(
    details.humanActorSource,
    HUMAN_ACTOR_SOURCE,
    "a reader must be able to tell a config-derived actor from an asserted one",
  );
  // Batch 1's own research facts are attributed to the synthetic id, and must
  // stay that way: rewriting history would destroy the distinction between
  // "research found this" and "a human approved this".
  const researchFact = raw.prepare("SELECT review_status FROM knowledge_facts WHERE id='fact_actor_1'").get();
  assert.equal(researchFact.review_status, "Reviewed", "the research fact itself is now human-reviewed");
});

// ---------------------------------------------------------------------------
// B. The authority model: report the gap, do not invent a role
// ---------------------------------------------------------------------------
test("KN-DECISION-1/ACTOR/B there is no engineering-authority role to wire a Technical Manager action to", async () => {
  // This is the smallest honest statement of the gap. A "Technical Manager"
  // capability cannot be added without deciding what it is allowed to do that
  // Library Manager is not, and that is a governance decision for the library
  // owner -- not something to be settled by picking a string.
  // The role set is read out of the module's own source rather than imported.
  // `PERMISSION_RANK` is not exported, and that is deliberate: an exported role
  // table is an invitation to add a role, and the whole point of this finding is
  // that adding one is a governance decision. So what is asserted is what the
  // module actually gates on, read from the file itself.
  const source = await readFile(
    new URL("../worker/library-auth.mjs", import.meta.url),
    "utf8",
  );
  const declaredRoles = [...source.matchAll(/"?([A-Z][a-z]+(?: [A-Z][a-z]+)?)"?:\s*\d+/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    [...new Set(declaredRoles)].sort(),
    ["Administrator", "Library Manager", "Library Reviewer", "Library Viewer"],
    "an invented role would appear here, and the capability matrix would be fiction",
  );
  for (const role of declaredRoles) {
    assert.ok(
      !/engineer|technical|approv/i.test(role),
      `${role} must not imply engineering approval authority`,
    );
  }
  assert.ok(
    !/Technical Manager|Engineering Approver/i.test(source),
    "no engineering-authority role may be added to satisfy this workflow",
  );

  // What the packet decide route actually requires, and why. Linking a document
  // to a product asserts product IDENTITY, which is why it needs the Library
  // Manager gate (KN-LINK-GATE) rather than the reviewer gate. Confirming the
  // EVIDENCE needs only reviewer. The two are deliberately different: a reviewer
  // who can also create catalogue identity can attach evidence to the wrong
  // product.
  assert.equal(LIBRARY_CAPABILITIES.review, "Library Reviewer");
  assert.equal(LIBRARY_CAPABILITIES.analyze, "Library Reviewer");
  // KN-LINK-GATE: linking asserts canonical identity, so it is gated at Library
  // Manager -- the same rank as approve/apply/reverse, and deliberately ABOVE
  // the rank that suffices for reviewing evidence. A reviewer who can also
  // create catalogue identity can attach evidence to the wrong product.
  assert.equal(LIBRARY_CAPABILITIES.link, "Library Manager");
  assert.equal(LIBRARY_CAPABILITIES.approve, "Library Manager");
  assert.equal(LIBRARY_CAPABILITIES.apply, "Library Manager");
  assert.equal(LIBRARY_CAPABILITIES.reverse, "Library Manager");

  assert.ok(hasLibraryCapability("Library Reviewer", "review"));
  assert.ok(
    !hasLibraryCapability("Library Reviewer", "link"),
    "a reviewer must not be able to create a product link",
  );
  assert.ok(hasLibraryCapability("Library Manager", "link"));
  assert.ok(hasLibraryCapability("Library Manager", "review"));
  // Ranks are total and ordered, so a higher role always passes a gate the
  // lower one fails.
  assert.ok(hasLibraryCapability("Administrator", "link"));
  assert.ok(!hasLibraryCapability("Library Viewer", "review"));
  assert.ok(!hasLibraryCapability(undefined, "review"));
  // An unknown role is refused rather than treated as unrestricted.
  assert.equal(
    requireLibraryCapability({ permission: "Technical Manager" }, "review").code,
    "LIBRARY_PERMISSION_DENIED",
    "naming an invented role must not grant it anything",
  );
});

test("KN-DECISION-1/ACTOR/B the configured deployment role satisfies both gates the packet decide path needs", () => {
  // The deployed single-admin context yields Administrator, which passes `review`
  // and `link` by rank alone. Recorded as a fact about the deployment, not as a
  // claim that Administrator is the right long-term owner of engineering
  // approval -- that is precisely the role decision this slice does not make.
  for (const capability of ["review", "link"]) {
    assert.equal(
      requireLibraryCapability({ permission: "Administrator" }, capability),
      null,
      `the pilot's ${capability} gate must pass for the configured role`,
    );
  }
});

// ---------------------------------------------------------------------------
// C. Discovery attribution stays valid; approval attribution does not
// ---------------------------------------------------------------------------
test("KN-DECISION-1/ACTOR/C research discovery under the synthetic id is history, not a defect to repair", () => {
  // `local-development-user` is a legitimate actor for Batch 1's research
  // findings, which is why the 67 facts exist at all. Rewriting those rows to a
  // human name would be the worse outcome: it would erase the record that
  // nobody had reviewed them. The correct end state is that NEW decisions are
  // human-attributed and the old ones stay visible as they are.
  const synthetic = resolveHumanActor({ APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "Local Dev" });
  assert.equal(synthetic, null, "it is not a valid human decision-maker");

  const real = resolveHumanActor({
    APP_HUMAN_ID: "omair-primary",
    APP_HUMAN_NAME: "Omair",
    APP_HUMAN_EMAIL: "omair@example.com",
  });
  assert.ok(real, "a configured real identity resolves");
  assert.equal(real.synthetic, false);
  assert.equal(real.source, HUMAN_ACTOR_SOURCE);
  assert.equal(real.email, "omair@example.com");
});

test("KN-DECISION-1/ACTOR/C an unconfigured server refuses human-authority writes rather than falling back", () => {
  // The fallback is the whole failure mode this guards: if `requireHumanActor`
  // returned a synthetic actor when nothing is configured, every governed write
  // would quietly record "local-development-user" and the audit trail would look
  // complete while being worthless.
  for (const env of [
    {},
    { APP_HUMAN_ID: "", APP_HUMAN_NAME: "" },
    { APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "Local Dev" },
    { APP_HUMAN_ID: "omair-primary", APP_HUMAN_NAME: "" },
  ]) {
    const outcome = requireHumanActor(env);
    assert.ok(outcome.error, `env ${JSON.stringify(env)} must refuse, not fall back`);
    assert.equal(outcome.actor, undefined, "and must never return a synthetic actor");
  }
  const ok = requireHumanActor({ APP_HUMAN_ID: "omair-primary", APP_HUMAN_NAME: "Omair" });
  assert.equal(ok.error, undefined);
  assert.equal(ok.actor.id, "omair-primary");
});
