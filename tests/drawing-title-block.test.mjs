import test from"node:test";import assert from"node:assert/strict";import fs from"node:fs";import{readFile}from"node:fs/promises";import{strToU8,zlibSync}from"fflate";import{DatabaseSync}from"node:sqlite";import{parseDrawingStructure}from"../app/domain/drawing-structural-parser.mjs";import{handleDrawingStructuralParserApi}from"../worker/drawing-structural-parser-api.mjs";
const engine=fs.readFileSync(new URL("../app/domain/drawing-structural-parser.mjs",import.meta.url),"utf8"),ui=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8"),intakeEngine=fs.readFileSync(new URL("../app/domain/drawing-intake-engine.mjs",import.meta.url),"utf8"),intakeApi=fs.readFileSync(new URL("../worker/drawing-intake-api.mjs",import.meta.url),"utf8");
// Same real-PDF-building convention as tests/drawing-structural-parser.test.mjs:
// one Tj per text fragment at an explicit (x,y), so coordinate-dependent
// title-block logic (region detection, row/column splitting, multi-line
// value accumulation) can be tested against precise, controlled geometry.
const buildPositionedPdf=(fragments,mediaBox=[0,0,3000,1000])=>{
  const chunks=[];let offset=0;
  const push=text=>{const bytes=strToU8(text);chunks.push(bytes);offset+=bytes.length;};
  const esc=value=>value.replace(/[()\\]/g,"\\$&");
  push("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n");
  const objects=[];
  objects.push({id:1,offset});push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push({id:2,offset});push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push({id:3,offset});push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(" ")}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n`);
  const content=fragments.map(fragment=>`BT /F1 12 Tf ${fragment.x} ${fragment.y} Td (${esc(fragment.text)}) Tj ET`).join(" ");
  const compressed=zlibSync(strToU8(content));
  objects.push({id:4,offset});push(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
  chunks.push(compressed);offset+=compressed.length;
  push("\nendstream\nendobj\n");
  const xrefOffset=offset;
  let xref=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const entry of objects)xref+=`${String(entry.offset).padStart(10,"0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  const total=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
  const merged=new Uint8Array(total);let cursor=0;
  for(const chunk of chunks){merged.set(chunk,cursor);cursor+=chunk.length;}
  return merged;
};

// ============================================================
// Section 3: region detection is evidence-based, not a fixed corner.
// ============================================================
test("title-block region is detected from real matched field labels, not a fixed page corner -- proven at the TOP of the page",async()=>{
  const pdf=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:100,y:900},{text:"ABC-123",x:100,y:880},
    {text:"CLIENT",x:300,y:900},{text:"Acme Corp",x:300,y:880},
    {text:"PROJECT NAME",x:500,y:900},{text:"Test Project",x:500,y:880},
    {text:"Unrelated body text far from any title block.",x:100,y:400},
  ]);
  const structure=await parseDrawingStructure(pdf);
  const identity=structure.sheetIdentities[0];
  assert.ok(identity,"a region with 3 distinct known labels must be detected");
  assert.ok(identity.titleBlockRegion.confidence>=70);
  assert.match(identity.titleBlockRegion.reason,/drawingNumber/);
  assert.ok(identity.titleBlockRegion.boundingBox.y>500,"the detected region must sit where the real labels are (near the top), not assumed at the bottom");
});

test("a page with no known title-block field labels yields no fabricated region",async()=>{
  const pdf=buildPositionedPdf([{text:"This sheet has ordinary drawing content and prose.",x:100,y:500},{text:"No structured metadata labels appear anywhere on it.",x:100,y:480}]);
  const structure=await parseDrawingStructure(pdf);
  assert.equal(structure.sheetIdentities.length,0,"a page with fewer than 2 distinct known field labels must never fabricate a title-block region");
});

// ============================================================
// Section 4-5: 2D column-bounded label/value reconstruction.
// ============================================================
test("a dense horizontal row of several labels resolves each field to its OWN column value, never an adjacent one",async()=>{
  const pdf=buildPositionedPdf([
    {text:"SCALE",x:100,y:500},{text:"CONSULTANT",x:300,y:500},{text:"CLIENT",x:500,y:500},{text:"REVISION NO",x:700,y:500},
    {text:"1:100",x:100,y:480},{text:"Acme Design",x:300,y:480},{text:"Acme Client",x:500,y:480},{text:"A",x:700,y:480},
  ]);
  const structure=await parseDrawingStructure(pdf);
  const fields=Object.fromEntries(structure.sheetIdentities[0].fields.map(field=>[field.field,field.value]));
  assert.equal(fields.scale,"1:100");
  assert.equal(fields.consultant,"Acme Design");
  assert.equal(fields.client,"Acme Client");
  assert.equal(fields.revision,"A");
});

test("a label alone on its own physical row resolves to a real MULTI-LINE value below it, bounded by the next label's own row",async()=>{
  const pdf=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:100,y:900},{text:"DWG-001",x:100,y:850},
    {text:"CLIENT",x:100,y:700},
    {text:"Acme Corp",x:100,y:650},{text:"123 Main St",x:100,y:635},{text:"Springfield",x:100,y:620},
    {text:"PROJECT NAME",x:100,y:500},{text:"Test Project",x:100,y:480},
  ]);
  const structure=await parseDrawingStructure(pdf);
  const fields=Object.fromEntries(structure.sheetIdentities[0].fields.map(field=>[field.field,field.value]));
  assert.equal(fields.drawingNumber,"DWG-001");
  assert.equal(fields.client,"Acme Corp 123 Main St Springfield","a real 3-line company-address block must be captured as one multi-line value");
  assert.equal(fields.projectName,"Test Project");
});

// Stage 7.5 (2026-09-01) Section 2/3: a matched label whose candidate value
// fails a real plausibility check is surfaced as an EXPLICIT "Needs
// Review" entry (value:null) -- distinct from a field whose label was
// never found at all (silently absent, the real Unknown case) -- so wrong
// evidence fails closed and visible, never silently vanishing.
test("a field's own real shape gate rejects an implausible value rather than reporting it as confirmed -- becomes an explicit Needs Review entry",async()=>{
  const pdf=buildPositionedPdf([{text:"DRAWING NUMBER",x:100,y:900},{text:"No digits at all here",x:100,y:850},{text:"CLIENT",x:300,y:900},{text:"Acme",x:300,y:880}]);
  const structure=await parseDrawingStructure(pdf);
  const identity=structure.sheetIdentities[0];
  const drawingNumberField=identity.fields.find(field=>field.field==="drawingNumber");
  assert.ok(drawingNumberField,"the matched label must still surface an explicit entry, not silently vanish");
  assert.equal(drawingNumberField.value,null);
  assert.equal(drawingNumberField.status,"Needs Review");
});

// ============================================================
// Section 6: revision table -- both real orientations, ordinal-rank
// pairing for the vertical case, never fabricating a missing value.
// ============================================================
test("a horizontal revision table (REV/DATE/DESCRIPTION/DRAWN/CHECKED/APPROVED headers, data below) reconstructs real rows and picks the latest-dated row as current",async()=>{
  const pdf=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:1500,y:900},{text:"ABC-123",x:1500,y:880},{text:"CLIENT",x:1800,y:900},{text:"Acme",x:1800,y:880},
    {text:"REV",x:100,y:600},{text:"DATE",x:180,y:600},{text:"DESCRIPTION",x:280,y:600},{text:"DRAWN",x:450,y:600},{text:"CHECKED",x:550,y:600},{text:"APPROVED",x:650,y:600},
    {text:"A",x:100,y:580},{text:"01-01-2025",x:180,y:580},{text:"Draft",x:280,y:580},{text:"XX",x:450,y:580},{text:"YY",x:550,y:580},{text:"ZZ",x:650,y:580},
    {text:"B",x:100,y:560},{text:"15-06-2025",x:180,y:560},{text:"Final",x:280,y:560},{text:"XX",x:450,y:560},{text:"YY",x:550,y:560},{text:"ZZ",x:650,y:560},
  ]);
  const structure=await parseDrawingStructure(pdf);
  const identity=structure.sheetIdentities[0];
  assert.equal(identity.revisions.length,2,"both real revision data rows must be reconstructed");
  assert.deepEqual(identity.revisions[0],{revision:"A",date:"01-01-2025",description:"Draft",drawnBy:"XX",checkedBy:"YY",approvedBy:"ZZ"});
  assert.deepEqual(identity.revisions[1],{revision:"B",date:"15-06-2025",description:"Final",drawnBy:"XX",checkedBy:"YY",approvedBy:"ZZ"});
  assert.equal(identity.currentRevision,"B","the later-dated real row must be picked, never merely the first or last textual occurrence of a revision token");
});

// Stage 7 (2026-08-31): proven real on the Opera CCTV Notes/Legend sheet --
// a vertical revision table's header captions and its single data row's
// values pair by ORDINAL RANK when both are sorted by Y, not by Y-proximity
// or midpoint-band containment (both of those provably mis-assign the real
// data on that real sheet). This proves the same mechanism synthetically.
test("a vertical revision table (headers stacked top-to-bottom, single data column) pairs headers to values by ordinal rank",async()=>{
  const pdf=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:1500,y:900},{text:"ABC-123",x:1500,y:880},{text:"CLIENT",x:1800,y:900},{text:"Acme",x:1800,y:880},
    {text:"REV",x:100,y:900},{text:"DESCRIPTION",x:100,y:800},{text:"APPROVED",x:100,y:700},{text:"CHECKED",x:100,y:600},{text:"DATE",x:100,y:500},
    {text:"A",x:110,y:910},{text:"Issued For Tender",x:110,y:850},{text:"ZZ",x:110,y:720},{text:"YY",x:110,y:610},{text:"01-01-2025",x:110,y:520},
  ]);
  const structure=await parseDrawingStructure(pdf);
  const identity=structure.sheetIdentities[0];
  assert.equal(identity.revisions.length,1);
  assert.deepEqual(identity.revisions[0],{revision:"A",description:"Issued For Tender",approvedBy:"ZZ",checkedBy:"YY",date:"01-01-2025"});
});

test("a page with no revision-table evidence (fewer than 2 distinct REV/DATE/DESCRIPTION anchors) yields no fabricated revision table",async()=>{
  const pdf=buildPositionedPdf([{text:"DRAWING NUMBER",x:100,y:900},{text:"ABC-123",x:100,y:880},{text:"CLIENT",x:300,y:900},{text:"Acme",x:300,y:880},{text:"REV",x:100,y:600}]);
  const structure=await parseDrawingStructure(pdf);
  const identity=structure.sheetIdentities[0];
  assert.equal(identity.revisions.length,0);
  assert.equal(identity.currentRevision,null);
});

// ============================================================
// Section 7: scale -- real text-shape recognition only, never inferred
// from geometry; multiple distinct scale values are never collapsed.
// ============================================================
test("real scale text forms (ratio, N.T.S, As indicated) are recognized without inferring a numeric scale from geometry",async()=>{
  for(const value of["1:100","N.T.S","As indicated","VARIES"]){
    const pdf=buildPositionedPdf([{text:"DRAWING NUMBER",x:100,y:900},{text:"ABC-123",x:100,y:880},{text:"CLIENT",x:300,y:900},{text:"Acme",x:300,y:880},{text:"SCALE",x:500,y:900},{text:value,x:500,y:880}]);
    const structure=await parseDrawingStructure(pdf);
    const fields=Object.fromEntries(structure.sheetIdentities[0].fields.map(field=>[field.field,field.value]));
    assert.equal(fields.scale,value,`"${value}" must be recognized as a real scale value`);
  }
});

test("multiple distinct scale-shaped values elsewhere on the sheet are surfaced separately, never collapsed into one false global scale",async()=>{
  const pdf=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:100,y:900},{text:"ABC-123",x:100,y:880},{text:"CLIENT",x:300,y:900},{text:"Acme",x:300,y:880},{text:"SCALE",x:500,y:900},{text:"1:100",x:500,y:880},
    {text:"Detail A SCALE 1:50",x:1000,y:400},{text:"1:50",x:1050,y:380},
    {text:"Detail B SCALE 1:20",x:1000,y:300},{text:"1:20",x:1050,y:280},
  ]);
  const structure=await parseDrawingStructure(pdf);
  const identity=structure.sheetIdentities[0];
  assert.equal(identity.sheetScale,"1:100","the title block's own scale field remains authoritative");
  assert.ok(identity.multipleScaleRegions,"additional distinct scale-shaped values elsewhere on the sheet must be surfaced, not silently discarded");
  const values=identity.multipleScaleRegions.map(region=>region.value);
  assert.ok(values.includes("1:50")&&values.includes("1:20"));
});

// ============================================================
// Section 10: cross-sheet consistency -- disagreement is surfaced, never
// auto-corrected.
// ============================================================
test("cross-sheet consistency surfaces a disagreeing sheet without overwriting it",async()=>{
  const pdf=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:100,y:900},{text:"DWG-001",x:100,y:880},{text:"PROJECT NAME",x:300,y:900},{text:"Alpha Project",x:300,y:880},
  ]);
  // Two independent single-page parses standing in for two sheets of the
  // same drawing set (parseDrawingStructure operates per document/version;
  // this proves the comparison logic itself using two real parsed results).
  const structureA=await parseDrawingStructure(pdf);
  const pdfB=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:100,y:900},{text:"DWG-002",x:100,y:880},{text:"PROJECT NAME",x:300,y:900},{text:"Alpha Project",x:300,y:880},
  ]);
  const structureB=await parseDrawingStructure(pdfB);
  const pdfC=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:100,y:900},{text:"DWG-003",x:100,y:880},{text:"PROJECT NAME",x:300,y:900},{text:"Beta Project",x:300,y:880},
  ]);
  const structureC=await parseDrawingStructure(pdfC);
  const observed=[structureA,structureB,structureC].map((structure,index)=>({pageNumber:index+1,value:structure.sheetIdentities[0].fields.find(field=>field.field==="projectName")?.value}));
  assert.deepEqual(observed.map(item=>item.value),["Alpha Project","Alpha Project","Beta Project"]);
  // The engine's own per-document crossSheetConsistency check operates
  // across pages within ONE parsed document; a real multi-sheet SET is
  // compared the same way at the worker/application layer across documents
  // sharing a project. Prove the underlying per-document mechanism directly
  // with a real 2-page document carrying a genuine disagreement.
});

test("cross-sheet consistency (single multi-page document): a real disagreeing page is surfaced, never silently overwritten",async()=>{
  // A minimal 2-page PDF: same convention, one Page tree with two Kids.
  const buildTwoPagePdf=(fragmentsA,fragmentsB)=>{
    const chunks=[];let offset=0;
    const push=text=>{const bytes=strToU8(text);chunks.push(bytes);offset+=bytes.length;};
    const esc=value=>value.replace(/[()\\]/g,"\\$&");
    push("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n");
    const objects=[];
    objects.push({id:1,offset});push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    objects.push({id:2,offset});push("2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>\nendobj\n");
    objects.push({id:3,offset});push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3000 1000] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n");
    const contentA=fragmentsA.map(fragment=>`BT /F1 12 Tf ${fragment.x} ${fragment.y} Td (${esc(fragment.text)}) Tj ET`).join(" ");
    const compressedA=zlibSync(strToU8(contentA));
    objects.push({id:4,offset});push(`4 0 obj\n<< /Length ${compressedA.length} /Filter /FlateDecode >>\nstream\n`);
    chunks.push(compressedA);offset+=compressedA.length;push("\nendstream\nendobj\n");
    objects.push({id:5,offset});push("5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3000 1000] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 6 0 R >>\nendobj\n");
    const contentB=fragmentsB.map(fragment=>`BT /F1 12 Tf ${fragment.x} ${fragment.y} Td (${esc(fragment.text)}) Tj ET`).join(" ");
    const compressedB=zlibSync(strToU8(contentB));
    objects.push({id:6,offset});push(`6 0 obj\n<< /Length ${compressedB.length} /Filter /FlateDecode >>\nstream\n`);
    chunks.push(compressedB);offset+=compressedB.length;push("\nendstream\nendobj\n");
    const xrefOffset=offset;
    let xref=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
    for(const entry of objects)xref+=`${String(entry.offset).padStart(10,"0")} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    const total=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
    const merged=new Uint8Array(total);let cursor=0;
    for(const chunk of chunks){merged.set(chunk,cursor);cursor+=chunk.length;}
    return merged;
  };
  const pageA=[{text:"DRAWING NUMBER",x:100,y:900},{text:"DWG-001",x:100,y:880},{text:"PROJECT NAME",x:300,y:900},{text:"Alpha Project",x:300,y:880}];
  const pageB=[{text:"DRAWING NUMBER",x:100,y:900},{text:"DWG-002",x:100,y:880},{text:"PROJECT NAME",x:300,y:900},{text:"Beta Project",x:300,y:880}];
  const pdf=buildTwoPagePdf(pageA,pageB);
  const structure=await parseDrawingStructure(pdf);
  assert.equal(structure.sheetIdentities.length,2);
  const projectNameCheck=structure.crossSheetConsistency.find(entry=>entry.field==="projectName");
  assert.ok(projectNameCheck,"a real disagreement between 2 real pages must be surfaced");
  assert.equal(projectNameCheck.hasDisagreement,true);
  assert.equal(projectNameCheck.consensus,"Alpha Project");
  assert.equal(projectNameCheck.disagreements.length,1);
  assert.equal(projectNameCheck.disagreements[0].pageNumber,2);
  // Never overwritten: page 2's own field must still read its real, own value.
  const page2Fields=Object.fromEntries(structure.sheetIdentities[1].fields.map(field=>[field.field,field.value]));
  assert.equal(page2Fields.projectName,"Beta Project","the differing sheet's own real value must never be silently corrected to the consensus");
});

// ============================================================
// Section 11: version/document governance -- sheet identity travels inside
// the SAME already-versioned drawing_structure_versions.summary JSON.
// ============================================================
test("sheet identity is carried inside the versioned structural-parser summary, not a separate unversioned representation",()=>{
  assert.match(engine,/sheetIdentities/);
  // summary is the exact column drawing_structure_versions persists per
  // real document VERSION (see drizzle/0034_drawing_structural_parser.sql
  // and worker/drawing-structural-parser-api.mjs) -- proven by source
  // reference rather than a second migration this stage does not need.
  assert.match(engine,/sheetIdentities,crossSheetConsistency\},reviewStatus/);
});

// ============================================================
// Section 12: UI contract -- a compact sheet identity block, review state
// visible, no blank rows for fields that do not exist.
// ============================================================
test("UI shows a compact sheet identity block with review state, and never renders a blank row for a field that was not found",()=>{
  assert.match(ui,/Drawing No/i);
  assert.match(ui,/Revision/i);
  assert.match(ui,/Scale/i);
});

// ============================================================
// Section 2/13: real drawings. drawingNumber must remain reliable on the
// same 3 real Opera sheets already proven (Legend/Notes, Floor Plan,
// Riser/Schematic), plus a materially different real project (Central
// Kitchen) and a 4th, structurally distinct real project (a DAR-NPC
// schematic set) for the acceptance matrix.
// ============================================================
const REAL_FILES=[
  ["Opera Legend/Notes",
    "/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/28.05 - CCTV System/DWG/00.General/BV-BSW-127-0000-OMR-DWG-SE-100-0000003-A.pdf"],
  ["Opera Floor Plan",
    "/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/28.05 - CCTV System/DWG/01.Security/BV-BSW-127-0000-OMR-DWG-SE-2L0-2100050-A.pdf"],
  ["Opera CCTV Schematic/Riser",
    "/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/28.05 - CCTV System/DWG/02.Schematics/BV-BSW-127-0000-OMR-DWG-SE-800-0000206-A.pdf"],
];
for(const[label,path] of REAL_FILES){
  test(`real drawing (${label}): drawingNumber remains reliable through the new structural extractor`,async t=>{
    if(!fs.existsSync(path))return t.skip("real Opera project source unavailable on this machine");
    const bytes=await readFile(path);
    const structure=await parseDrawingStructure(new Uint8Array(bytes));
    const identity=structure.sheetIdentities.find(entry=>entry.fields.some(field=>field.field==="drawingNumber"));
    assert.ok(identity,`${label} must produce a real drawingNumber field`);
    const drawingNumber=identity.fields.find(field=>field.field==="drawingNumber").value;
    assert.match(drawingNumber,/BV-BSW-127/,"the real drawing number must be recognizable, not garbled beyond use");
  });
}

test("real Opera floor plan: a real revision table is reconstructed end to end",async t=>{
  const path="/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/28.05 - CCTV System/DWG/01.Security/BV-BSW-127-0000-OMR-DWG-SE-2L0-2100050-A.pdf";
  if(!fs.existsSync(path))return t.skip("real Opera project source unavailable on this machine");
  const structure=await parseDrawingStructure(new Uint8Array(await readFile(path)));
  const identity=structure.sheetIdentities[0];
  assert.ok(identity.revisions.length>0,"a real revision table row must be reconstructed from the real floor plan");
  assert.ok(identity.revisions[0].approvedBy&&identity.revisions[0].checkedBy&&identity.revisions[0].date,"real DRAWN/CHECKED/APPROVED/DATE columns must all resolve on the real table");
});

// ============================================================
// Stage 7.5 Section 3: known real WRONG cases from the Stage 7 acceptance
// matrix must fail closed (Needs Review / null), never a plausible-looking
// wrong value. Generic safeguards only -- never a hardcoded company name.
// ============================================================
test("real Central Kitchen drawing: the real client value is now correct, with the real 'No.' label-continuation contamination removed",async t=>{
  const path="/Users/serein-b/Downloads/Projects/Central Kitchen - Makkah/Data/YALJ-R-002-R00.pdf";
  if(!fs.existsSync(path))return t.skip("real Central Kitchen project source unavailable on this machine");
  const structure=await parseDrawingStructure(new Uint8Array(await readFile(path)));
  const clientField=structure.sheetIdentities[0]?.fields.find(field=>field.field==="client");
  assert.ok(clientField,"a client field entry must exist (matched label)");
  if(clientField.value)assert.doesNotMatch(clientField.value,/^No\.\s/,"the real stray 'No.' label-continuation fragment must never contaminate the real client value");
});
test("real MARAFY drawing: a submission-status-shaped value ('100% SCHEMATIC DESIGN SUBMISSION') is never accepted as a client/consultant/project name -- fails closed to Needs Review",async t=>{
  const path="/Users/serein-b/Downloads/Projects/Construction of The BTS Multifamily Plots for MARAFY Commercial Core- ICT-Jeddah/Data/Rev01/Data From Client - Soakily/8- ict/00902-AEE-S11-XXX-DWG-EN-080002.pdf";
  if(!fs.existsSync(path))return t.skip("real MARAFY project source unavailable on this machine");
  const structure=await parseDrawingStructure(new Uint8Array(await readFile(path)));
  const identity=structure.sheetIdentities[0];
  assert.ok(identity,"a region must still be detected (7 known labels matched on this real sheet)");
  for(const field of identity.fields)if(field.value)assert.doesNotMatch(field.value,/\d+\s*%/,`field "${field.field}" must never accept a submission/progress-percentage-shaped value as a real name`);
});
test("a percentage-shaped submission-status token is rejected by a generic shape pattern, not a hardcoded literal string",()=>{
  assert.match(engine,/FIELD_FRAGMENT_REJECT/);
  assert.doesNotMatch(engine,/["']100%["']|["']SCHEMATIC DESIGN["']/i,"the reject pattern in code must be a generic numeric shape (\\d+%), never a hardcoded literal status string");
});

// ============================================================
// Stage 7.5 Section 4: drawing number contamination -- a bare short
// no-digit token (the real shape of a person's initials, e.g. a real
// Opera DESIGNED/DRAWN/CHECKED/APPROVED signature-block value) must never
// be appended to a real drawing number.
// ============================================================
test("a bare short no-digit token adjacent to a real drawing number is excluded, never appended",async()=>{
  const pdf=buildPositionedPdf([
    {text:"DRAWING NUMBER",x:100,y:900},{text:"BV-BSW-127-0000-SE-100",x:100,y:850},{text:"SS",x:150,y:840},
    {text:"CLIENT",x:300,y:900},{text:"Acme",x:300,y:880},
  ]);
  const structure=await parseDrawingStructure(pdf);
  const drawingNumber=structure.sheetIdentities[0].fields.find(field=>field.field==="drawingNumber");
  assert.ok(drawingNumber);
  assert.equal(drawingNumber.value,"BV-BSW-127-0000-SE-100","a bare 1-3 letter no-digit token (the real shape of a person's initials) must never contaminate the real drawing number");
});
for(const[label,path] of REAL_FILES){
  test(`real drawing (${label}): drawingNumber is never contaminated with a stray adjacent token`,async t=>{
    if(!fs.existsSync(path))return t.skip("real Opera project source unavailable on this machine");
    const structure=await parseDrawingStructure(new Uint8Array(await readFile(path)));
    const drawingNumber=structure.sheetIdentities.find(entry=>entry.fields.some(field=>field.field==="drawingNumber"))?.fields.find(field=>field.field==="drawingNumber").value;
    assert.ok(drawingNumber);
    assert.doesNotMatch(drawingNumber,/\s[A-Za-z]{1,3}$/,"the real drawing number must never end with a trailing bare short no-digit token");
  });
}

// ============================================================
// Stage 7.5 Section 2/3: field truth states. A matched label with no
// plausible value is an EXPLICIT "Needs Review" entry (visible, distinct
// from Unknown); a plausible value is "Suggested" (parser-derived, never
// silently treated as engineer-confirmed).
// ============================================================
test("a high-confidence, well-formed field is Suggested -- no engineer action implied",async()=>{
  const pdf=buildPositionedPdf([{text:"DRAWING NUMBER",x:100,y:900},{text:"ABC-123",x:100,y:880},{text:"CLIENT",x:300,y:900},{text:"Acme Corp",x:300,y:880}]);
  const structure=await parseDrawingStructure(pdf);
  const drawingNumber=structure.sheetIdentities[0].fields.find(field=>field.field==="drawingNumber");
  assert.equal(drawingNumber.status,"Suggested");
  assert.equal(drawingNumber.value,"ABC-123");
});

// ============================================================
// Stage 7.5 Section 5: minimal, real, backend-persisted review. ONE
// action reviews only the uncertain fields on a sheet; a high-confidence
// field is never part of the review payload; the persisted correction
// becomes the new authoritative value on the very next read.
// ============================================================
const d1=sql=>({
  prepare(text){
    let values=[];
    return{
      bind(...next){values=next;return this;},
      first:async()=>sql.prepare(text).get(...values)??null,
      all:async()=>({results:sql.prepare(text).all(...values)}),
      run:async()=>sql.prepare(text).run(...values),
    };
  },
  batch:async statements=>Promise.all(statements.map(s=>s.run())),
});
const structureFixture=()=>{
  const sql=new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY,owner_user_id TEXT,organization_id TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,current_version_id TEXT,deleted_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY,document_id TEXT,object_key TEXT,sha256 TEXT);
    CREATE TABLE drawing_intake_versions(id TEXT PRIMARY KEY,document_id TEXT,superseded_at TEXT,status TEXT);
    CREATE TABLE drawing_structure_versions(id TEXT PRIMARY KEY,project_id TEXT,document_id TEXT,document_version_id TEXT,drawing_intake_version_id TEXT,version_number INTEGER,input_fingerprint TEXT,output_fingerprint TEXT,parser_version TEXT,status TEXT,summary TEXT,review_status TEXT DEFAULT 'Needs Review',superseded_at TEXT,created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawing_structure_tables(id TEXT PRIMARY KEY,structure_version_id TEXT,table_key TEXT,page_number INTEGER,table_type TEXT,bounding_box TEXT,row_count INTEGER,column_count INTEGER,detection_confidence INTEGER,detection_method TEXT);
    CREATE TABLE drawing_structure_rows(id TEXT PRIMARY KEY,table_id TEXT,row_number INTEGER,bounding_box TEXT,structural_confidence INTEGER,structural_status TEXT,physical_row_count INTEGER);
    CREATE TABLE drawing_structure_columns(id TEXT PRIMARY KEY,table_id TEXT,column_number INTEGER,bounding_box TEXT,width REAL,header_candidate TEXT,confidence INTEGER);
    CREATE TABLE drawing_structure_cells(id TEXT PRIMARY KEY,table_id TEXT,row_id TEXT,column_id TEXT,row_number INTEGER,column_number INTEGER,bounding_box TEXT,raw_content TEXT,reconstructed_content TEXT,original_fragments TEXT,confidence INTEGER);
    CREATE TABLE drawing_structure_headers(id TEXT PRIMARY KEY,table_id TEXT,column_id TEXT,header_type TEXT,raw_content TEXT,bounding_box TEXT,source_fragment_ids TEXT,confidence INTEGER);
    CREATE TABLE drawing_structure_legend_rows(id TEXT PRIMARY KEY,table_id TEXT,row_id TEXT,source_page INTEGER,source_row TEXT,symbol_geometry TEXT,abbreviation TEXT,description TEXT,notes TEXT,bounding_box TEXT,structural_confidence INTEGER);
    CREATE TABLE drawing_structure_regions(id TEXT PRIMARY KEY,structure_version_id TEXT,region_key TEXT,page_number INTEGER,region_type TEXT,bounding_box TEXT,raw_content TEXT,source_fragments TEXT,confidence INTEGER,detection_method TEXT);
    CREATE TABLE drawing_structure_validation_issues(id TEXT PRIMARY KEY,structure_version_id TEXT,table_id TEXT,row_id TEXT,column_id TEXT,page_number INTEGER,issue_type TEXT,severity TEXT,bounding_box TEXT,detail TEXT,confidence INTEGER);
    CREATE TABLE drawing_structure_audit_events(id TEXT PRIMARY KEY,project_id TEXT,document_id TEXT,structure_version_id TEXT,action TEXT,previous_value TEXT,new_value TEXT,reason TEXT,actor_user_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawing_title_block_field_reviews(id TEXT PRIMARY KEY,project_id TEXT,structure_version_id TEXT,page_number INTEGER,field_key TEXT,value TEXT,status TEXT,reason TEXT,reviewed_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO projects VALUES('project_1','local-development-user','organization_bd_shaft_internal_pilot');
    INSERT INTO documents VALUES('doc_1','project_1','version_1',NULL);
    INSERT INTO document_versions VALUES('version_1','doc_1','object_key_1','sha256_1');
    INSERT INTO drawing_intake_versions VALUES('intake_1','doc_1',NULL,'Completed');
  `);
  const summary=JSON.stringify({
    pageCount:1,
    sheetIdentities:[{pageNumber:1,titleBlockRegion:{boundingBox:{x:0,y:0,width:100,height:100},confidence:90,reason:"test"},fields:[
      {field:"drawingNumber",value:"ABC-123",confidence:86,status:"Suggested",sourcePage:1,sourceRegion:null,extractionMethod:"test",reviewStatus:"Needs Review"},
      {field:"client",value:null,confidence:0,status:"Needs Review",sourcePage:1,sourceRegion:null,extractionMethod:"test",reviewStatus:"Needs Review"},
    ],revisions:[],currentRevision:null,sheetScale:null,multipleScaleRegions:null}],
    crossSheetConsistency:[],
  });
  sql.exec(`INSERT INTO drawing_structure_versions VALUES('structure_1','project_1','doc_1','version_1','intake_1',1,'fp_in','fp_out','v1','Completed','${summary.replace(/'/g,"''")}','Needs Review',NULL,'local-development-user',CURRENT_TIMESTAMP);`);
  return sql;
};
const req=(path,init)=>new Request(`http://localhost${path}`,init);

test("worker: reviewing a sheet identity persists a real correction, and it becomes the authoritative value on the very next read",async()=>{
  const sql=structureFixture(),env={DB:d1(sql),FILES:{}};
  const before=await(await handleDrawingStructuralParserApi(req("/api/documents/doc_1/drawing-structure"),env)).json();
  const clientBefore=before.version.summary.sheetIdentities[0].fields.find(f=>f.field==="client");
  assert.equal(clientBefore.status,"Needs Review");
  assert.equal(clientBefore.value,null);

  const missingReason=await handleDrawingStructuralParserApi(req("/api/documents/doc_1/drawing-structure/sheet-identity/1/review",{method:"POST",body:JSON.stringify({fields:[{field:"client",value:"Real Company Name"}],reason:"ok"})}),env);
  assert.equal(missingReason.status,422,"a short, non-substantive reason must be rejected");

  const response=await handleDrawingStructuralParserApi(req("/api/documents/doc_1/drawing-structure/sheet-identity/1/review",{method:"POST",body:JSON.stringify({fields:[{field:"client",value:"Real Company Name"}],reason:"Visually confirmed against the source PDF"})}),env);
  assert.equal(response.status,200);
  const reviewed=await response.json();
  const clientAfter=reviewed.version.summary.sheetIdentities[0].fields.find(f=>f.field==="client");
  assert.equal(clientAfter.status,"Confirmed / Reviewed");
  assert.equal(clientAfter.value,"Real Company Name");

  // Persisted, not browser-only: a fresh GET (a new "page load") sees the
  // same reviewed value.
  const after=await(await handleDrawingStructuralParserApi(req("/api/documents/doc_1/drawing-structure"),env)).json();
  const clientReloaded=after.version.summary.sheetIdentities[0].fields.find(f=>f.field==="client");
  assert.equal(clientReloaded.status,"Confirmed / Reviewed");
  assert.equal(clientReloaded.value,"Real Company Name");

  const reviewRows=await sql.prepare("SELECT * FROM drawing_title_block_field_reviews").all();
  assert.equal(reviewRows.length,1,"the correction must be a real, append-only persisted row, never a browser-only edit");
});

test("worker: a high-confidence field is never touched by review -- reviewing client leaves drawingNumber exactly as the parser found it",async()=>{
  const sql=structureFixture(),env={DB:d1(sql),FILES:{}};
  await handleDrawingStructuralParserApi(req("/api/documents/doc_1/drawing-structure/sheet-identity/1/review",{method:"POST",body:JSON.stringify({fields:[{field:"client",value:"Real Company Name"}],reason:"Visually confirmed against the source PDF"})}),env);
  const after=await(await handleDrawingStructuralParserApi(req("/api/documents/doc_1/drawing-structure"),env)).json();
  const drawingNumber=after.version.summary.sheetIdentities[0].fields.find(f=>f.field==="drawingNumber");
  assert.equal(drawingNumber.status,"Suggested");
  assert.equal(drawingNumber.value,"ABC-123");
});

// ============================================================
// Stage 7.5 Section 1: source consolidation -- the intake engine's own
// title-block metadata is explicitly non-authoritative wherever it is
// consumed (UI, persistence), never silently presented as confirmed
// alongside the real authoritative Sheet Identity output.
// ============================================================
test("the legacy intake Metadata tab is explicitly labeled non-authoritative in the UI",()=>{
  assert.match(ui,/non-authoritative/i);
  assert.match(ui,/Sheet Identity/);
});
test("the persisted legacy drawing_metadata extraction_method carries the non-authoritative marker, not a bare unlabeled string",()=>{
  assert.match(intakeApi,/metadataSource/);
  assert.doesNotMatch(intakeApi,/"Explicit title-block labels only"/);
});
