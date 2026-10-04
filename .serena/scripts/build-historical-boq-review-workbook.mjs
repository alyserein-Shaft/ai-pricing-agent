import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const projectRoot = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an";
const outputDir = `${projectRoot}/outputs/historical-boq-learning`;
const data = JSON.parse(await fs.readFile(`${outputDir}/historical_boq_learning.json`, "utf8"));
const workbook = Workbook.create();
workbook.comments.setSelf({ displayName: "User" });

const navy = "#0B2A4A", header = "#DCEAF7", line = "#D5E0EC";
const clip = (value, max = 500) => String(value ?? "").slice(0, max);
const safe = (value) => typeof value !== "string" ? value : value.startsWith("=") ? `'${value}` : value;
const projectName = new Map(data.projects.map((row) => [row.id, row.name]));
const fileName = new Map(data.inventory.map((row) => [row.id, row.name]));
const sourceById = new Map(data.sourceRows.map((row) => [row.id, row]));
const finalById = new Map(data.finalRows.map((row) => [row.id, row]));

function addSheet(name, headers, rows, widths = []) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, 1, headers.length).merge();
  sheet.getRange("A1").values = [[name]];
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = { fill: navy, font: { name: "Aptos Display", bold: true, color: "#FFFFFF", size: 14 }, rowHeight: 28 };
  sheet.getRangeByIndexes(2, 0, 1, headers.length).values = [headers];
  sheet.getRangeByIndexes(2, 0, 1, headers.length).format = { fill: header, font: { name: "Aptos", bold: true, color: "#17324D", size: 10 }, wrapText: true, borders: { preset: "outside", style: "thin", color: line } };
  if (rows.length) {
    sheet.getRangeByIndexes(3, 0, rows.length, headers.length).values = rows.map((row) => row.map(safe));
    sheet.getRangeByIndexes(3, 0, rows.length, headers.length).format = { font: { name: "Aptos", size: 10, color: "#1E2F40" }, wrapText: true, verticalAlignment: "top", borders: { insideHorizontal: { style: "thin", color: "#E7EDF4" } } };
  }
  sheet.freezePanes.freezeRows(3);
  widths.forEach((width, index) => { if (width) sheet.getRangeByIndexes(0, index, Math.max(rows.length + 3, 4), 1).format.columnWidth = width; });
  return sheet;
}

const projects = addSheet("Projects", ["Historical Project ID","Project","Client","Disciplines","Date","Pair Before Recovery","Current Pair Status","Evidence","Confirm Pair","Reviewer Notes","Reviewer","Review Date"], data.projects.map((p) => [p.id,p.name,p.client,p.disciplines.join(", "),p.date,p.pairBeforeRecovery||p.pair,p.pair,JSON.stringify(p.completion),"","","",""]), [28,34,25,38,14,24,25,55,18,35,20,14]);
projects.getRange(`I4:I${data.projects.length+3}`).dataValidation = { rule: { type: "list", values: ["Confirm Pair","Reject Pair","Needs Evidence"] } };

addSheet("File Inventory", ["File ID","Historical Project ID","Project","File Name","Path","SHA-256","Size","Extension","Role","Source / Output","Revision","Evidence Basis","Confidence","Human Review","Readability","Container Path","Archive Member"], data.inventory.map((f) => [f.id,f.project_id,projectName.get(f.project_id),f.name,f.path,f.checksum,f.size,f.extension,f.role,f.side,f.revision||"",f.evidence,f.confidence,f.human_review?"Required":"Not Required",f.readability,f.containerPath||"",f.archiveMember||""]), [28,28,32,38,60,42,14,10,24,18,12,55,12,15,26,60,45]);

const pairEvidence = (p) => p.completion?.pairEvidence || (p.pair === "Complete Learning Pair" ? "Selected Rev02 source BOQs and issued quotation preserve comparable line structure; human confirmation remains required." : "Source and reviewed output are not both independently established at row level.");
addSheet("Source-Final Pairs", ["Historical Project ID","Project","Authoritative Source Basis","Revised Sources","Reviewed Output Basis","Final Cost Sheet","Final Quotation","Pair Classification","Evidence","Reviewer Decision","Reviewer Notes","Reviewer","Review Date"], data.projects.map((p) => [p.id,p.name,"See File Inventory","See File Inventory","See File Inventory","Present only where readable/confirmed","Issued PDF present",p.pair,pairEvidence(p),"","","",""]), [28,34,40,32,40,28,25,26,60,20,35,20,14]);

addSheet("Approved Ground Truth", ["Alignment ID","Historical Project ID","Project","Source Row ID","Final Row ID","Approval","Reviewer","Review Date","Audit Reference"], data.approvedGroundTruth.map((r) => [r.alignmentId,r.projectId,projectName.get(r.projectId),r.sourceRowId,r.finalRowId,"Approved Ground Truth",r.reviewer,r.reviewDate,r.auditId||""]), [28,28,32,28,28,22,20,14,28]);

function reviewRow(review) {
  const s=sourceById.get(review.sourceRowId)||{}, f=finalById.get(review.finalRowId)||{};
  return [review.alignmentId,review.projectId,projectName.get(review.projectId),review.sourceRowId,fileName.get(s.file_id),s.sheet,s.row,s.item||"",clip(s.description),s.unit||"",s.quantity??"",review.finalRowId,fileName.get(f.file_id),f.page,clip(f.description),f.unit||"",f.quantity??"",review.originalOutcome,review.reviewSuggestion,review.scoreComponents?.score??"",review.scoreComponents?.unitDifference||"",review.scoreComponents?.quantityDifference||"",review.conflictingSignals.join("; "),review.humanDecision,review.reviewerNotes,review.reviewer,review.reviewDate];
}
const reviewHeaders = ["Alignment ID","Historical Project ID","Project","Source Row ID","Source File","Sheet","Row","Item","Source Description","Source Unit","Source Quantity","Final Row ID","Final File","Page","Final Description","Final Unit","Final Quantity","Original Outcome","System Suggestion","Score","Unit Difference","Quantity Difference","Conflicting Signals","Reviewer Decision","Reviewer Notes","Reviewer","Review Date"];
const exactStrongRows = data.alignmentReviews.filter((r) => ["Exact Alignment","Strong Alignment"].includes(r.originalOutcome)).map(reviewRow);
const exactStrong = addSheet("Exact and Strong Review", reviewHeaders, exactStrongRows, [28,28,32,28,35,16,10,12,55,12,14,28,38,10,55,12,14,18,20,10,24,24,45,24,35,20,14]);
exactStrong.getRange(`X4:X${exactStrongRows.length+3}`).dataValidation = { rule: { type: "list", values: ["Approved Ground Truth","Needs Engineer Review","Rejected Alignment","Duplicate Alignment","Possible Split","Possible Merge"] } };

const possibleRows = data.alignmentReviews.filter((r) => r.originalOutcome === "Possible Alignment").map(reviewRow);
const possible = addSheet("Possible Alignments", reviewHeaders, possibleRows, [28,28,32,28,35,16,10,12,55,12,14,28,38,10,55,12,14,18,20,10,24,24,45,24,35,20,14]);
possible.getRange(`X4:X${possibleRows.length+3}`).dataValidation = { rule: { type: "list", values: ["Needs Engineer Review","Rejected Alignment","Duplicate Alignment","Possible Split","Possible Merge"] } };

const candidateHeaders = [];
for (let index=1; index<=5; index++) candidateHeaders.push(`Candidate ${index} Final Row ID`,`Candidate ${index} Score`,`Candidate ${index} Basis`,`Candidate ${index} Unit Difference`,`Candidate ${index} Quantity Difference`);
const unresolvedRows = data.unresolvedAssistance.map((r) => {
  const source=sourceById.get(r.sourceRowId)||{}; const cells=[];
  for (let index=0; index<5; index++) { const c=r.candidates[index]; cells.push(c?.finalRowId||"",c?.score??"",c?JSON.stringify({label:c.label,descriptionSimilarity:c.descriptionSimilarity,itemEqual:c.itemEqual,unitEqual:c.unitEqual,quantityEqual:c.quantityEqual,sharedTechnicalTerms:c.sharedTechnicalTerms}):"",c?.unitDifference||"",c?.quantityDifference||""); }
  return [r.sourceRowId,r.projectId,projectName.get(r.projectId),fileName.get(r.fileId),r.sheet,r.row,r.section||"",r.sourceDescription||"",r.sourceUnit||"",r.sourceQuantity??"",r.assistanceOutcome,...cells,r.reviewerSelectedCandidate,r.alignmentDecision,r.reviewerNotes,r.reviewer,r.reviewDate];
});
const unresolvedHeaders = ["Stable Source Row ID","Historical Project ID","Project","Source File","Sheet","Row","Section","Source Description","Source Unit","Source Quantity","Assistance Outcome",...candidateHeaders,"Reviewer Selected Candidate","Alignment Decision","Reviewer Notes","Reviewer","Review Date"];
const unresolved = addSheet("Unresolved Review Queue", unresolvedHeaders, unresolvedRows, unresolvedHeaders.map((_,i)=>i===7?55:i===3?38:i>=11&&((i-11)%5===2)?42:i<3?28:16));
const decisionCol = unresolvedHeaders.indexOf("Alignment Decision");
unresolved.getRangeByIndexes(3, decisionCol, Math.max(unresolvedRows.length,1), 1).dataValidation = { rule: { type: "list", values: ["Likely Exact","Likely Strong","Possible","No Candidate","Possible Split","Possible Merge","Likely Excluded"] } };

addSheet("Split-Merge Candidates", reviewHeaders, data.splitMergeCandidates.map(reviewRow), [28,28,32,28,35,16,10,12,55,12,14,28,38,10,55,12,14,18,20,10,24,24,45,24,35,20,14]);
addSheet("Exclusions", ["Final Row ID","Historical Project ID","Project","File","Page","Description","System Indicator","Reviewer Decision","Reviewer Notes","Reviewer","Review Date"], data.finalRows.filter((r)=>r.exclusion).map((r)=>[r.id,r.project_id,projectName.get(r.project_id),fileName.get(r.file_id),r.page,clip(r.description),r.exclusion,"","","",""]), [28,28,32,38,10,55,20,22,35,20,14]);
addSheet("Extracted Patterns", ["Pattern ID","Pattern Type","Scope","Discipline","Signature","Trigger Conditions","Expected Behavior","Evidence Count","Confidence","Source Projects","Active Status"], data.patterns.map((p)=>[p.id,p.type,p.scope,p.discipline,p.signature,JSON.stringify(p.triggers),p.behavior,p.evidence_count,p.confidence,p.projects.map((id)=>projectName.get(id)).join(", "),"Inactive — no approved ground truth"]), [28,32,28,20,55,45,55,16,12,45,30]);
const patternReview = addSheet("Pattern Review", ["Pattern ID","Pattern Type","Current Scope","Reviewer Decision","Restriction","Reviewer Notes","Reviewer","Review Date"], data.patterns.map((p)=>[p.id,p.type,p.scope,"","","","",""]), [28,32,28,22,28,40,20,14]);
patternReview.getRange(`D4:D${data.patterns.length+3}`).dataValidation = { rule: { type: "list", values: ["Keep Inactive","Approve after Ground Truth","Reject Pattern","Needs Evidence"] } };

addSheet("Blocked Files", ["Project","File Path","Blocker","Readable Alternate Evidence","Human Action Required"], data.blockedFiles.map((r)=>[r.project,r.path,r.reason,r.alternateEvidence,"Provide password or a readable unencrypted cost-sheet export."]), [32,65,52,48,48]);
addSheet("Instructions", ["Step","Instruction","Safety Boundary"], [
  [1,"Confirm each source/final pair using the stable historical project ID.","Filenames and folder placement are evidence, not final authority."],
  [2,"Review all Exact and Strong rows; most currently reuse a final row and are flagged as possible merges.","No score or system suggestion grants approval."],
  [3,"Review the 13 Possible Alignments separately and record a substantive reason.","Possible rows cannot be promoted without explicit evidence."],
  [4,"Use the Unresolved Review Queue; select at most one candidate unless explicitly documenting a split/merge.","Candidate ranking is same-project only and never auto-approves."],
  [5,"Enter reviewer identity, notes and review date for every decision.","Only explicit Approved Ground Truth may become active learning evidence."],
  [6,"Keep patterns inactive until rebuilt from approved ground truth.","Single-project evidence remains project-scoped."],
  [7,"Run holdout only after three complete grounded projects exist.","Do not simulate missing ground truth or apply patterns to the live project."],
], [10,85,80]);

await fs.mkdir(outputDir, { recursive: true });
console.log((await workbook.inspect({kind:"table",range:"Projects!A1:L8",include:"values,formulas",tableMaxRows:8,tableMaxCols:12})).ndjson);
console.log((await workbook.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"formula error scan"})).ndjson);
for (const sheet of workbook.worksheets.items) {
  const maxCols = Math.min(sheet.getUsedRange()?.columnCount ?? 12, 20);
  const end = String.fromCharCode(64 + Math.min(maxCols, 26));
  const preview = await workbook.render({sheetName:sheet.name,range:`A1:${end}16`,scale:1,format:"png"});
  await fs.writeFile(`${outputDir}/preview-${sheet.name.replace(/[^a-z0-9]+/gi,"-")}.png`,new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/Historical_BOQ_Learning_Review.xlsx`);
console.log(JSON.stringify({workbook:`${outputDir}/Historical_BOQ_Learning_Review.xlsx`,sheets:workbook.worksheets.items.map((s)=>s.name)}));
