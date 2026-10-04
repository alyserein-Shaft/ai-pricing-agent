// Read model only: distinct current engineering candidates, with source
// fragments and historical outputs accounted for separately.
const normalize=value=>String(value??'').toUpperCase().replace(/[^A-Z0-9.]/g,'');
const familyBySource={Loop:'Circuits',AiCircuit:'Circuits',Cable:'Cable specifications',AiCableSpec:'Cable specifications',Interface:'Interfaces',AiInterface:'Interfaces',CrossSheetRef:'Drawing references',AiCrossSheetRef:'Drawing references',AiEquipment:'Equipment and locations',Equipment:'Equipment and locations',Connection:'Possible connections',Placement:'Placements',Installation:'Installation requirements',MatrixRelation:'Cause and effect',AiQuantity:'Associated quantities',Legend:'Legend definitions',Callout:'Callouts',DetailNumber:'Detail references'};
const keyFor=(item,family)=>{
 const label=String(item.label || '');
 if(family==='Circuits')return normalize(label.match(/(?:NAC\s*LOOP|LOOP\s*[- ]\s*\d+)/i)?.[0] || label);
 if(family==='Cable specifications')return normalize(label.match(/\d+\s*[x×]\s*\d+(?:\.\d+)?/i)?.[0] || label);
 if(family==='Interfaces')return normalize(label.replace(/^INTERFACE\s+TO\s+/i,''));
 if(family==='Drawing references')return normalize(item.evidence?.referencedDrawingNumber || label.replace(/^(?:→|->)\s*/,'').replace(/\s*\(.*$/,''));
 return normalize(label);
};
export const buildDrawingUnderstandingSummary=({sourceDocument={},drawingType=null,items=[],historicalCount=0}={})=>{
 const active=items.filter(i=>!i.supersededAt && !['Rejected','Not Found'].includes(i.reviewStatus));
 const groups=new Map();let overlappingSources=0;
 // Prefer AI's contextual explanation over a duplicate raw deterministic tag.
 for(const item of [...active].sort((a,b)=>Number(b.sourceType?.startsWith('Ai'))-Number(a.sourceType?.startsWith('Ai')))) {
   const family=familyBySource[item.sourceType];
   if(!family || item.evidence?.groundingWarning)continue;
   const key=family+':'+keyFor(item,family);
   if(groups.has(key)){overlappingSources++;groups.get(key).members.push(item);continue;}
   groups.set(key,{family,item,members:[]});
 }
 const engineering=[...groups.values()];
 // Same deduped groups the summary line/mainFindings above are built from,
 // exposed as real items (not pre-joined text) so a caller can render one
 // compact card per distinct current finding -- grouped by the exact same
 // familiar categories, with source fragments/duplicates/historical runs
 // already excluded by the filtering above. Order matches mainFindings.
 // `members` keeps every OTHER source interpretation that was grouped under
 // the representative item (previously counted only as overlappingSources and
 // then discarded). Keyed by the representative item's id so a caller can show
 // all of a group's member evidence -- reviewing the representative is not a
 // review of the members, and their evidence must stay reachable.
 const groupedFindings=[...new Set(engineering.map(x=>x.family))].map(family=>({
   family,
   items:engineering.filter(x=>x.family===family).map(x=>x.item),
   members:Object.fromEntries(engineering.filter(x=>x.family===family).map(x=>[x.item.id,x.members])),
 }));
 const heading=sourceDocument.sheetName || drawingType || 'Drawing identity not yet established';
 const whatThisExplains=`${heading}${sourceDocument.revision ? ` — revision ${sourceDocument.revision}`:''}${sourceDocument.drawingNumber ? ` (${sourceDocument.drawingNumber})`:''}. Engineering review is pending.`;
 const mainFindings=[];
 for(const family of [...new Set(engineering.map(x=>x.family))]) {
   const group=engineering.filter(x=>x.family===family);
   mainFindings.push(`${family}: ${group.map(x=>family==='Circuits' && x.item.sourceType==='Loop' ? `${x.item.label} — Unknown (tag found; status not established)` : x.item.label).join('; ')}.`);
 }
 const notes=active.filter(i=>i.semanticType==='notes').map(i=>i.label);
 if(notes.length)mainFindings.push(`Notes: ${[...new Set(notes)].map(n=>n.replace(/[.]+$/,'')).join('; ')}.`);
 const sourceFragments=items.filter(i=>['Text','Structure','DeviceCode','MatrixHeader'].includes(i.sourceType)).length;
 const warnings=active.filter(i=>i.evidence?.groundingWarning);
 const needsClarification=[...new Set(active.filter(i=>i.semanticType==='missingOrAmbiguous').map(i=>i.label))];
 if(engineering.some(x=>x.family==='Circuits' && x.item.evidence?.spareStatus==='Unknown'))needsClarification.push('Unknown circuit status means insufficient evidence; connections and device assignments are not established.');
 needsClarification.push(`${engineering.length} distinct current engineering candidates; ${overlappingSources} overlapping source interpretations grouped. ${sourceFragments} source fragments and ${historicalCount} historical AI outputs are not additional engineering findings.`);
 if(warnings.length)needsClarification.push(`${warnings.length} additional model proposals need source clarification and are excluded from the engineering count.`);
 if(active.some(i=>/N\.?T\.?S|NOT TO BE SCALED/i.test(i.evidence?.textContent || i.label || '')))needsClarification.push('Drawing is not to scale. Cable specification mentions are not lengths or additional quantities.');
 if(active.some(i=>i.reviewStatus==='Conflict' || i.governedStatus==='Conflict'))needsClarification.push('Some findings are flagged as Conflict and require resolution.');
 needsClarification.push('Human engineering approval remains pending.');
 return {whatThisExplains,mainFindings,needsClarification,groupedFindings,hasAiFindings:active.some(i=>i.sourceType?.startsWith('Ai')),counts:{currentEngineering:engineering.length,overlappingSources,sourceFragments,historical:historicalCount,needsSourceClarification:warnings.length}};
};

// Structured "needs attention", derived from the SAME already-loaded items
// the findings list above is built from. Nothing here is invented: every
// entry names the real record it came from (itemId), so the UI can open that
// record's own evidence rather than describing a task that has no source.
//
// Three deliberately separate kinds, because they are not the same question:
//   decision  -- a recorded conflict or a recorded unresolved reference that
//                an engineer has to settle.
//   missing   -- something the analysis recorded as ABSENT or not established
//                in the source. Not a task list: "Cable lengths" here means
//                "this drawing does not state cable lengths", never "someone
//                must supply cable lengths".
//   pending   -- records that exist and are simply awaiting review/approval.
// `processingNotes` holds the counting/deduplication/technical lines that
// belong in History & tools, not in an engineer's attention list.
export const buildDrawingAttention=({items=[],groupedFindings=[],referenceMismatches=[]}={})=>{
 const active=items.filter(i=>!i.supersededAt && !['Rejected','Not Found'].includes(i.reviewStatus));
 const representatives=groupedFindings.flatMap(group=>group.items);
 const decisions=[];
 for(const item of representatives){
  if(item.reviewStatus!=='Conflict' && item.governedStatus!=='Conflict')continue;
  decisions.push({
   id:`conflict:${item.id}`,
   itemId:item.id,
   title:item.label || 'Finding flagged as Conflict',
   why:'This record is stored with a Conflict status, so its value is not settled and cannot be relied on downstream.',
  });
 }
 // One entry per unresolved reference, stated at reference level with the
 // real requested and candidate drawing numbers the records carry. The main
 // explanation stays short (what's unconfirmed and why); run/pair counts and
 // model history are kept out of it and surfaced separately as historyNote,
 // for a secondary/technical line rather than the primary statement.
 for(const mismatch of referenceMismatches){
  decisions.push({
   id:`reference:${mismatch.requestedDrawingNumber || mismatch.id}`,
   itemId:mismatch.itemId || null,
   title:`Referenced drawing ${mismatch.requestedDrawingNumber || 'number not recorded'} is unresolved`,
   why:'The requested drawing number does not exactly match any document in this project, so applicability of anything on the referenced sheet remains unconfirmed.',
   candidateDrawingNumber:mismatch.candidateDrawingNumber || null,
   requestedDrawingNumber:mismatch.requestedDrawingNumber || null,
   historyNote:mismatch.candidateDrawingNumber
    ? `${mismatch.runCount || 0} saved comparison run${mismatch.runCount===1?'':'s'} (${mismatch.comparisonCount || 0} pairs) previously used ${mismatch.candidateDrawingNumber} as a stand-in candidate.`
    : null,
  });
 }
 const missing=[];
 const seenMissing=new Set();
 for(const item of active){
  if(item.semanticType!=='missingOrAmbiguous')continue;
  const label=String(item.label || '').trim();
  if(!label || seenMissing.has(label))continue;
  seenMissing.add(label);
  missing.push({
   id:`missing:${item.id}`,
   itemId:item.id,
   title:label,
   // Never claims the drawing itself lacks this information -- only that the
   // current analysis pass did not establish it. A limit on what has been
   // read so far, not a task the drawing raises and not proof of absence.
   why:'Not established by the current analysis. This is a limit on what has been read from the drawing so far, not a task it raises.',
  });
 }
 for(const item of representatives){
  if(item.evidence?.spareStatus!=='Unknown')continue;
  missing.push({
   id:`unknown-status:${item.id}`,
   itemId:item.id,
   title:`${item.label || 'Circuit'} — status not established`,
   why:'The tag was found but no evidence establishes whether it is populated or spare, so its connections and device assignments are not established.',
  });
 }
 const notToScale=active.find(i=>/N\.?T\.?S|NOT TO BE SCALED/i.test(i.evidence?.textContent || i.label || ''));
 if(notToScale)missing.push({
  id:`not-to-scale:${notToScale.id}`,
  itemId:notToScale.id,
  title:'Drawing is not to scale',
  why:'Nothing may be measured off this sheet. Cable specification mentions are cable types, not lengths or additional quantities.',
 });
 const groundingWarnings=active.filter(i=>i.evidence?.groundingWarning);
 for(const item of groundingWarnings){
  missing.push({
   id:`grounding:${item.id}`,
   itemId:item.id,
   title:item.label || 'Proposal needs source clarification',
   why:String(item.evidence.groundingWarning),
  });
 }
 const awaitingReview=representatives.filter(i=>i.reviewStatus==='Needs Review');
 return {
  decisions,
  missing,
  pending:{awaitingReview},
  processingNotes:[],
 };
};
