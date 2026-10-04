import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STANDARD_BODIES, STANDARD_CITATION, EXTRACTION_BODY_ALTERNATION, GUARD_BODY_ALTERNATION, NEC_TOKEN, NATIONAL_ELECTRICAL_CODE, cleanDesignation, isNecReference,
  isStandardsBody, isInteroperabilityProfile, isProductListingBody, isCodeBody, normalizeStandardBody,
} from "../app/domain/standards-citations.mjs";
import {
  classifyStandardRelationship, classifyStandardOccurrence, isNegatedStandardRelationship, localStandardClause, validateStandardIdentity, resolveStandardIdentity, refineRouteWithStandardSemantics,
} from "../app/domain/standards-semantics.mjs";
import { extractStandards, extractStandardsDetailed, STANDARD_EXTRACTION_PATTERN_SOURCE } from "../app/domain/specification-extractor.mjs";
import { classifyCompatibilityTargets, STANDARD_CITATION as COMPAT_GUARD_CITATION } from "../app/domain/compatibility-vocabulary.mjs";

// R4 -- P3 standards semantics repair. Pure functions: no DB, no matcher.

const role = (text, { body, number, category = "Other", family = null, citation = `${body} ${number ?? ""}`.trim() }) => {
  const relationship = classifyStandardRelationship(text, citation);
  return { relationship, ...classifyStandardOccurrence({ body, number, relationship, category, family, text, citation }) };
};

// ---- 1-3. NEC lexical safety ----------------------------------------------------------------------
test("1. NEC exact tokens and the National Electrical Code phrase are valid code references", () => {
  for (const text of ["NEC", "per NEC", "wiring per NEC Article 760", "National Electrical Code", "in accordance with the National Electrical Code (NFPA 70)", "national electrical code"]) assert.equal(isNecReference(text), true, text);
  assert.equal(resolveStandardIdentity({ body: null, number: null, text: "Wiring shall comply with the National Electrical Code" }), "NEC");
  assert.equal(resolveStandardIdentity({ body: "NEC", number: null }), "NEC");
});

test("2/3. 'connected', 'connection', 'connector', 'interconnection', 'disconnected', 'necessary' never match NEC", () => {
  for (const word of ["connected", "connection", "connections", "connector", "interconnection", "disconnected", "necessary", "recommended", "Nec", "neckline", "connect via the loop"]) {
    assert.equal(isNecReference(word), false, word);
    assert.equal(NEC_TOKEN.test(word), false, word);
  }
  assert.equal(NATIONAL_ELECTRICAL_CODE.test("National Electrical Codes"), false, "no trailing-letter substring match");
  // and the P3 role no longer treats them as cable/NEC context
  const out = role("Detectors connected to the loop shall be UL 268 listed", { body: "UL", number: "268", category: "Compliance", family: "Smoke Detector" });
  assert.equal(out.semantic, "PRODUCT_STANDARD");
  assert.notEqual(out.semantic, "CABLE_WIRING_STANDARD");
  assert.equal(role("The interconnection of devices shall be UL 864 listed", { body: "UL", number: "864", category: "Compliance" }).semantic, "SYSTEM_STANDARD");
});

// ---- 4/5. mount / amount ------------------------------------------------------------------------------
test("4. 'mount', 'mounts', 'mounted', 'mounting' are installation context", () => {
  for (const text of ["Devices shall be mounted per BS 5839", "Mounting shall follow BS 5839", "Each unit mounts on a back box per BS 5839", "Mount devices per BS 5839"]) {
    assert.equal(role(text, { body: "BS", number: "5839" }).semantic, "INSTALLATION_CODE", text);
  }
  assert.equal(role("Devices shall be installed in accordance with NFPA 72", { body: "NFPA", number: "72" }).semantic, "INSTALLATION_CODE");
});

test("5. 'amount' is NOT installation context; there is no broad stemming ('installer')", () => {
  assert.notEqual(role("The amount of cable shall follow BS 5839", { body: "BS", number: "5839" }).basis, "INSTALLATION_CONTEXT");
  assert.equal(role("Panel amount of detectors shall be UL 268 listed", { body: "UL", number: "268", category: "Compliance", family: "Smoke Detector" }).semantic, "PRODUCT_STANDARD");
  assert.equal(role("The total amount is per BS 5839 tables", { body: "BS", number: "5839" }).semantic, "REFERENCE_ENTRY");
  assert.equal(role("The installer shall read BS 5839", { body: "BS", number: "5839" }).semantic, "REFERENCE_ENTRY", "'installer' is not an installation-context word");
});

// ---- 5b. identity vs role ---------------------------------------------------------------------------------------
test("identity is not role: the same designation plays a different role in a different clause", () => {
  assert.equal(role("Smoke detectors shall be UL 268 listed", { body: "UL", number: "268", category: "Compliance", family: "Smoke Detector" }).semantic, "PRODUCT_STANDARD");
  assert.equal(role("UL268, 7 Edition, 2016 - UL Standard for Safety Smoke Detectors", { body: "UL", number: "268", category: "Other" }).semantic, "REFERENCE_ENTRY");
  assert.equal(role("Fire alarm system shall comply with NFPA 72", { body: "NFPA", number: "72" }).semantic, "SYSTEM_STANDARD");
  assert.equal(role("Install devices in accordance with NFPA 72", { body: "NFPA", number: "72", category: "Installation" }).semantic, "INSTALLATION_CODE");
  assert.equal(role("Acceptance testing shall comply with NFPA 72", { body: "NFPA", number: "72", category: "Testing" }).semantic, "TESTING_STANDARD");
  assert.equal(role("NFPA 72, 2019 - National Fire Alarm and Signaling Code.", { body: "NFPA", number: "72" }).semantic, "REFERENCE_ENTRY");
});

// ---- 6-10. required role cases ----------------------------------------------------------------------------------
test("6. UL 268 with a listing verb and a family is a PRODUCT_STANDARD (listing context)", () => {
  const out = role("Smoke detectors shall be UL 268 listed", { body: "UL", number: "268", category: "Compliance", family: "Smoke Detector" });
  assert.deepEqual([out.relationship, out.semantic, out.basis], ["LISTED_TO", "PRODUCT_STANDARD", "LISTING_VERB_WITH_FAMILY"]);
  assert.equal(role("Detectors mounted on ceilings shall be UL 268 listed", { body: "UL", number: "268", category: "Compliance", family: "Smoke Detector" }).semantic, "PRODUCT_STANDARD", "a lexical install word does not steal a listing claim");
});

test("7. NFPA 72 is system/code context, and a family noun never makes it a PRODUCT_STANDARD", () => {
  assert.equal(role("Fire alarm system shall comply with NFPA 72", { body: "NFPA", number: "72" }).semantic, "SYSTEM_STANDARD");
  const withFamily = role("Detectors shall comply with NFPA 72", { body: "NFPA", number: "72", category: "Compliance", family: "Smoke Detector" });
  assert.equal(withFamily.semantic, "SYSTEM_STANDARD");
  assert.equal(withFamily.basis, "CODE_BODY_NOT_A_PRODUCT_LISTING");
  assert.equal(role("Panels shall comply with BS 5839", { body: "BS", number: "5839", category: "Compliance", family: "Fire Alarm Control Panel" }).semantic, "SYSTEM_STANDARD");
  assert.equal(role("Detectors shall comply with EN54-5", { body: "EN54", number: "5", category: "Compliance", family: "Smoke Detector" }).semantic, "PRODUCT_STANDARD", "a body that issues product standards may");
});

test("8. NFPA 70 / NEC are installation codes by identity, never product listings", () => {
  for (const [text, body, number] of [["Install devices in accordance with NFPA 70", "NFPA", "70"], ["Devices shall be mounted per NEC", "NEC", null], ["Smoke detectors shall be listed to NFPA 70", "NFPA", "70"], ["Smoke detectors shall comply with NEC", "NEC", null]]) {
    const out = role(text, { body, number, category: "Installation", family: "Smoke Detector" });
    assert.equal(out.semantic, "INSTALLATION_CODE", text);
    assert.notEqual(out.semantic, "PRODUCT_STANDARD", text);
  }
  assert.equal(role("Wiring shall comply with the National Electrical Code", { body: "NEC", number: null, citation: null }).semantic, "CABLE_WIRING_STANDARD", "cable wording in the clause");
});

test("9. testing category routes NFPA 72 to TESTING_STANDARD; product test features do not", () => {
  assert.equal(role("Testing shall comply with NFPA 72", { body: "NFPA", number: "72", category: "Testing" }).semantic, "TESTING_STANDARD");
  assert.notEqual(role("Can be tested remotely from the panel", { body: "UL", number: "268", category: "Compliance", family: "Heat Detector" }).semantic, "TESTING_STANDARD");
});

test("10. ISO 9001 is quality certification, never product interoperability or evidence", () => {
  const out = role("Manufacturer shall maintain ISO 9001 certification", { body: "ISO", number: "9001", category: "Manufacturer" });
  assert.equal(out.semantic, "QUALITY_CERTIFICATION");
  assert.equal(role("Detectors shall be ISO 9001 listed", { body: "ISO", number: "9001", category: "Compliance", family: "Smoke Detector" }).semantic, "QUALITY_CERTIFICATION");
});

// ---- 11. negation ---------------------------------------------------------------------------------------------------
test("11. negated wording never becomes a positive listing / compliance fact", () => {
  for (const text of ["Smoke detectors shall not be UL listed", "Detectors must never be UL 268 listed", "Detectors are non-compliant with UL 268", "Devices cannot be listed to UL 268"]) {
    const citation = "UL";
    assert.equal(isNegatedStandardRelationship(text, citation), true, text);
    assert.equal(classifyStandardRelationship(text, citation), "MENTIONED", `${text}: never LISTED_TO / COMPLIES_WITH`);
    const out = classifyStandardOccurrence({ body: "UL", number: "268", relationship: "LISTED_TO", category: "Compliance", family: "Smoke Detector", text, citation });
    assert.deepEqual([out.semantic, out.basis], ["UNRESOLVED", "NEGATED_RELATIONSHIP"], `${text}: even a caller-supplied positive relationship is overridden`);
  }
  assert.equal(classifyStandardRelationship("Smoke detectors shall be UL 268 listed and shall not exceed 5 kg", "UL 268"), "LISTED_TO", "a negation in a DIFFERENT clause does not poison the listing");
  assert.equal(isNegatedStandardRelationship("Detectors shall be UL 268 listed", "UL 268"), false);
  // a distant, unrelated "non" is not a negation of the standards cue (real requirement_497 text)
  const req497 = "Overload protected fuses with indictor and provided with automatic insulation test per circuit to connected up to 20 addresses, addressing and programming of maintained/ switch maintained and non – maintained operations as per manufacturer recommendation in line with IEC60364 Part 5.56 Wiring standards.";
  assert.equal(isNegatedStandardRelationship(req497, "IEC60364"), false);
  assert.equal(classifyStandardRelationship(req497, "IEC60364"), "IN_ACCORDANCE_WITH");
});

// ---- 12/13. parser artifacts (NEW extraction) ---------------------------------------------------------------------------
test("12. 'UL listed' never creates an identity called 'listed'", () => {
  const out = extractStandards("Devices shall be UL listed.");
  assert.deepEqual(out.map((entry) => [entry.body, entry.number]), [["UL", null]]);
  assert.equal(validateStandardIdentity({ body: "UL", number: "listed" }).valid, false);
  assert.deepEqual(validateStandardIdentity({ body: "UL", number: "listed" }).reasons, ["NUMBER_IS_A_WORD"]);
  assert.equal(validateStandardIdentity({ body: "UL", number: null }).bodyOnly, true);
});

test("13. an EN54 punctuation fragment is rejected as an identity", () => {
  assert.deepEqual(extractStandards("Refer to EN54.").map((entry) => [entry.body, entry.number]), [["EN54", null]]);
  assert.deepEqual(extractStandards("EN 54-2.").map((entry) => [entry.body, entry.number, entry.originalText]), [["EN54", "2", "EN 54-2"]], "trailing period is not part of the number");
  assert.deepEqual(validateStandardIdentity({ body: "EN54", number: "." }).reasons, ["NUMBER_PUNCTUATION_ONLY"]);
  assert.deepEqual(cleanDesignation("."), { designation: null, artifacts: ["TRAILING_PUNCTUATION"] });
});

test("legacy artifact shapes are all detected: BS 'EN', UL 'listed', EN54 '.', UL '7-', '268A-listed', trailing period", () => {
  const reasons = (body, number) => validateStandardIdentity({ body, number }).reasons;
  assert.deepEqual(reasons("BS", "EN"), ["NUMBER_IS_A_WORD"]);
  assert.deepEqual(reasons("UL", "listed"), ["NUMBER_IS_A_WORD"]);
  assert.deepEqual(reasons("EN54", "."), ["NUMBER_PUNCTUATION_ONLY"]);
  assert.deepEqual(reasons("UL", "7-"), ["NUMBER_TRUNCATED"]);
  assert.deepEqual(reasons("UL", "268A-listed"), ["NUMBER_SUFFIX_WORD_LEAK"]);
  assert.deepEqual(reasons("NFPA", "72-2016."), ["NUMBER_TRAILING_PUNCTUATION"]);
  assert.deepEqual(reasons("UL", "268"), []);
  assert.deepEqual(reasons("EN54", "12-TC"), [], "a short alphabetic segment (12-TC) is a real designation");
  const malformed = classifyStandardOccurrence({ body: "UL", number: "268A-listed", relationship: "LISTED_TO", category: "Compliance", family: "Smoke Detector", text: "UL 268A-listed housing" });
  assert.deepEqual([malformed.semantic, malformed.basis], ["UNRESOLVED", "MALFORMED_STANDARD_IDENTITY"], "a malformed identity gets no role");
});

test("NEW extraction never creates the audited artifacts", () => {
  const shape = (text) => extractStandards(text).map((entry) => `${entry.body}|${entry.number}|${entry.originalText}`);
  assert.deepEqual(shape("Detectors shall be UL 268A-listed."), ["UL|268A|UL 268A"], "suffix leak cut");
  assert.deepEqual(shape("NFPA 72-2016."), ["NFPA|72-2016|NFPA 72-2016"], "sentence punctuation stripped");
  assert.deepEqual(shape("UL 268, UL 217 and UL 864."), ["UL|268|UL 268", "UL|217|UL 217", "UL|864|UL 864"]);
  const truncated = extractStandardsDetailed("Cables per BS 6387 and BS7-");
  assert.deepEqual(truncated.standards.map((entry) => `${entry.body} ${entry.number}`), ["BS 6387"]);
  assert.deepEqual(truncated.rejected, [{ originalText: "BS7-", reason: "TRUNCATED_DESIGNATION" }], "the truncated fragment is reported, not persisted");
  assert.deepEqual(extractStandards("UL 7-"), []);
  assert.deepEqual(extractStandards("Panels to BS EN 54-2 and EN 54-4.").map((entry) => `${entry.body}|${entry.number}`), ["BS|EN54-2", "EN54|4"], "no bare BS fragment beside EN54");
  assert.deepEqual(extractStandards("BS EN 54-2").map((entry) => [entry.body, entry.number]), extractStandards("BS EN54-2").map((entry) => [entry.body, entry.number]), "spaced and compact BS EN 54 give the same identity");
});

// ---- 14. one canonical citation definition ---------------------------------------------------------------------------------
test("14. the extractor, the R3 guard and P3 share ONE table and cannot drift", () => {
  const historicalExtractor = String.raw`\b(NFPA|UL|ULC|FM|EN\s*54|EN54|IEC|BS|ISO|TIA|BICSI|ONVIF|IEEE|NEC)(?![A-Za-z])\s*[-:]?\s*((?=[A-Z0-9.-]*\d)[A-Z0-9.-]+)?(?:\s*[:/-]\s*(?!(?:NFPA|UL|ULC|FM|EN\s*54|EN54|IEC|BS|ISO|TIA|BICSI|ONVIF|IEEE|NEC)\b)([A-Z0-9.-]+))?(?:\s*\(?((?:19|20)\d{2})\)?)?`;
  assert.equal(STANDARD_EXTRACTION_PATTERN_SOURCE, historicalExtractor, "extraction behavior is byte-for-byte unchanged");
  assert.equal(EXTRACTION_BODY_ALTERNATION, "NFPA|UL|ULC|FM|EN\\s*54|EN54|IEC|BS|ISO|TIA|BICSI|ONVIF|IEEE|NEC");
  const r3Guard = String.raw`(?<![A-Za-z])(?:NFPA|ULC|UL|FM|IEC|BS|EN|ISO|IEEE|TIA|EIA|ANSI|BICSI|NEC|ITU|CENELEC)(?![A-Za-z])\s*[-/:]?\s*(?:[Ss]tandards?\s+|[Ss]td\.?\s+)?[A-Z]?\d[\w.\-:/]*`;
  assert.equal(STANDARD_CITATION.source, r3Guard, "the R3 guard is unchanged");
  assert.equal(COMPAT_GUARD_CITATION, STANDARD_CITATION, "the compat vocabulary re-exports the SAME object, not a copy");
  assert.equal(GUARD_BODY_ALTERNATION, "NFPA|ULC|UL|FM|IEC|BS|EN|ISO|IEEE|TIA|EIA|ANSI|BICSI|NEC|ITU|CENELEC");
});

test("14. every body the extractor persists is a guarded standards body (except the ONVIF profile), and P3 agrees", () => {
  const extracted = STANDARD_BODIES.filter((entry) => entry.extracted).map((entry) => entry.body);
  assert.deepEqual(extracted, ["NFPA", "UL", "ULC", "FM", "EN54", "IEC", "BS", "ISO", "TIA", "BICSI", "ONVIF", "IEEE", "NEC"]);
  for (const body of extracted) {
    if (body === "ONVIF") { assert.equal(isStandardsBody(body), false); continue; }
    assert.equal(isStandardsBody(body), true, body);
    const guarded = STANDARD_BODIES.find((entry) => entry.body === body).guard || (body === "EN54" && STANDARD_BODIES.find((entry) => entry.body === "EN").guard);
    assert.ok(guarded, `${body} is extracted but not guarded`);
  }
  for (const entry of STANDARD_BODIES.filter((candidate) => candidate.guard)) assert.equal(isStandardsBody(entry.body), true, entry.body);
  // behavioral agreement on real citations: extractor persists it AND the compat guard refuses it AND P3 accepts the identity
  for (const citation of ["UL 268", "ULC S526", "FM 3010", "NFPA 72", "NEC 760", "BS 5839", "ISO 9001", "TIA-568", "IEC 60529", "IEEE 802", "BICSI 002", "EN54-2"]) {
    const hits = classifyCompatibilityTargets(citation);
    assert.ok(hits.length > 0 && hits.every((hit) => hit.type === "GUARD_STANDARD"), `${citation}: compat guard`);
    const parsed = extractStandards(citation);
    assert.ok(parsed.length > 0, `${citation}: extractor`);
    assert.equal(validateStandardIdentity({ body: parsed[0].body, number: parsed[0].number }).valid, true, `${citation}: P3 identity`);
  }
  for (const citation of ["ANSI 60", "EIA 310", "ITU 992", "CENELEC 50", "EN 50173-1"]) assert.equal(classifyCompatibilityTargets(citation).every((hit) => hit.type === "GUARD_STANDARD") && classifyCompatibilityTargets(citation).length > 0, true, `${citation}: guard-only bodies stay guarded`);
});

test("body flags are consistent: product-listing bodies vs code bodies", () => {
  for (const body of ["UL", "ULC", "FM", "EN54"]) assert.equal(isProductListingBody(body), true, body);
  for (const body of ["NFPA", "NEC", "BS", "ISO", "IEEE", "TIA", "IEC", "ONVIF"]) assert.equal(isProductListingBody(body), false, body);
  for (const body of ["NFPA", "NEC", "BS"]) assert.equal(isCodeBody(body), true, body);
  assert.equal(normalizeStandardBody("EN 54"), "EN54");
  assert.equal(normalizeStandardBody("ulc"), "ULC");
});

// ---- 15. ONVIF --------------------------------------------------------------------------------------------------------------------
test("15. ONVIF is an interoperability profile: outside standards/listing semantics and never guarded as a citation", () => {
  assert.equal(isInteroperabilityProfile("ONVIF"), true);
  assert.equal(isStandardsBody("ONVIF"), false);
  assert.deepEqual(classifyCompatibilityTargets("ONVIF Profile S"), [], "not a GUARD_STANDARD compat citation (R3 behavior preserved)");
  assert.deepEqual(validateStandardIdentity({ body: "ONVIF" }).reasons, ["NOT_A_STANDARD_INTEROPERABILITY_PROFILE"]);
  const out = role("Cameras shall support ONVIF Profile S", { body: "ONVIF", number: null, category: "Compliance", family: "Camera" });
  assert.deepEqual([out.semantic, out.basis], ["UNRESOLVED", "INTEROPERABILITY_PROFILE_NOT_A_STANDARD"]);
  for (const relationship of ["LISTED_TO", "CERTIFIED_TO", "COMPLIES_WITH"]) {
    assert.equal(classifyStandardOccurrence({ body: "ONVIF", relationship, category: "Compliance", family: "Camera", text: "ONVIF conformant" }).semantic, "UNRESOLVED", relationship);
  }
  // extraction keeps its historical ONVIF row (CCTV lane behavior is not changed by R4)
  assert.deepEqual(extractStandards("ONVIF Profile S cameras").map((entry) => entry.body), ["ONVIF"]);
});

// ---- clause locality -----------------------------------------------------------------------------------------------------------------
test("each citation gets its own clause: one sentence, two standards, two roles", () => {
  const text = "Devices shall be UL listed to UL 268 and mounted per NFPA 72";
  assert.equal(localStandardClause(text, "UL 268"), "Devices shall be UL listed to UL 268");
  assert.equal(localStandardClause(text, "NFPA 72"), "mounted per NFPA 72");
  assert.equal(role(text, { body: "UL", number: "268", category: "Compliance", family: "Smoke Detector" }).semantic, "PRODUCT_STANDARD");
  assert.equal(role(text, { body: "NFPA", number: "72", category: "Compliance", family: "Smoke Detector" }).semantic, "INSTALLATION_CODE");
  assert.equal(localStandardClause("Install per NFPA 70, NFPA 72 and BS 5839", "NFPA 72"), "Install per NFPA 70, NFPA 72 and BS 5839", "a plain list shares its cue");
  assert.equal(localStandardClause("no citation given", null), "no citation given");
});

test("P3 relationship wording (existing behavior) is preserved, and P1 refinement is unchanged", () => {
  assert.equal(classifyStandardRelationship("must be UL certified to UL 268"), "CERTIFIED_TO");
  assert.equal(classifyStandardRelationship("The UL 268A-listed housing fits footprints"), "LISTED_TO");
  assert.equal(classifyStandardRelationship("devices compliant with UL864"), "COMPLIES_WITH");
  assert.equal(classifyStandardRelationship("Approved to UL 864"), "APPROVED");
  assert.equal(classifyStandardRelationship("The listed products"), "LISTED_TO");
  assert.equal(classifyStandardRelationship("unlisted products"), "MENTIONED", "'unlisted' is not 'listed'");
  const unknown = { scope: "UNKNOWN", role: "UNKNOWN", basis: [], unknown: true };
  assert.equal(refineRouteWithStandardSemantics(unknown, [{ semantic: "INSTALLATION_CODE" }]).role, "INSTALLATION_COMPLIANCE");
  assert.equal(refineRouteWithStandardSemantics(unknown, [{ semantic: "UNRESOLVED" }]).unknown, true);
});

test("classification is deterministic and side-effect free", () => {
  const input = { body: "UL", number: "268", relationship: "LISTED_TO", category: "Compliance", family: "Smoke Detector", text: "Smoke detectors shall be UL 268 listed", citation: "UL 268" };
  assert.deepEqual(classifyStandardOccurrence(input), classifyStandardOccurrence(input));
  assert.deepEqual(extractStandards("UL 268A-listed"), extractStandards("UL 268A-listed"));
});

test("the live extractor and P3 no longer contain the audited substring regexes", () => {
  const p3 = readFileSync(new URL("../app/domain/standards-semantics.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(p3, /\|NEC\|/, "no bare /NEC/ alternation");
  assert.doesNotMatch(p3, /\|mount\|/, "no un-anchored mount");
  assert.match(p3, /\\bmount\(\?:s\|ed\|ing\)\?\\b/, "explicit word-bounded mount forms");
});
