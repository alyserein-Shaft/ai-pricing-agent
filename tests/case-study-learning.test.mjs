import test from "node:test";
import assert from "node:assert/strict";
import { buildSimilaritySignals, computeCompleteness, reusableEligibility, similarityScore, assertPublicationAllowed, stableStringify } from "../app/domain/case-study-learning-engine.mjs";

test("complete and incomplete cases calculate only evidenced coverage",()=>{
 const full=["BOQ","Specification","Drawing","Supplier Quotation","Final Quotation","Approval Record","Final Product Selection"].map(sourceType=>({sourceType,completenessState:"Available"}));
 assert.equal(computeCompleteness(full,[]).sourceCompleteness,100);
 assert.equal(computeCompleteness(full.slice(0,2),[]).sourceCompleteness,29);
 assert.equal(computeCompleteness(full,[{recordType:"Selected Product",originalValue:"X",provenance:{sourceDocumentId:"d"}}]).groundTruthCompleteness,17);
});

test("historical price and compatibility safety fail closed",()=>{
 assert.equal(reusableEligibility({reviewState:"Approved",classification:"Pricing precedent",recordType:"Historical Price",provenance:{sourceDocumentId:"d"}}).eligible,false);
 assert.match(reusableEligibility({reviewState:"Approved",classification:"Project-specific fact",recordType:"Compatibility",provenance:{sourceDocumentId:"d",evidenceLevel:"Project Usage"}}).blockers.join(" "),/manufacturer evidence/i);
});

test("reviewed manufacturer evidence can become a candidate but never auto publishes",()=>{
 const item={reviewState:"Approved",classification:"Manufacturer rule",recordType:"Compatibility",provenance:{sourceDocumentId:"d",evidenceLevel:"Manufacturer Evidence"}};
 assert.equal(reusableEligibility(item).eligible,true);
 assert.equal(assertPublicationAllowed({item,caseStudy:{benchmarkState:"Learning"},releaseId:"r1"}).allowed,true);
});

test("holdout benchmark is isolated from its active release",()=>{
 const item={reviewState:"Approved",classification:"Manufacturer rule",recordType:"Engineering Rule",provenance:{sourceDocumentId:"d"}};
 assert.equal(assertPublicationAllowed({item,caseStudy:{benchmarkState:"Holdout",benchmarkRelease:"release-9"},releaseId:"release-9"}).allowed,false);
 assert.equal(assertPublicationAllowed({item,caseStudy:{benchmarkState:"Holdout",benchmarkRelease:"release-9"},releaseId:"release-10"}).allowed,true);
});

test("similarity is explainable and does not copy decisions",()=>{
 const a=buildSimilaritySignals({systemDomain:"Fire Alarm",projectType:"Hospital",region:"KSA",manufacturers:["Honeywell"]});
 const b=buildSimilaritySignals({systemDomain:"Fire Alarm",projectType:"Hospital",region:"UAE",manufacturers:["Honeywell"]});
 const result=similarityScore(a,b); assert.ok(result.score>50&&result.score<100); assert.ok(result.basis.every(v=>v.type&&v.value)); assert.equal("selectedProduct" in result,false);
});

test("stable snapshots make identical reprocessing idempotent",()=>{
 assert.equal(stableStringify({b:2,a:{d:4,c:3}}),stableStringify({a:{c:3,d:4},b:2}));
});
