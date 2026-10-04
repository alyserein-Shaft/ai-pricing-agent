import { buildLegendDefinitionProposals } from '../app/domain/drawing-legend-notes-intelligence.mjs';
// Model choice is deliberately scoped to THIS candidate-comparison pilot
// only -- drawing-visual-understanding-provider.mjs (the general WLC-only
// pilot) keeps its own DEFAULT_VISION_MODEL (llava) untouched. This is the
// exact configuration validated in a separate bounded benchmark (12 held-
// out symbol pairs, full recovery after switching off default reasoning):
// non-thinking mode (chat_template_kwargs.enable_thinking:false, a real
// documented field on this model's own input schema, not invented) plus a
// completion budget sized for a no-reasoning answer, replacing the
// default reasoning-inclusive budget that produced 9/12 empty responses.
export const CANDIDATE_COMPARISON_MODEL = '@cf/qwen/qwen3.8-27b';
const CANDIDATE_COMPARISON_MAX_COMPLETION_TOKENS = 400;
const CANDIDATE_COMPARISON_CHAT_TEMPLATE_KWARGS = { enable_thinking: false };
export const CANDIDATE_APPLICABILITY = 'Unconfirmed candidate legend — drawing-number mismatch';
const parse = (value) => { try { return JSON.parse(value); } catch { return null; } };
const validBox = (b, page) => b && [b.x,b.y,b.width,b.height].every(Number.isFinite) && b.x>=0 && b.y>=0 && b.width>0 && b.height>0 && b.x+b.width<=page.width && b.y+b.height<=page.height;
export function validateCandidateInput(body, document, candidate, pages) {
  if (!candidate || candidate.project_id!==document.project_id || candidate.id===document.id || candidate.version_id!==body.candidateDocumentVersionId || document.version_id!==body.wlcDocumentVersionId) return false;
  if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length>40 || !Array.isArray(body.images) || !body.images.length || body.images.length>50 || !Array.isArray(body.comparisons) || body.comparisons.length<1 || body.comparisons.length>6) return false;
  if (new Set(body.entries.map(e=>e.id)).size!==body.entries.length) return false;
  for (const image of body.images) {
    if (!image || typeof image.base64!=='string' || !image.base64.startsWith('iVBORw0KGgo') || image.base64.length>6000000) return false;
    const doc=image.documentId===document.id ? document : image.documentId===candidate.id ? candidate : null;
    const page=pages.find(p=>p.documentId===image.documentId && p.page_number===image.pageNumber);
    if (!doc || image.documentVersionId!==doc.version_id || !page) return false;
    if (image.kind==='comparison') {
      if (!Array.isArray(image.componentImageIndices) || image.componentImageIndices.length!==2 || image.componentImageIndices.some(i=>!Number.isInteger(i)||!body.images[i]||body.images[i].kind==='comparison')) return false;
    } else if (!validBox(image.boundingBox,page)) return false;
  }
  for (const e of body.entries) {
    const im=body.images[e.imageIndex];const page=pages.find(p=>p.documentId===candidate.id && p.page_number===im?.pageNumber);
    if (!e.id || e.section!=='FIRE ALARM SYSTEM' || typeof e.description!=='string' || !e.description.trim() || e.description.length>1000 || im?.documentId!==candidate.id || im.kind==='comparison' || !validBox(e.symbolBoundingBox,page) || JSON.stringify(e.boundingBox)!==JSON.stringify(im.boundingBox)) return false;
  }
  for (const pair of body.comparisons) {
    const e=body.entries.find(e=>e.id===pair.legendEntryId),wi=body.images[pair.wlcImageIndex],pi=body.images[pair.comparisonImageIndex];
    if (!e || e.imageIndex!==pair.legendImageIndex || wi?.documentId!==document.id || wi.kind==='comparison' || pi?.kind!=='comparison' || JSON.stringify(pi.componentImageIndices)!==JSON.stringify([pair.wlcImageIndex,pair.legendImageIndex])) return false;
  }
  return true;
}

export async function runCandidateComparison(env, document, candidate, body) {
  const intake=await env.DB.prepare('SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1').bind(document.id).first();
  const ci=await env.DB.prepare('SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1').bind(candidate.id).first();
  if(!intake||!ci)return {error:{code:'DRAWING_INTAKE_REQUIRED'}};
  const pages=[];
  for(const [doc,iv] of [[document,intake],[candidate,ci]]) {
    const rows=(await env.DB.prepare('SELECT * FROM drawing_pages WHERE intake_version_id=?').bind(iv.id).all()).results||[];
    pages.push(...rows.map(p=>({...p,documentId:doc.id})));
  }
  if(!validateCandidateInput(body,document,candidate,pages))return {error:{code:'CANDIDATE_INPUT_INVALID'}};
  if(!env.AI?.run || !env.FILES?.put)return {error:{code:'AI_PROVIDER_UNAVAILABLE'}};
  const meta=await env.DB.prepare('SELECT * FROM drawing_metadata WHERE intake_version_id=?').bind(ci.id).first();
  const runId=`drawingCandidateRun_${crypto.randomUUID()}`,created=new Date().toISOString();
  const model=env.DRAWING_CANDIDATE_COMPARISON_MODEL||CANDIDATE_COMPARISON_MODEL;
  const manifest={purpose:'CandidateComparison',applicability:CANDIDATE_APPLICABILITY,approvedForTakeoff:false,approvedForPricing:false,documentId:document.id,documentVersionId:document.version_id,intakeVersionId:intake.id,candidateDocumentId:candidate.id,candidateDocumentVersionId:candidate.version_id,candidateIntakeVersionId:ci.id,candidateSha256:candidate.sha256,wlcSha256:document.sha256,candidateDrawingNumber:meta?.drawing_number,registerRevision:meta?.revision??null,visuallyExtractedRevision:{value:String(body.visuallyExtractedRevision||''),source:'Visual title-block transcription; not register confirmation',pageNumber:body.pageNumber},entries:body.entries,comparisons:body.comparisons,coordinateConvention:'Canonical PDF lower-left y-up; crops rendered with page rotation',images:[]};
  await env.DB.prepare("INSERT INTO drawing_visual_runs (id,project_id,document_id,document_version_id,intake_version_id,page_number,status,input_manifest,model_info,created_at) VALUES (?,?,?,?,?,?,'Running',?,?,?)").bind(runId,document.project_id,document.id,document.version_id,intake.id,body.pageNumber,JSON.stringify(manifest),JSON.stringify({visionModel:model,purpose:'CandidateComparison'}),created).run();
  const records=[],decoded=[];
  try {
    for(const [index,image] of body.images.entries()) {
      const bytes=Uint8Array.from(atob(image.base64),c=>c.charCodeAt(0));decoded.push(bytes);
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
      const objectKey=`projects/${document.project_id}/documents/${document.id}/visual-runs/${runId}/image-${index}.png`;
      await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType:'image/png'}});
      const {base64,...rest}=image;manifest.images.push({...rest,index,objectKey,sha256});
      await env.DB.prepare('UPDATE drawing_visual_runs SET input_manifest=? WHERE id=?').bind(JSON.stringify(manifest),runId).run();
    }
    const definitions=buildLegendDefinitionProposals({sourceDocument:{id:candidate.id,drawingNumber:meta?.drawing_number,sheetName:meta?.sheet_name},pageNumber:body.pageNumber,legendEntries:body.entries.map(e=>({...e,visualExtraction:true,sourceDocumentVersionId:candidate.version_id,visualRunId:runId,applicableSystem:'Fire Alarm',imageProvenance:manifest.images[e.imageIndex],registerRevision:manifest.registerRevision,visuallyExtractedRevision:manifest.visuallyExtractedRevision}))});
    const existing=(await env.DB.prepare("SELECT evidence FROM drawing_extraction_proposals WHERE document_id=? AND intake_version_id=? AND extraction_version='candidate-legend-visual-1'").bind(candidate.id,ci.id).all()).results||[];
    const existingRows=new Set(existing.map(r=>{const e=parse(r.evidence);return JSON.stringify([e?.sourceDocumentVersionId,e?.sequence,e?.boundingBox,e?.rawDescription]);}));
    const statements=definitions.map((d,i)=>({d,i})).filter(({d})=>!existingRows.has(JSON.stringify([candidate.version_id,d.evidence.sequence,d.evidence.boundingBox,d.evidence.rawDescription]))).map(({d,i})=>env.DB.prepare("INSERT INTO drawing_extraction_proposals (id,project_id,document_id,intake_version_id,page_number,proposal_key,proposal_type,raw_label,normalized_value,bounding_box,authority_role,governed_status,hard_review_reasons,evidence,source_references,extraction_method,extraction_version,review_status,created_at,updated_at,visual_run_id) VALUES (?,?,?,?,?,?,'LegendDefinition',?,?,?,?,?,?,?,?,?,?,'Needs Review',?,?,?)").bind(`${runId}:legend:${i}`,candidate.project_id,candidate.id,ci.id,body.pageNumber,`${runId}:legend:${i}`,d.rawLabel||d.normalizedMeaning,JSON.stringify(d.normalizedMeaning),JSON.stringify(d.boundingBox),'Primary','Needs Review',JSON.stringify(d.hardReviewReasons),JSON.stringify({...d.evidence,applicableSystem:'Fire Alarm',sourceDocumentId:candidate.id,sourceDocumentVersionId:candidate.version_id,visualRunId:runId,runOwnerDocumentId:document.id,approvedForTakeoff:false,approvedForPricing:false}),JSON.stringify(d.sourceReferences),d.extractionMethod,'candidate-legend-visual-1',created,created,runId));
    if (statements.length) await env.DB.batch(statements);
    const comparisons=[];
    // Neutral visual-observation prompt: no device name, no legend
    // description, no expected-match hint. Same wording validated across
    // the 4-pair, 12-pair held-out, and 12-pair recovery benchmarks --
    // asks only for outline/letters/qualifiers/differences/unreadable
    // parts, explicitly distinct from wiring/quantity-label context.
    const prompt = "This image shows two separate black-and-white engineering symbols side by side, labeled LEFT and RIGHT above them. Describe LEFT: its outline shape, any letters visible inside it, and any qualifier mark positioned outside its main outline (for example a small attached letter, or a dashed box surrounding it). Then describe RIGHT the same way. Then state what is visually similar between LEFT and RIGHT, and what is visually different -- if you see no real difference, say so explicitly rather than inventing one. If any part of either symbol is too small or unclear to read, say exactly which part is unreadable. Do not name or guess what kind of device either symbol represents, and do not use outside knowledge about what these symbols usually mean. Keep the answer under 150 words.";
    for(const pair of body.comparisons) {
      const entry=body.entries.find(e=>e.id===pair.legendEntryId);
      const compositeImage=body.images[pair.comparisonImageIndex];
      const imageBase64=compositeImage?.base64;
      const record={callIndex:records.length,stage:'candidate-visual-comparison',model,input:{prompt,imageIndex:pair.comparisonImageIndex,componentImageIndices:[pair.wlcImageIndex,pair.legendImageIndex],legendEntryId:entry.id,max_completion_tokens:CANDIDATE_COMPARISON_MAX_COMPLETION_TOKENS,chat_template_kwargs:CANDIDATE_COMPARISON_CHAT_TEMPLATE_KWARGS},status:'Running',response:null};records.push(record);
      await env.DB.prepare('UPDATE drawing_visual_runs SET raw_responses=? WHERE id=?').bind(JSON.stringify(records),runId).run();
      const response=await env.AI.run(model,{
        messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/png;base64,${imageBase64}`}}]}],
        max_completion_tokens:CANDIDATE_COMPARISON_MAX_COMPLETION_TOKENS,
        chat_template_kwargs:CANDIDATE_COMPARISON_CHAT_TEMPLATE_KWARGS,
      });
      record.response=response;record.status='Returned';
      await env.DB.prepare('UPDATE drawing_visual_runs SET raw_responses=? WHERE id=?').bind(JSON.stringify(records),runId).run();
      const assessmentText=response?.choices?.[0]?.message?.content ?? (typeof response==='string'?response:JSON.stringify(response));
      const finishReason=response?.choices?.[0]?.finish_reason ?? null;
      comparisons.push({...pair,literalDescription:entry.description,modelAssessment:assessmentText,modelFinishReason:finishReason,applicability:CANDIDATE_APPLICABILITY,reviewStatus:'Needs Review',reviewedBy:null,approvedForTakeoff:false,approvedForPricing:false,legendEvidence:manifest.images[pair.legendImageIndex],wlcEvidence:manifest.images[pair.wlcImageIndex]});
    }
    const result={purpose:'CandidateComparison',applicability:CANDIDATE_APPLICABILITY,reviewStatus:'Needs Review',referenceStatus:'Unresolved',revisionCompatibility:'Unknown',approvedForTakeoff:false,approvedForPricing:false,legendDefinitions:definitions,comparisons};
    await env.DB.prepare("UPDATE drawing_visual_runs SET status='Completed',result=?,completed_at=? WHERE id=?").bind(JSON.stringify(result),new Date().toISOString(),runId).run();
    return {runId,...result};
  } catch(error) {
    await env.DB.prepare("UPDATE drawing_visual_runs SET status='Failed',error_code=?,completed_at=? WHERE id=?").bind('CANDIDATE_COMPARISON_FAILED',new Date().toISOString(),runId).run();
    return {error:{code:'CANDIDATE_COMPARISON_FAILED',runId,message:'Candidate evidence and available raw responses retained; current WLC analysis unchanged.'}};
  }
}
