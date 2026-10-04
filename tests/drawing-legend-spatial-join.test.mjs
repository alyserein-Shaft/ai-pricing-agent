import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { mapCanonicalBoxToViewport } from "../app/domain/drawing-coordinate-mapper.mjs";
import { LEGEND_JOIN_CLASSIFICATION, joinLegendRowsToProposals, normalizeLegendProposalGeometry } from "../app/domain/drawing-legend-spatial-join.mjs";

const projectId="project-al-mousa",documentId="doc-t00",page={pageWidth:2384,pageHeight:3370};
const assertBoxClose=(actual,expected,tolerance=1e-9)=>{for(const key of["x","y","width","height"])assert.ok(Math.abs(actual[key]-expected[key])<=tolerance,`${key}: ${actual[key]} != ${expected[key]}`);};
const row=(overrides={})=>({projectId,documentId,pageNumber:1,tableId:"fire-alarm",rowId:"fire:2",section:"FIRE ALARM SYSTEM",abbreviation:"H",description:"HEAT DETECTOR",boundingBox:{x:579.53,y:955.68,width:8.83,height:127.12},symbolCell:{boundingBox:{x:580.25,y:955.68,width:8.11,height:4.42}},descriptionCell:{boundingBox:{x:579.53,y:1031.76,width:8.11,height:51.04}},symbolGeometry:[],...overrides});
const rawProposal=(overrides={})=>({id:"proposal-h",proposalType:"LegendDefinition",projectId,sourceDocumentId:documentId,pageNumber:1,rawLabel:"H",normalizedMeaning:"HEAT DETECTOR",boundingBox:{x:575.8955555555556,y:897.9177777777778,width:19.096666666666668,height:366.2066666666667,pageWidth:2384,pageHeight:3370},evidence:{section:"FIRE ALARM SYSTEM",symbolBoundingBox:{x:575.8955555555556,y:943.6,width:19.096666666666668,height:41.18888888888889,pageWidth:2384,pageHeight:3370},visualRunId:"run-1",sourceDocumentVersionId:"version-1"},...overrides});
const proposal=(overrides={},source={})=>normalizeLegendProposalGeometry(rawProposal(overrides),page,{coordinateSpace:"Canonical",projectId,...source});

test("viewport proposal normalization uses the inverse mapper and retains both coordinate spaces",()=>{
  const canonical=rawProposal(),viewportBox=mapCanonicalBoxToViewport(canonical.boundingBox,page,{scale:1.5,rotation:90}),viewportSymbol=mapCanonicalBoxToViewport(canonical.evidence.symbolBoundingBox,page,{scale:1.5,rotation:90}),normalized=normalizeLegendProposalGeometry({...canonical,boundingBox:{x:viewportBox.left,y:viewportBox.top,width:viewportBox.width,height:viewportBox.height},evidence:{...canonical.evidence,symbolBoundingBox:{x:viewportSymbol.left,y:viewportSymbol.top,width:viewportSymbol.width,height:viewportSymbol.height}}},page,{coordinateSpace:"Viewport",scale:1.5,rotation:90,sourceImage:{width:5055,height:3576}});
  assert.equal(normalized.mappingMode,"ViewportToCanonicalInverse");
  assertBoxClose(normalized.canonicalBoundingBox,canonical.boundingBox);
  assertBoxClose(normalized.canonicalSymbolBoundingBox,canonical.evidence.symbolBoundingBox);
  assert.deepEqual(normalized.sourceImage,{width:5055,height:3576});
  assert.notDeepEqual(normalized.originalBoundingBox,normalized.canonicalBoundingBox);
});

test("persisted T-00 proposal boxes are recognized as already canonical and are not inverse-transformed twice",()=>{
  const normalized=proposal();
  assert.equal(normalized.mappingMode,"AlreadyCanonicalValidatedByRoundTrip");
  assertBoxClose(normalized.canonicalBoundingBox,rawProposal().boundingBox);
  assertBoxClose(normalized.canonicalSymbolBoundingBox,rawProposal().evidence.symbolBoundingBox);
});

test("H exact overlap joins only when geometry and text corroborate",()=>{
  const result=joinLegendRowsToProposals({structureRows:[row()],proposals:[proposal()]});
  assert.equal(result.rows[0].classification,LEGEND_JOIN_CLASSIFICATION.EXACT);
  assert.equal(result.rows[0].candidates[0].descriptionAgreement,true);
  assert.equal(result.rows[0].candidates[0].labelAgreement,true);
  assert.ok(result.rows[0].candidates[0].rowMetrics.containment>=.9);
  assert.ok(result.rows[0].candidates[0].symbolMetrics.containment>=.75);
});

test("proximity without overlap is rejected even when text is exact",()=>{
  const shifted=proposal({boundingBox:{...rawProposal().boundingBox,x:600},evidence:{...rawProposal().evidence,symbolBoundingBox:{...rawProposal().evidence.symbolBoundingBox,x:600}}});
  const result=joinLegendRowsToProposals({structureRows:[row()],proposals:[shifted]});
  assert.equal(result.rows[0].classification,LEGEND_JOIN_CLASSIFICATION.NONE);
  assert.ok(result.rows[0].rejected[0].reasons.includes("TEXT_ONLY_MATCH_REJECTED"));
});

for(const [name,rowChange,proposalChange,reason] of[
  ["page mismatch",{}, {pageNumber:2},"PAGE_MISMATCH"],
  ["document mismatch",{}, {sourceDocumentId:"other-document"},"DOCUMENT_MISMATCH"],
  ["cross-project isolation",{projectId:"other-project"},{},"PROJECT_MISMATCH"],
])test(`${name} is rejected before geometry ranking`,()=>{
  const result=joinLegendRowsToProposals({structureRows:[row(rowChange)],proposals:[proposal(proposalChange)]});
  assert.equal(result.rows[0].classification,LEGEND_JOIN_CLASSIFICATION.NONE);
  assert.ok(result.rows[0].rejected[0].reasons.includes(reason));
});

test("text agreement alone cannot join a proposal on an unrelated table section",()=>{
  const result=joinLegendRowsToProposals({structureRows:[row({tableId:"pa-va",section:"PUBLIC ADDRESS AND VOICE ALARM SYSTEM"})],proposals:[proposal()]});
  assert.equal(result.rows[0].classification,LEGEND_JOIN_CLASSIFICATION.NONE);
  assert.ok(result.rows[0].rejected[0].reasons.includes("LEGEND_SECTION_MISMATCH"));
});

test("unrelated proposal types and title-block-like boxes are excluded",()=>{
  const unrelated=proposal({proposalType:"TitleBlockField",boundingBox:{x:575,y:900,width:20,height:360}});
  const result=joinLegendRowsToProposals({structureRows:[row()],proposals:[unrelated]});
  assert.equal(result.rows[0].classification,LEGEND_JOIN_CLASSIFICATION.NONE);
  assert.ok(result.rows[0].rejected[0].reasons.includes("UNRELATED_PROPOSAL_TYPE"));
});

test("overlapping geometry with conflicting description is preserved as ambiguous, not forced",()=>{
  const conflict=proposal({normalizedMeaning:"SPEAKER WALL MOUNTED"});
  const result=joinLegendRowsToProposals({structureRows:[row()],proposals:[conflict]});
  assert.equal(result.rows[0].classification,LEGEND_JOIN_CLASSIFICATION.AMBIGUOUS);
  assert.ok(result.rows[0].candidates[0].reasons.includes("DESCRIPTION_CONFLICT"));
});

test("duplicate visual-run proposals remain separate exact candidates without automatic resolution",()=>{
  const first=proposal({id:"proposal-h-run-1"}),second=proposal({id:"proposal-h-run-2",evidence:{...rawProposal().evidence,visualRunId:"run-2"}}),result=joinLegendRowsToProposals({structureRows:[row()],proposals:[second,first]});
  assert.equal(result.rows[0].classification,LEGEND_JOIN_CLASSIFICATION.EXACT);
  assert.equal(result.rows[0].duplicateProposalCandidates,true);
  assert.deepEqual(result.rows[0].candidates.map(item=>item.proposalId),["proposal-h-run-1","proposal-h-run-2"]);
  assert.equal(result.summary.rowsWithDuplicateProposalCandidates,1);
});

test("vector-symbol rows can join from symbol geometry plus exact description without fabricated label text",()=>{
  const vectorRow=row({rowId:"fire:7",abbreviation:null,description:"LOOP POWERED STROBE",boundingBox:{x:679.44,y:952.2,width:12.84,height:155.95},symbolCell:{boundingBox:{x:679.44,y:952.2,width:12.84,height:11.28}},symbolGeometry:[{id:"shape-1"}]}),vectorProposal=proposal({id:"proposal-vector",rawLabel:"",normalizedMeaning:"LOOP POWERED STROBE",boundingBox:{x:674,y:897.9177777777778,width:20.594444444444445,height:366.2066666666667},evidence:{...rawProposal().evidence,rawLabel:"",rawDescription:"LOOP POWERED STROBE",symbolBoundingBox:{x:674,y:943.6,width:20.594444444444445,height:41.18888888888889}}}),result=joinLegendRowsToProposals({structureRows:[vectorRow],proposals:[vectorProposal]});
  assert.equal(result.rows[0].classification,LEGEND_JOIN_CLASSIFICATION.EXACT);
  assert.equal(result.rows[0].candidates[0].labelAgreement,true);
  assert.ok(result.rows[0].candidates[0].symbolMetrics.intersectionArea>0);
});

test("a proposal cannot silently cross-match multiple spatially overlapping canonical rows",()=>{
  const rows=[row({rowId:"row-a"}),row({rowId:"row-b",description:"OTHER DEVICE"})],result=joinLegendRowsToProposals({structureRows:rows,proposals:[proposal()]});
  assert.equal(result.rows.find(item=>item.rowId==="row-a").classification,LEGEND_JOIN_CLASSIFICATION.EXACT);
  assert.equal(result.rows.find(item=>item.rowId==="row-b").classification,LEGEND_JOIN_CLASSIFICATION.AMBIGUOUS);
  assert.equal(result.multiplyMatchedProposals.length,1);
});

test("pure join output is idempotent and module contains no persistence or review mutation path",()=>{
  const input={structureRows:[row()],proposals:[proposal()]},first=joinLegendRowsToProposals(input),second=joinLegendRowsToProposals(input),hash=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"),source=fs.readFileSync(new URL("../app/domain/drawing-legend-spatial-join.mjs",import.meta.url),"utf8");
  assert.equal(hash(first),hash(second));
  assert.doesNotMatch(source,/\.prepare\(|INSERT\s+INTO|UPDATE\s+|fetch\(|reviewStatus\s*=|approved\s*=/i);
});
