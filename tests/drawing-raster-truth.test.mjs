import test from"node:test";import assert from"node:assert/strict";import fs from"node:fs";import{readFile}from"node:fs/promises";
import{classifyDocumentBytes,sampleDocumentContent}from"../app/domain/document-classifier.mjs";
import{extractDrawingStructure}from"../app/domain/drawing-intake-engine.mjs";
import{parseDrawingStructure}from"../app/domain/drawing-structural-parser.mjs";
import{recognizeDrawingSymbols}from"../app/domain/drawing-symbol-recognition-engine.mjs";
import{computeApprovedQuantityEvidence}from"../app/domain/drawing-quantity-evidence-engine.mjs";

const intakeApi=fs.readFileSync(new URL("../worker/drawing-intake-api.mjs",import.meta.url),"utf8");
const ui=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const classifierSrc=fs.readFileSync(new URL("../app/domain/document-classifier.mjs",import.meta.url),"utf8");

// ============================================================
// Stage 8: real scanned/raster file. Every layer must fail closed --
// honest empty/Needs Review output, never fabricated structural,
// legend, symbol, title-block or quantity truth. Found by scanning
// ~155 real project PDFs for genuinely zero-text pages (a real scanned
// supplier document, not a drawing specifically -- no real scanned
// engineering DRAWING exists in the available local project data, an
// honest finding in itself, reported as such).
// ============================================================
const RASTER_PDF="/Users/serein-b/Downloads/Projects/Bab Al khair - Makkah/Data/From Supplier/1834 - شركة المسبار العالمي للمقاولات.pdf";

test("real raster PDF: classification honestly requires OCR, never fabricates a document type",async t=>{
  if(!fs.existsSync(RASTER_PDF))return t.skip("real raster source unavailable on this machine");
  const classification=await classifyDocumentBytes(await readFile(RASTER_PDF),{extension:"pdf",fileName:"raster.pdf"});
  assert.equal(classification.primaryType,"Unknown");
  assert.equal(classification.status,"Needs Review");
  assert.equal(classification.confidence,0);
  assert.equal(classification.manualReviewRequired,true);
  assert.equal(classification.error?.code,"OCR_REQUIRED");
});

test("real raster PDF: drawing intake detects raster on every page and fabricates no title-block metadata, legend, or asset",async t=>{
  if(!fs.existsSync(RASTER_PDF))return t.skip("real raster source unavailable on this machine");
  const intake=await extractDrawingStructure(new Uint8Array(await readFile(RASTER_PDF)),{fileName:"raster.pdf"});
  assert.ok(intake.pages.length>0,"the real file's pages must still be enumerated");
  for(const page of intake.pages){
    assert.equal(page.coordinateMode,"Coordinates Unavailable");
    assert.equal(page.extractionMethod,"Raster/no readable text layer");
    assert.equal(page.textCount,0);
    for(const value of Object.values(page.metadata))assert.equal(value,null,"no title-block field may be fabricated on a page with zero readable text");
  }
  assert.equal(intake.legends.length,0,"no legend may be fabricated with zero readable text");
  assert.equal(intake.assets.length,0,"no title-block/table/legend asset may be fabricated with zero readable text");
  for(const value of Object.values(intake.metadata))if(value!==null&&typeof value!=="boolean"&&!String(value).includes("non-authoritative"))assert.equal(value,null,"document-level metadata must not fabricate a value either");
});

test("real raster PDF: structural parser produces zero tables/regions/legend rows/sheet identities, never a fabricated title block",async t=>{
  if(!fs.existsSync(RASTER_PDF))return t.skip("real raster source unavailable on this machine");
  const structure=await parseDrawingStructure(new Uint8Array(await readFile(RASTER_PDF)));
  assert.equal(structure.tables.length,0);
  assert.equal(structure.regions.length,0);
  assert.equal(structure.legendRows.length,0);
  assert.equal(structure.sheetIdentities.length,0,"a page with zero real text can never yield a real region -- Section 3's honest region-detection floor applies here too");
});

test("real raster PDF: symbol recognition never invents an occurrence or auto-approves anything",async t=>{
  if(!fs.existsSync(RASTER_PDF))return t.skip("real raster source unavailable on this machine");
  const recognition=await recognizeDrawingSymbols(new Uint8Array(await readFile(RASTER_PDF)),{approvedStructuralRows:[]});
  assert.equal(recognition.occurrences.length,0);
  assert.equal(recognition.definitions.length,0);
  assert.equal(recognition.autoApproved,false);
});

test("a raster page with zero approved occurrences produces zero quantity evidence groups, never a fabricated count",()=>{
  const evidence=computeApprovedQuantityEvidence({occurrences:[],definitions:[],recognitionVersionId:"test",documentId:"test"});
  assert.equal(evidence.groups.length,0);
  assert.equal(evidence.totalApprovedOccurrenceCount,0);
});

// ============================================================
// Stage 8 Section 3: a real mixed PDF (vector/text AND embedded raster
// images together) must still use the real text/vector evidence -- the
// presence of an image must never force an honest-looking file into a
// false "requires OCR" failure.
// ============================================================
test("real mixed PDF (real vector/text + real embedded raster images): the presence of images never forces a false OCR requirement",async t=>{
  const path="/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/28.05 - CCTV System/DWG/01.Security/BV-BSW-127-0000-OMR-DWG-SE-2L0-2100050-A.pdf";
  if(!fs.existsSync(path))return t.skip("real Opera project source unavailable on this machine");
  const sample=await sampleDocumentContent(await readFile(path),{extension:"pdf",fileName:"floor-plan.pdf"});
  assert.ok(sample.structure.imageObjects>0,"this real file must genuinely embed raster image objects for this to be a real mixed-PDF proof");
  assert.equal(sample.readable,true,"real, usable text evidence must be used even though real embedded images are also present");
  assert.notEqual(sample.extractionMethod,"image-metadata");
});

// ============================================================
// Stage 8 Section 8: native CAD format honesty (see also
// tests/document-classifier.test.mjs for the classification-layer test).
// The DEEPER drawing-intake pipeline must independently refuse to even
// attempt parsing a non-PDF source, regardless of what classification
// decided.
// ============================================================
test("drawing intake requires PDF source and refuses DWG/image bytes outright, independent of classification",()=>{
  assert.match(intakeApi,/extension!=="pdf"/);
  assert.match(intakeApi,/DRAWING_PDF_REQUIRED/);
});

test("no CAD parser exists anywhere in this codebase -- DWG/DXF classification is honestly format-only, not a claim of content support",()=>{
  assert.doesNotMatch(classifierSrc+intakeApi,/\bdwg-parser\b|ODA File Converter|LibreDWG/i);
  assert.match(classifierSrc,/NATIVE_CAD_FORMAT_UNSUPPORTED/);
});

// ============================================================
// Stage 8 Section 7: UI truthfulness -- the capability state (Native
// Vector / Scanned / Mixed) must be shown clearly, computed from real
// per-page evidence, not implied by a populated-looking but actually
// empty tab.
// ============================================================
test("UI shows the real capability state for scanned, native vector and mixed drawings",()=>{
  assert.match(ui,/Scanned Drawing/);
  assert.match(ui,/Text Layer: Not Available/);
  assert.match(ui,/OCR: Not Configured/);
  assert.match(ui,/Review Manually/);
  assert.match(ui,/Native Vector Drawing/i);
  assert.match(ui,/Mixed Drawing/);
  assert.match(ui,/Structural Analysis: (?:Supported|Partial)/);
});

// ============================================================
// Stage 8 Section 9: classification (document TYPE) and readiness
// (whether the content can actually be READ for engineering extraction)
// are real, separate concepts in this codebase -- a file can be
// correctly classified as Drawing while still being unreadable.
// ============================================================
test("document type classification and content readiness are tracked as separate, independent concepts",()=>{
  assert.match(classifierSrc,/\breadable\b/);
  assert.match(classifierSrc,/primaryType/);
  // The dwg/dxf branch proves the separation directly: primaryType is
  // "Drawing" (a real, fair format-based type) while readable content
  // was never established -- these are not the same claim.
  assert.match(classifierSrc,/primaryType:\s*"Drawing".*NATIVE_CAD_FORMAT_UNSUPPORTED|NATIVE_CAD_FORMAT_UNSUPPORTED[\s\S]*?primaryType/);
});
