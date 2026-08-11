export const IDENTITY_RULESET_VERSION = "identity-resolution-1.0.0";
export const IDENTITY_RULESET_STATUS = "Active";

export const IDENTITY_OUTCOMES = Object.freeze([
  "Existing Product", "Variant", "Regional Variant", "Package", "Kit",
  "Replacement", "Accessory", "New Product", "Needs Review", "Different Products",
]);

export const IDENTITY_RULES = Object.freeze([
  ["IR-001", 10, "Input Integrity"],
  ["IR-002", 20, "Manufacturer Namespace"],
  ["IR-003", 30, "Protected Numeric Tokenization"],
  ["IR-010", 40, "Electrical Conflict Barrier"],
  ["IR-011", 45, "Safety Discriminator Conflict"],
  ["IR-020", 50, "Exact Order Code"],
  ["IR-030", 60, "Approved Alias"],
  ["IR-040", 70, "Terminal Punctuation Artifact"],
  ["IR-050", 80, "Package Detection"],
  ["IR-060", 90, "Kit Detection"],
  ["IR-070", 100, "Replacement Detection"],
  ["IR-080", 110, "Revision Detection"],
  ["IR-090", 120, "Regional Variant"],
  ["IR-100", 130, "Electrical Variant"],
  ["IR-110", 140, "Cabinet/Color Variant"],
  ["IR-120", 150, "Accessory Relationship"],
  ["IR-130", 160, "Distinct Exact Codes"],
  ["IR-140", 170, "New Product"],
  ["IR-150", 180, "Description Similarity Guard"],
  ["IR-160", 999, "Ambiguity Fallback"],
].map(([id, priority, name]) => Object.freeze({ id, priority, name })));

const text = (value) => String(value ?? "").normalize("NFKC").trim();
const upper = (value) => text(value).toUpperCase();
const compactText = (value) => upper(value).replace(/\s+/g, " ");
const jsonValue = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

export const stableStringify = (value) => {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
};

export const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const buildIdentityKey = (manufacturerId, orderCode) =>
  `${text(manufacturerId)}\0${upper(orderCode).replace(/\s+/g, " ")}`;

export const buildTerminalPunctuationKey = (manufacturerId, orderCode) =>
  buildIdentityKey(manufacturerId, upper(orderCode).replace(/\.(?=\s*$)/, ""));

const tokenPattern = /\d+(?:[.,]\d+)?(?:\s*(?:K|M))?(?:\s*(?:Ω|OHMS?|V(?:AC|DC)?|HZ|A|MA|W|KW|°?[FC]))?|[A-Z]+|[-./+]/giu;

export const tokenizeOrderCode = (value) => [...upper(value).matchAll(tokenPattern)].map(({ 0: raw }) => {
  const token = raw.replace(/\s+/g, "");
  const numeric = token.match(/^(\d+(?:[.,]\d+)?)(K|M)?(Ω|OHMS?|V(?:AC|DC)?|HZ|A|MA|W|KW|°?[FC])?$/i);
  if (!numeric) return { type: /^[A-Z]+$/i.test(token) ? "ALPHA" : "SEPARATOR", raw: token, normalized: token };
  const decimal = numeric[1].replace(",", ".");
  const multiplier = upper(numeric[2]) === "K" ? 1_000 : upper(numeric[2]) === "M" ? 1_000_000 : 1;
  return { type: decimal.includes(".") ? "DECIMAL" : "INTEGER", raw: token, number: Number(decimal) * multiplier, magnitude: numeric[2] ? upper(numeric[2]) : null, unit: numeric[3] ? upper(numeric[3]).replace(/^OHMS?$/, "Ω") : null, normalized: `${Number(decimal) * multiplier}${numeric[3] ? upper(numeric[3]).replace(/^OHMS?$/, "Ω") : ""}` };
});

const resistancePattern = /(?:^|[^0-9])([0-9]+(?:[.,][0-9]+)?)\s*(K|M)?\s*(?:Ω|OHMS?)?(?=$|[^A-Z0-9])/giu;
const explicitElectricalPattern = /([0-9]+(?:[.,][0-9]+)?)\s*(K|M)?\s*(Ω|OHMS?|V(?:AC|DC)?|HZ|MA|A|KW|W|°F|°C)\b/giu;

export const extractElectricalTokens = (product = {}) => {
  const corpus = `${text(product.partNumber)} ${text(product.description)}`;
  const values = [];
  for (const match of corpus.matchAll(explicitElectricalPattern)) {
    const magnitude = upper(match[2]);
    const multiplier = magnitude === "K" ? 1_000 : magnitude === "M" ? 1_000_000 : 1;
    const unit = upper(match[3]).replace(/^OHMS?$/, "Ω");
    values.push({ original: match[0], value: Number(match[1].replace(",", ".")) * multiplier, unit });
  }
  // Manufacturer resistor order codes commonly omit the ohm symbol.
  if (/\bREL-/i.test(corpus) && !values.some((entry) => entry.unit === "Ω")) {
    for (const match of corpus.matchAll(resistancePattern)) {
      if (!match[2]) continue;
      values.push({ original: match[0].trim(), value: Number(match[1].replace(",", ".")) * (upper(match[2]) === "K" ? 1_000 : 1_000_000), unit: "Ω" });
    }
  }
  return values.filter((entry, index, all) => all.findIndex((other) => other.value === entry.value && other.unit === entry.unit) === index);
};

const attributesOf = (product) => {
  const raw = jsonValue(product?.attributes, []);
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((entry) => [entry.name || entry.attributeName, entry.normalizedValue ?? entry.value]).filter(([key]) => key));
  return raw && typeof raw === "object" ? raw : {};
};

const discriminators = Object.freeze(["voltage", "frequency", "phase", "resistance", "current", "power", "capacity", "color", "cabinet", "certification", "protocol", "region", "lifecycle", "packageQuantity", "kit"]);
const discriminatorState = (product) => {
  const attributes = attributesOf(product);
  const description = compactText(product?.description);
  const colors = [...new Set([...description.matchAll(/\b(WHITE|IVORY|BLACK|RED|GRAY|GREY)\s+COLOR\b/g)].map((match) => match[1].replace("GREY", "GRAY")))];
  const quantity = description.match(/(?:QTY\.?|QUANTITY|CONTAINS?|PACKAGE CONTAINS)\s*[:.]?\s*(\d+)/)?.[1] ?? null;
  const code = upper(product?.partNumber).replace(/\.$/, "");
  const inferredCodeColor = /(?:^|-)W(?:-|$)/.test(code) ? "WHITE" : /(?:^|-)IV(?:-|$)/.test(code) ? "IVORY" : /(?:^|-)BL(?:-|$)/.test(code) ? "BLACK" : null;
  return {
    ...Object.fromEntries(discriminators.map((key) => [key, attributes[key] ?? null])),
    color: colors.length === 1 ? colors[0] : attributes.color ?? null,
    colors,
    inferredCodeColor,
    packageQuantity: quantity == null ? attributes.packageQuantity ?? null : Number(quantity),
    certification: /\b(?:UL\/ULC|UL|FM|EN[- ]?54)\b/.test(description) ? description.match(/\b(?:UL\/ULC|UL|FM|EN[- ]?54)\b/g)?.sort().join("|") : attributes.certification ?? null,
    region: /\bEUROPEAN\b/.test(description) ? "EUROPEAN" : attributes.region ?? product.region ?? null,
    lifecycle: attributes.lifecycle ?? product.lifecycleStatus ?? null,
    protocol: attributes.protocol ?? null,
    kit: /\bKIT\b/.test(description) ? true : attributes.kit ?? null,
  };
};

const conflictingKnownValues = (left, right) => {
  const differences = [];
  for (const key of discriminators) {
    const a = left[key], b = right[key];
    if (a != null && b != null && stableStringify(a) !== stableStringify(b)) differences.push({ field: key, left: a, right: b, kind: "contradictory" });
    else if ((a == null) !== (b == null) && ["voltage", "resistance", "protocol", "region", "lifecycle", "packageQuantity", "certification"].includes(key)) differences.push({ field: key, left: a, right: b, kind: "known-vs-unknown" });
  }
  return differences;
};

const sameDescription = (left, right) => compactText(left.description).replace(/\s+/g, " ") === compactText(right.description).replace(/\s+/g, " ");
const differsOnlyByTerminalPeriod = (left, right) => {
  const a = upper(left.partNumber), b = upper(right.partNumber);
  return a !== b && a.replace(/\.$/, "") === b.replace(/\.$/, "") && (a.endsWith(".") || b.endsWith("."));
};

const sourceRefs = (product) => ({ productId: product.id ?? null, sourceId: product.sourceId ?? product.source_id ?? null, sourceRow: product.sourceRow ?? product.source_row ?? null });
const trace = (rule, data = {}) => ({ sequence: 0, ruleId: rule.id, priority: rule.priority, ruleName: rule.name, matched: false, terminal: false, confidence: 0, decision: null, relationship: null, failureReason: null, humanExplanation: "Rule did not match.", machineExplanation: {}, evidence: [], ...data });

export const analyzeIdentityPair = async (leftInput, rightInput, context = {}) => {
  const left = { ...leftInput, manufacturerId: leftInput.manufacturerId ?? leftInput.manufacturer_id, partNumber: leftInput.partNumber ?? leftInput.part_number };
  const right = { ...rightInput, manufacturerId: rightInput.manufacturerId ?? rightInput.manufacturer_id, partNumber: rightInput.partNumber ?? rightInput.part_number };
  const rules = Object.fromEntries(IDENTITY_RULES.map((rule) => [rule.id, rule]));
  const traces = [];
  let terminal = null;
  let packageConflict = false;
  let safetyBlocked = false;
  let safetyReasons = [];
  const add = (ruleId, data) => { const item = trace(rules[ruleId], { sequence: traces.length + 1, ...data }); traces.push(item); if (item.terminal) terminal = item; return item; };
  const finish = async (classification, fallbackOutcome = "Needs Review") => {
    const chosen = terminal ?? { decision: fallbackOutcome, relationship: null, confidence: 0, ruleId: "IR-160", failureReason: "IDENTITY_UNRESOLVED", humanExplanation: "Identity remains unresolved." };
    const input = { rulesetVersion: IDENTITY_RULESET_VERSION, conflictId: context.conflictId ?? null, left: { ...sourceRefs(left), manufacturerId: left.manufacturerId, partNumber: left.partNumber, description: left.description, attributes: attributesOf(left) }, right: { ...sourceRefs(right), manufacturerId: right.manufacturerId, partNumber: right.partNumber, description: right.description, attributes: attributesOf(right) } };
    const inputFingerprint = await sha256(input);
    const proposalCore = { rulesetVersion: IDENTITY_RULESET_VERSION, inputFingerprint, classification, outcome: chosen.decision, relationship: chosen.relationship, confidence: chosen.confidence, terminalRule: chosen.ruleId, reasonCode: chosen.failureReason, blockers: safetyReasons, trace: traces };
    return { ...proposalCore, inputFingerprint, proposalFingerprint: await sha256(proposalCore), humanExplanation: chosen.humanExplanation, machineExplanation: chosen.machineExplanation ?? {}, requiredEvidence: chosen.requiredEvidence ?? [] };
  };

  if (context.scopeConflict) {
    add("IR-001", { matched: true, terminal: true, decision: "Needs Review", confidence: 100, failureReason: "IDENTITY_SCOPE_CONFLICT", humanExplanation: "Products in different library ownership scopes cannot be resolved as one identity without an approved promotion.", machineExplanation: context.scopeConflict });
    return finish("Scope Conflict");
  }

  const inputValid = Boolean(left.manufacturerId && right.manufacturerId && text(left.partNumber) && text(right.partNumber) && text(left.description) && text(right.description));
  add("IR-001", inputValid ? { matched: true, confidence: 100, humanExplanation: "Both product observations contain manufacturer, order code, description, and traceable record context.", machineExplanation: { left: sourceRefs(left), right: sourceRefs(right) } } : { matched: true, terminal: true, decision: "Needs Review", confidence: 100, failureReason: "IDENTITY_INPUT_INCOMPLETE", humanExplanation: "Required identity input is incomplete.", machineExplanation: { missing: [!left.manufacturerId && "left.manufacturer", !right.manufacturerId && "right.manufacturer", !text(left.partNumber) && "left.partNumber", !text(right.partNumber) && "right.partNumber", !text(left.description) && "left.description", !text(right.description) && "right.description"].filter(Boolean) } });
  if (terminal) return finish("Ambiguous");

  const sameManufacturer = left.manufacturerId === right.manufacturerId || (compactText(left.manufacturer) && compactText(left.manufacturer) === compactText(right.manufacturer));
  add("IR-002", sameManufacturer ? { matched: true, confidence: 100, humanExplanation: "Both observations are in the same verified manufacturer namespace.", machineExplanation: { leftManufacturerId: left.manufacturerId, rightManufacturerId: right.manufacturerId } } : { matched: true, terminal: true, decision: "Different Products", confidence: 100, failureReason: "MANUFACTURER_NAMESPACE_DIFFERENT_OR_UNKNOWN", humanExplanation: "Manufacturer namespaces differ; identity cannot be shared.", machineExplanation: { leftManufacturerId: left.manufacturerId, rightManufacturerId: right.manufacturerId } });
  if (terminal) return finish("Different products");

  const leftTokens = tokenizeOrderCode(left.partNumber), rightTokens = tokenizeOrderCode(right.partNumber);
  add("IR-003", { matched: true, confidence: 100, humanExplanation: "Order codes were tokenized with decimal points and electrical magnitudes protected.", machineExplanation: { leftTokens, rightTokens } });

  const leftElectrical = extractElectricalTokens(left), rightElectrical = extractElectricalTokens(right);
  const electricalConflicts = [];
  for (const a of leftElectrical) for (const b of rightElectrical) if (a.unit === b.unit && a.value !== b.value) electricalConflicts.push({ unit: a.unit, left: a.value, right: b.value, leftOriginal: a.original, rightOriginal: b.original });
  if (electricalConflicts.length) {
    add("IR-010", { matched: true, terminal: true, decision: "Different Products", relationship: "Different products", confidence: 100, failureReason: "ELECTRICAL_VALUES_DIFFER", humanExplanation: `Protected electrical values differ (${electricalConflicts.map((entry) => `${entry.left} ${entry.unit} vs ${entry.right} ${entry.unit}`).join(", ")}); the products must remain separate.`, machineExplanation: { electricalConflicts }, evidence: [sourceRefs(left), sourceRefs(right)] });
    return finish("Different products", "Different Products");
  }
  add("IR-010", { matched: false, confidence: 100, failureReason: "NO_ELECTRICAL_CONFLICT", humanExplanation: "No unequal known electrical values were detected.", machineExplanation: { leftElectrical, rightElectrical } });

  const leftState = discriminatorState(left), rightState = discriminatorState(right);
  const fieldConflicts = conflictingKnownValues(leftState, rightState);
  const internalColorConflicts = [
    ...(leftState.colors.length > 1 ? [{ side: "left", colors: leftState.colors }] : []),
    ...(rightState.colors.length > 1 ? [{ side: "right", colors: rightState.colors }] : []),
    ...(leftState.inferredCodeColor && leftState.color && leftState.inferredCodeColor !== leftState.color ? [{ side: "left", codeColor: leftState.inferredCodeColor, descriptionColor: leftState.color }] : []),
    ...(rightState.inferredCodeColor && rightState.color && rightState.inferredCodeColor !== rightState.color ? [{ side: "right", codeColor: rightState.inferredCodeColor, descriptionColor: rightState.color }] : []),
  ];
  packageConflict = fieldConflicts.some((entry) => entry.field === "packageQuantity");
  safetyReasons = [...fieldConflicts, ...internalColorConflicts];
  safetyBlocked = safetyReasons.length > 0;
  add("IR-011", safetyBlocked ? { matched: true, confidence: 100, failureReason: packageConflict ? "PACKAGE_QUANTITY_CONFLICT" : "SAFETY_DISCRIMINATOR_CONFLICT", humanExplanation: `Contradictory or known-versus-unknown safety evidence blocks automatic identity resolution: ${safetyReasons.map((entry) => entry.field || `${entry.side} color`).join(", ")}.`, machineExplanation: { conflicts: safetyReasons }, evidence: [sourceRefs(left), sourceRefs(right)] } : { matched: false, confidence: 100, failureReason: "NO_SAFETY_CONFLICT", humanExplanation: "No contradictory color, package, certification, protocol, region, or lifecycle evidence was detected.", machineExplanation: { left: leftState, right: rightState } });

  const exactCode = buildIdentityKey(left.manufacturerId, left.partNumber) === buildIdentityKey(right.manufacturerId, right.partNumber);
  if (exactCode && !safetyBlocked) add("IR-020", { matched: true, terminal: true, decision: "Existing Product", relationship: "Exact same product", confidence: 100, humanExplanation: "Exact manufacturer order codes match and no safety discriminator conflicts.", machineExplanation: { identityKey: buildIdentityKey(left.manufacturerId, left.partNumber) } });
  else add("IR-020", { matched: false, confidence: exactCode ? 0 : 100, failureReason: exactCode ? "EXACT_CODE_WITH_CONTRADICTION" : "EXACT_CODE_NOT_MATCHED", humanExplanation: exactCode ? "Exact codes are blocked by contradictory evidence." : "Exact order codes do not match.", machineExplanation: { exactCode, safetyBlocked } });
  if (terminal) return finish("Exact duplicate", "Existing Product");

  const aliases = context.approvedAliases ?? [];
  const alias = aliases.find((entry) => entry.reviewStatus === "Approved" && entry.manufacturerId === left.manufacturerId && [upper(left.partNumber), upper(right.partNumber)].includes(upper(entry.alias)));
  if (alias && !safetyBlocked) add("IR-030", { matched: true, terminal: true, decision: "Existing Product", relationship: "Same product from another source", confidence: 99, humanExplanation: "A reviewed manufacturer-scoped alias maps the order code to an existing product.", machineExplanation: { aliasId: alias.id, productId: alias.productId } });
  else add("IR-030", { matched: false, confidence: 0, failureReason: alias ? "ALIAS_CONFLICTING" : "APPROVED_ALIAS_NOT_FOUND", humanExplanation: alias ? "Alias resolution is blocked by contradictory evidence." : "No approved manufacturer-scoped alias matched.", machineExplanation: { aliasId: alias?.id ?? null } });
  if (terminal) return finish("Formatting difference", "Existing Product");

  const punctuation = differsOnlyByTerminalPeriod(left, right);
  const descriptionsEqual = sameDescription(left, right);
  if (punctuation && descriptionsEqual && !safetyBlocked) add("IR-040", { matched: true, terminal: true, decision: "Existing Product", relationship: "Same product from another source", confidence: 99, humanExplanation: "Codes differ by one terminal sentence full stop only; descriptions and all known safety discriminators agree.", machineExplanation: { terminalPunctuationKey: buildTerminalPunctuationKey(left.manufacturerId, left.partNumber), descriptionsEqual }, evidence: [sourceRefs(left), sourceRefs(right)] });
  else add("IR-040", { matched: punctuation, confidence: punctuation ? 98 : 0, failureReason: punctuation ? "PUNCTUATION_MATCH_HAS_CONTENT_CONFLICT" : "TERMINAL_PUNCTUATION_NOT_MATCHED", humanExplanation: punctuation ? "The punctuation pattern matches, but contradictory or unequal content blocks automatic Existing Product resolution." : "The order codes do not differ solely by a terminal full stop.", machineExplanation: { punctuation, descriptionsEqual, safetyBlocked, conflicts: safetyReasons } });
  if (terminal) return finish("Punctuation difference", "Existing Product");

  if (packageConflict || leftState.packageQuantity != null || rightState.packageQuantity != null) {
    const conflict = packageConflict || leftState.packageQuantity !== rightState.packageQuantity;
    add("IR-050", { matched: true, terminal: conflict, decision: conflict ? "Needs Review" : null, relationship: conflict ? null : "Commercial package", confidence: conflict ? 100 : 70, failureReason: conflict ? "PACKAGE_QUANTITY_OR_COMPONENT_UNPROVEN" : "PACKAGE_EVIDENCE_REQUIRED", humanExplanation: conflict ? "Package quantities conflict; neither identity nor package structure can be resolved automatically." : "Package language was detected, but approved manufacturer component evidence is required.", machineExplanation: { leftQuantity: leftState.packageQuantity, rightQuantity: rightState.packageQuantity } });
    if (terminal) return finish("Package quantity variant");
  } else add("IR-050", { matched: false, failureReason: "PACKAGE_NOT_DETECTED", humanExplanation: "No package structure was detected." });

  const kitDetected = leftState.kit || rightState.kit;
  add("IR-060", kitDetected ? { matched: true, terminal: true, decision: "Needs Review", confidence: 100, failureReason: "KIT_COMPOSITION_UNPROVEN", humanExplanation: "Kit language cannot establish identity or component equivalence; approved composition evidence is required.", machineExplanation: { leftKit: leftState.kit, rightKit: rightState.kit } } : { matched: false, failureReason: "KIT_NOT_DETECTED", humanExplanation: "No kit structure was detected." });
  if (terminal) return finish("Kit vs component");

  const replacementEvidence = context.replacementEvidence ?? [];
  add("IR-070", replacementEvidence.length ? { matched: true, terminal: true, decision: "Replacement", relationship: "Replacement", confidence: 98, failureReason: "REPLACEMENT_REQUIRES_REVIEW", humanExplanation: "A directed replacement relationship is present; products remain separate and require review.", machineExplanation: { evidence: replacementEvidence } } : { matched: false, failureReason: "REPLACEMENT_EVIDENCE_NOT_FOUND", humanExplanation: "No approved directed replacement evidence was supplied." });
  if (terminal) return finish("Replacement", "Replacement");

  const revisionEvidence = context.revisionEvidence ?? [];
  add("IR-080", revisionEvidence.length ? { matched: true, terminal: true, decision: "Needs Review", relationship: "Revision", confidence: 98, failureReason: "REVISION_REQUIRES_REVIEW", humanExplanation: "A revision relationship is present; revisions never merge automatically.", machineExplanation: { evidence: revisionEvidence } } : { matched: false, failureReason: "REVISION_EVIDENCE_NOT_FOUND", humanExplanation: "No approved revision evidence was supplied." });
  if (terminal) return finish("Revision");

  const relationshipRules = [
    ["IR-090", "regionalEvidence", "Regional Variant", "Regional variant", "REGION_OR_BASE_MAPPING_UNPROVEN"],
    ["IR-100", "electricalVariantEvidence", "Variant", "Electrical variant", "COMMON_BASE_UNPROVEN"],
    ["IR-110", "colorVariantEvidence", "Variant", "Cabinet/color variant", "COLOR_OR_CABINET_MAPPING_UNPROVEN"],
    ["IR-120", "accessoryEvidence", "Accessory", "Accessory", "ACCESSORY_DIRECTION_OR_SCOPE_UNPROVEN"],
  ];
  for (const [ruleId, contextKey, decision, classification, failureReason] of relationshipRules) {
    const evidence = context[contextKey] ?? [];
    add(ruleId, evidence.length && !safetyBlocked ? { matched: true, terminal: true, decision, relationship: classification, confidence: 98, humanExplanation: `Approved manufacturer evidence establishes a ${classification.toLowerCase()} relationship; products remain separate.`, machineExplanation: { evidence } } : { matched: false, failureReason: evidence.length ? failureReason : `${ruleId.replace("IR-", "")}_EVIDENCE_NOT_FOUND`, humanExplanation: evidence.length ? "Relationship evidence is blocked by contradictory values." : `No approved ${classification.toLowerCase()} evidence was supplied.` });
    if (terminal) return finish(classification, decision);
  }

  const materiallyDifferent = !punctuation && upper(left.partNumber) !== upper(right.partNumber);
  if (materiallyDifferent && !safetyBlocked) add("IR-130", { matched: true, terminal: true, decision: "Different Products", relationship: "Different products", confidence: 99, humanExplanation: "Distinct exact manufacturer order codes have no approved identity relationship and remain separate.", machineExplanation: { leftCode: left.partNumber, rightCode: right.partNumber } });
  else add("IR-130", { matched: false, failureReason: safetyBlocked ? "DISTINCTION_REQUIRES_REVIEW" : "DISTINCTION_NOT_MATERIAL_OR_RELATIONSHIP_POSSIBLE", humanExplanation: safetyBlocked ? "Contradictory evidence requires review." : "No safe distinct-product rule concluded the case." });
  if (terminal) return finish("Different products", "Different Products");

  add("IR-140", { matched: false, failureReason: "COLLISION_HAS_EXISTING_CANDIDATES", humanExplanation: "New Product cannot be selected because this is an unresolved collision between existing records." });
  const similarity = sameDescription(left, right);
  add("IR-150", { matched: similarity, confidence: similarity ? 70 : 0, failureReason: "DESCRIPTION_SIMILARITY_IS_NOT_IDENTITY_EVIDENCE", humanExplanation: similarity ? "Similar descriptions retrieve candidates but can never establish Existing Product." : "Description text does not safely resolve the collision.", machineExplanation: { descriptionsEqual: similarity } });
  add("IR-160", { matched: true, terminal: true, decision: "Needs Review", confidence: safetyBlocked ? 100 : 70, failureReason: "IDENTITY_UNRESOLVED", humanExplanation: "The case has contradictory or insufficient authoritative evidence and requires manual review.", machineExplanation: { conflicts: safetyReasons }, requiredEvidence: ["Authoritative manufacturer order-code or model applicability evidence", ...(safetyReasons.length ? ["Evidence resolving each contradictory discriminator"] : [])] });

  const classification = punctuation && descriptionsEqual && safetyBlocked && internalColorConflicts.length ? (leftState.colors.length > 1 && rightState.colors.length > 1 ? "Punctuation difference" : "Ambiguous") : "Ambiguous";
  return finish(classification);
};

export const analyzeConflict = async (conflict, products, context = {}) => {
  const leftValue = jsonValue(conflict.left_value ?? conflict.leftValue, {});
  const rightValue = jsonValue(conflict.right_value ?? conflict.rightValue, {});
  const sourceIds = jsonValue(conflict.source_ids ?? conflict.sourceIds, {});
  const find = (partNumber) => products.find((product) => upper(product.part_number ?? product.partNumber) === upper(partNumber));
  const decorate = (product, value) => ({ ...product, partNumber: product?.part_number ?? product?.partNumber ?? value.partNumber, description: product?.description ?? value.description, manufacturerId: product?.manufacturer_id ?? product?.manufacturerId, manufacturer: product?.manufacturer, sourceId: sourceIds.sourceId, sourceRow: value.row });
  const left = decorate(find(leftValue.partNumber), leftValue);
  const right = decorate(find(rightValue.partNumber), rightValue);
  return analyzeIdentityPair(left, right, { ...context, conflictId: conflict.id });
};

export const identityExecutableChecksum = async () => sha256({
  behaviorVersion: "identity-executable-1.0.0",
  rules: IDENTITY_RULES,
  normalization: [text, upper, compactText, jsonValue, stableStringify, buildIdentityKey, buildTerminalPunctuationKey].map((fn) => fn.toString()),
  tokenization: [tokenizeOrderCode, extractElectricalTokens].map((fn) => fn.toString()),
  extraction: [attributesOf, discriminatorState, conflictingKnownValues].map((fn) => fn.toString()),
  decisions: [sameDescription, differsOnlyByTerminalPeriod, analyzeIdentityPair, analyzeConflict].map((fn) => fn.toString()),
});

export const identityRulesetDocument = async () => {
  const legacyChecksum = await sha256({ version: IDENTITY_RULESET_VERSION, rules: IDENTITY_RULES });
  return {
  id: `ruleset_${legacyChecksum.slice(0, 24)}`,
  version: IDENTITY_RULESET_VERSION,
  behaviorVersion: "identity-executable-1.0.0",
  status: IDENTITY_RULESET_STATUS,
  checksum: legacyChecksum,
  executableChecksum: await identityExecutableChecksum(),
  rules: IDENTITY_RULES,
  safetyPolicy: {
    mergeProducts: false,
    descriptionCreatesIdentity: false,
    protectedDecimals: true,
    unknownEqualsKnown: false,
    relationshipsRemainSeparate: ["Package", "Kit", "Replacement", "Revision", "Accessory", "Variant", "Regional Variant"],
  },
}; };
