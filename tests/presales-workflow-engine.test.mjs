import test from "node:test";
import assert from "node:assert/strict";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";

const project={id:"project_test",name:"Fire Alarm Tender",organizationId:"org_test",systemDomain:"Fire Alarm"};
const readyFacts={documents:4,classified:4,boqItems:4,specificationExtractions:1,requirementProfiles:4,matchedItems:4,technicalApproved:4,pricedItems:4,commercialApproved:4,finalReviewApproved:4};

test("new project begins at document intake without inventing readiness",()=>{
 const result=derivePresalesWorkflow({project,facts:{}});
 assert.equal(result.readyForQuotation,false);
 assert.equal(result.currentStageId,"intake");
 assert.equal(result.stages.find(stage=>stage.id==="selection").status,"Not Started");
});

test("all existing technical and commercial gates unlock quotation drafting",()=>{
 const result=derivePresalesWorkflow({project,facts:readyFacts});
 assert.equal(result.readyForQuotation,true);
 assert.equal(result.currentStageId,"quotation");
 assert.equal(result.stages.find(stage=>stage.id==="quotation").status,"Ready");
});

test("commercial approval cannot bypass the final estimation review gate",()=>{
 const result=derivePresalesWorkflow({project,facts:{...readyFacts,finalReviewApproved:0,finalReviewPending:4}});
 assert.equal(result.readyForQuotation,false);
 assert.equal(result.stages.find(stage=>stage.id==="costing").status,"Needs Review");
 assert.match(result.blockers.map(item=>item.message).join(" "),/final estimation review/i);
});

test("safety blocks and missing current prices fail closed",()=>{
 const result=derivePresalesWorkflow({project,facts:{...readyFacts,openSafetyBlocks:1,missingPrices:1,pricedItems:3}});
 assert.equal(result.readyForQuotation,false);
 assert.match(result.blockers.map(item=>item.message).join(" "),/safety block|lack eligible current prices/i);
});

test("approved and issued quotation states advance without changing module facts",()=>{
 const approved=derivePresalesWorkflow({project,facts:{...readyFacts,quotationDrafts:1,quotationApproved:1,exportsCompleted:1}});
 assert.equal(approved.readyForIssue,true);
 assert.equal(approved.currentStageId,"issue");
 const issued=derivePresalesWorkflow({project,facts:{...readyFacts,quotationDrafts:1,quotationApproved:1,quotationIssued:1,exportsCompleted:1}});
 assert.equal(issued.status,"Quotation Issued");
 assert.equal(issued.progress,100);
});

test("unreviewed requirement profiles cannot leak into product selection",()=>{
 const result=derivePresalesWorkflow({project,facts:{...readyFacts,requirementReview:1}});
 assert.equal(result.stages.find(stage=>stage.id==="requirements").status,"Ready");
 assert.equal(result.stages.find(stage=>stage.id==="selection").status,"Not Started");
});
