import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { classifyRequirementType, compareSpecificationRevisions, extractAttributes, extractSpecificationBytes, extractSpecificationPages, isUsablePdfTextPages } from "../app/domain/specification-extractor.mjs";

const pages = [{ page: 1, lines: ["SECTION 28 46 00 - FIRE DETECTION AND ALARM", "PART 2 - PRODUCTS", "2.1 SYSTEM REQUIREMENTS", "A. Smoke detectors shall comply with EN 54-7 and operate at 24 VDC.", "B. The system shall support a minimum of 159 detectors per loop.", "C. Approved manufacturers: Honeywell, Siemens, Bosch or approved equal.", "D. Detector shall be compatible with the selected control panel protocol and shall include detector base.", "E. Provide all required accessories as required.", "2.2 WARRANTY", "A. The contractor shall provide a 24 months warranty."] }];

test("preserves specification hierarchy and extracts source-traceable requirements", () => {
  const result = extractSpecificationPages(pages, { fileName: "28 46 00.pdf" });
  assert.ok(result.sections.some((section) => section.kind === "Section"));
  assert.ok(result.sections.some((section) => section.kind === "Part"));
  assert.ok(result.requirements.length >= 5);
  assert.ok(result.requirements.every((requirement) => requirement.source.pageFrom === 1 && Array.isArray(requirement.source.clausePath)));
});

test("distinguishes mandatory, preferred, optional, conditional and prohibited language", () => {
  assert.equal(classifyRequirementType("The detector shall comply."), "Mandatory");
  assert.equal(classifyRequirementType("The preferred enclosure should be red."), "Preferred");
  assert.equal(classifyRequirementType("A remote indicator may be provided."), "Optional");
  assert.equal(classifyRequirementType("Where required, provide an isolator."), "Conditional");
  assert.equal(classifyRequirementType("PVC conduit shall not be permitted."), "Prohibited");
});

test("extracts attributes, standards, manufacturers, compatibility and accessories without inventing values", () => {
  const result = extractSpecificationPages(pages);
  assert.ok(result.requirements.flatMap((item) => item.standards).some((standard) => standard.body === "EN54" && standard.number === "7"));
  assert.ok(result.requirements.flatMap((item) => item.attributes).some((attribute) => attribute.name === "Voltage" && attribute.parsedValue === 24));
  assert.ok(result.requirements.flatMap((item) => item.manufacturers).some((entry) => entry.manufacturer === "Honeywell"));
  assert.ok(result.requirements.flatMap((item) => item.compatibility).length > 0);
  assert.ok(result.requirements.flatMap((item) => item.accessories).some((entry) => entry.accessory === "detector base"));
});

test("flags ambiguity and missing domain-critical information", () => {
  const result = extractSpecificationPages(pages);
  assert.ok(result.ambiguities.length > 0);
  assert.ok(result.missingInformation.some((item) => item.field === "Capacity") === false);
});

test("detects conflicting structured technical values", () => {
  const result = extractSpecificationPages([{ page: 1, lines: ["SECTION 28 46 00 - FIRE ALARM", "2.1 ENCLOSURE", "A. The enclosure shall be IP54.", "B. The enclosure shall be IP66."] }]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].attribute, "IP Rating");
});

test("parses DOCX paragraph structure and rejects scanned PDF honestly", () => {
  const docx = zipSync({ "word/document.xml": strToU8('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>SECTION 28 46 00 - FIRE ALARM</w:t></w:r></w:p><w:p><w:r><w:t>2.1 PRODUCTS</w:t></w:r></w:p><w:p><w:r><w:t>Detectors shall comply with EN54-7.</w:t></w:r></w:p></w:body></w:document>') });
  assert.ok(extractSpecificationBytes(docx, { extension: "docx" }).requirements.length > 0);
  const scan = new TextEncoder().encode("%PDF-1.7\n/Type /Page /Subtype /Image");
  assert.throws(() => extractSpecificationBytes(scan, { extension: "pdf" }), (error) => error.code === "OCR_REQUIRED" && /no clauses or requirements were invented/i.test(error.technicalDetails));
});

test("rejects binary-looking PDF stream text before structured extraction", () => {
  assert.equal(isUsablePdfTextPages([{ page: 1, lines: [";j ÎáJ+¼BQö±|p.\u007fÑFÀå#¿rüä€z- c¡ìËÀôN¯aD˜àe°Ït"] }]), false);
  assert.equal(isUsablePdfTextPages([{ page: 1, lines: ["SECTION 281300 - ACCESS CONTROL SOFTWARE AND DATABASE MANAGEMENT", "Controllers shall transmit alarms and status changes to the central station."] }]), true);
});

test("compares revisions without overwriting historical requirements", () => {
  const first = extractSpecificationPages(pages).requirements;
  const revisedPages = structuredClone(pages); revisedPages[0].lines[3] = "A. Smoke detectors shall comply with EN 54-7 and operate at 12 VDC.";
  const second = extractSpecificationPages(revisedPages).requirements;
  assert.ok(compareSpecificationRevisions(first, second).changed >= 1);
});

test("wires durable asynchronous specification extraction with persisted progress", async () => {
  const fs = await import("node:fs/promises");
  const page = await fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const api = await fs.readFile(new URL("../worker/specification-extraction-api.mjs", import.meta.url), "utf8");
  const vite = await fs.readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(page, /Start specification extraction/);
  assert.match(page, /Specification extraction queued/);
  assert.match(page, /specificationExtractionRequest\.loading/);
  assert.match(page, /suggestedAction/);
  assert.match(api, /created\.idempotent/);
  assert.match(api, /createSpecificationJob/);
  assert.match(api, /dispatchSpecificationWork/);
  assert.match(api, /status.*summary/);
  assert.match(api, /SPECIFICATION_EXTRACTION_FAILED/);
  assert.match(vite, /exclude: \["pdfjs-dist"\]/);
  assert.match(vite, /@napi-rs\/canvas/);
  assert.match(vite, /SPECIFICATION_QUEUE/);
});

test("attribute operator does not leak from later compatibility language", () => {
  const sentence =
    "Provide detector operating at 24 V DC; it shall comply with UL 268 and shall be compatible with panel GF-CP-001.";

  const attributes = extractAttributes(sentence);
  const voltage = attributes.find((entry) => entry.name === "Voltage");

  assert.ok(voltage);
  assert.equal(voltage.normalizedValue, 24);
  assert.equal(voltage.normalizedUnit, "V");
  assert.equal(voltage.operator, "Equals");
});

test("compatibility target stops before the next mandatory clause", () => {
  const result = extractSpecificationPages([
    {
      page: 1,
      lines: [
        "2.1 Addressable detector",
        "Provide an addressable detector operating at 24 V DC; it shall be compatible with Golden Fire Addressable Control Panel GF-CP-001, and shall include a detector base.",
      ],
      extractionQuality: 1,
    },
  ]);

  const requirement = result.requirements.find((entry) =>
    entry.compatibility?.length
  );

  assert.ok(requirement);
  assert.equal(
    requirement.compatibility[0].targetItem,
    "Golden Fire Addressable Control Panel GF-CP-001",
  );
});
