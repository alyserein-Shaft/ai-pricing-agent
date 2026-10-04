import { extractDrawingStructure, DRAWING_INTAKE_VERSION } from "../app/domain/drawing-intake-engine.mjs";
import {applicationActor,resolveApplicationContext} from "./application-context.mjs";
import { resolveProjectAuthority } from "./project-authority.mjs";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});const id=(p)=>`${p}_${crypto.randomUUID()}`;const parse=(v,f=null)=>{try{return JSON.parse(v||"");}catch{return f;}};const hash=async(v)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(typeof v==="string"?v:JSON.stringify(v))))].map(b=>b.toString(16).padStart(2,"0")).join("");
// AUTHORIZATION IS NOT OWNERSHIP. This gated on `projects.owner_user_id = ?`,
// which refuses a correctly-authorized server-configured administrator and
// reports it as DRAWING_NOT_FOUND -- indistinguishable from the drawing not
// existing, and it also hid the real cause (an authorization refusal) behind a
// storage-sounding error. Project ownership is one SOURCE of project authority,
// not its definition: `resolveProjectAuthority` also resolves an active
// `project_members` role and an explicit server-configured Administrator.
//
// The document is still resolved through the project's organization scope, the
// CURRENT document version, and non-deleted state; only the actor check moves to
// the single canonical resolver, exactly as `quantity-source-decision-api.mjs`
// and `drawing-quantity-evidence-api.mjs` now do. Refusal is separate and
// truthful (403).
const visibleDocument=(db,documentId,organizationId)=>db.prepare("SELECT d.*,v.id version_id,v.version_number document_version_number,v.original_filename,v.extension,v.sha256,v.object_key,v.revision FROM documents d JOIN projects p ON p.id=d.project_id AND p.organization_id=? JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=? AND d.deleted_at IS NULL").bind(organizationId,documentId).first();
const current=(db,documentId)=>db.prepare("SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(documentId).first();
const hydrate=async(db,version)=>{const [types,pages,meta,assets,legends,entries,audit]=await Promise.all([db.prepare("SELECT * FROM drawing_document_classifications WHERE intake_version_id=? ORDER BY classification_type").bind(version.id).all(),db.prepare("SELECT * FROM drawing_pages WHERE intake_version_id=? ORDER BY page_number").bind(version.id).all(),db.prepare("SELECT * FROM drawing_metadata WHERE intake_version_id=?").bind(version.id).first(),db.prepare("SELECT * FROM drawing_assets WHERE intake_version_id=? ORDER BY page_id,asset_type").bind(version.id).all(),db.prepare("SELECT * FROM drawing_legends WHERE intake_version_id=? ORDER BY page_id").bind(version.id).all(),db.prepare("SELECT e.* FROM drawing_legend_entries e JOIN drawing_legends l ON l.id=e.legend_id WHERE l.intake_version_id=? ORDER BY l.page_id,e.sequence").bind(version.id).all(),db.prepare("SELECT * FROM drawing_intake_audit_events WHERE intake_version_id=? ORDER BY created_at DESC").bind(version.id).all()]);return{version:{...version,summary:parse(version.summary,{})},documentClassifications:types.results||[],pages:(pages.results||[]).map(r=>({...r,classifications:parse(r.classifications,[])})),metadata:meta,assets:(assets.results||[]).map(r=>({...r,bounding_box:parse(r.bounding_box)})),legends:(legends.results||[]).map(l=>({...l,entries:(entries.results||[]).filter(e=>e.legend_id===l.id)})),audit:(audit.results||[]).map(r=>({...r,previous_value:parse(r.previous_value),new_value:parse(r.new_value)}))};};
// A D1Result the runtime did not produce cannot be assumed successful.
const isSuccessResult=(r)=>Boolean(r)&&r.success===true;
// Table of a prepared statement, recovered for diagnostics only. Never used to
// decide success -- only to say which logical write failed.
const statementTable=(statement)=>{const sql=statement?.sql??"";const m=/INSERT\s+INTO\s+([A-Za-z_]+)/i.exec(sql);return m?m[1]:"unknown";};

/**
 * Assert that every statement in a batch actually succeeded.
 *
 * D1's documented contract is that batch() executes as a transaction and that each
 * entry of the returned array is a D1Result carrying `success`. In practice a
 * runtime may instead REJECT on a failed statement. Relying on exception
 * semantics alone is what let a failed child write be followed by a Completed
 * status and an HTTP 201: the non-throwing shape resolved normally, the code
 * ignored the results, and the failure was invisible.
 *
 * So BOTH shapes are treated as failure. A missing result, a result without an
 * explicit `success: true`, or a populated error all fail closed.
 *
 * Diagnostics carry the statement index, the target table and the driver error
 * code/message. Bound values are never included: drawing text is project content.
 */
const assertBatch=async(pending,label,intakeId,batch=[])=>{
  // A REJECTING batch is the other half of the same defect. It has to be
  // converted into the canonical persistence error too: if it is allowed to
  // escape raw, the caller reports it as an extraction failure (422) and never
  // reaches the handler branch that marks the intake Failed, leaving a dead
  // intake stranded in Processing.
  let results;
  try{results=await pending;}
  catch(error){throw drawingPersistenceError({label,table:labelTable(batch),errorCode:error?.code??error?.cause?.code??null,errorMessage:typeof error?.message==="string"?error.message:null,reason:"batch rejected before all statements were applied",intakeId});}
  if(!Array.isArray(results))throw drawingPersistenceError({label,reason:"batch did not return a result array",intakeId});
  for(let i=0;i<results.length;i++){const r=results[i];
    if(isSuccessResult(r))continue;
    const errorCode=r?.error?.code??(typeof r?.error==="string"?r.error:null)??null;
    const errorMessage=typeof r?.error?.message==="string"?r.error.message:null;
    throw drawingPersistenceError({label,index:i,table:statementTable(batch[i]),errorCode,errorMessage,reason:r?.success===false?"statement reported failure":"result did not assert success",intakeId});}
  return results;};

// The table of the first statement in a rejected batch, for diagnostics only.
const labelTable=(batch)=>{for(const statement of batch??[]){const table=statementTable(statement);if(table!=="unknown")return table;}return"unknown";};

/**
 * Verify that the children extraction said it produced are actually persisted,
 * and that the intake row is bound to exactly the document/version we claimed.
 *
 * This is the last gate before Completed. Batch success is necessary but not
 * sufficient: a runtime could report success while writing nothing, and a
 * `changes`-style row count is not proof that the right rows landed. So the
 * canonical tables are queried directly.
 *
 * An extraction that produced no children is only acceptable when it genuinely
 * produced none. Extraction yielding pages, assets or search entries REQUIRES a
 * matching persisted count; a mismatch fails closed rather than reporting a
 * complete intake that downstream sizing would trust.
 */
const verifyPersistedChildren=async(db,{intakeId,projectId,documentId,documentVersionId,result})=>{
  const parent=await db.prepare("SELECT id,project_id,document_id,document_version_id,status FROM drawing_intake_versions WHERE id=?").bind(intakeId).first();
  if(!parent)throw drawingPersistenceError({label:"parent intake",reason:"parent intake row is missing after persistence",intakeId});
  for(const[label,actual,expected]of[["project_id",parent.project_id,projectId],["document_id",parent.document_id,documentId],["document_version_id",parent.document_version_id,documentVersionId]]){
    if(actual!==expected)throw drawingPersistenceError({label,reason:`intake is bound to the wrong ${label}`,intakeId});}
  const expectedPages=(result.pages||[]).length,expectedAssets=(result.assets||[]).length,expectedSearch=(result.search||[]).length,expectedLegends=(result.legends||[]).length;
  const count=async(sql)=>{const row=await db.prepare(sql).bind(intakeId).first();return Number(row?.count??row?.c??0);};
  const actualPages=await count("SELECT count(*) AS count FROM drawing_pages WHERE intake_version_id=?"),
    actualAssets=await count("SELECT count(*) AS count FROM drawing_assets WHERE intake_version_id=?"),
    actualSearch=await count("SELECT count(*) AS count FROM drawing_search_entries WHERE intake_version_id=?"),
    actualLegends=await count("SELECT count(*) AS count FROM drawing_legends WHERE intake_version_id=?");
  for(const[label,expected,actual]of[["drawing_pages",expectedPages,actualPages],["drawing_assets",expectedAssets,actualAssets],["drawing_search_entries",expectedSearch,actualSearch],["drawing_legends",expectedLegends,actualLegends]]){
    if(expected>0&&actual<=0)throw drawingPersistenceError({label,reason:`extraction produced ${expected} ${label} rows but none were persisted`,intakeId});
    if(expected!==actual)throw drawingPersistenceError({label,reason:`expected ${expected} ${label} rows, persisted ${actual}`,intakeId});}
  return{pages:actualPages,assets:actualAssets,searchEntries:actualSearch,legends:actualLegends};};

/**
 * A canonical, distinguishable persistence failure.
 *
 * Carries a stable code so the failure is recognisable as "persistence did not
 * complete" rather than an extraction or storage problem, and so the caller can
 * mark the intake Failed instead of leaving it Processing forever.
 */
const drawingPersistenceError=({label,index,table,errorCode,errorMessage,reason,intakeId})=>{
  const error=new Error(`DRAWING_INTAKE_PERSISTENCE_FAILED: ${reason} (${label}${Number.isInteger(index)?` #${index}`:""}${table&&table!=="unknown"?` -> ${table}`:""}${errorCode?` [${errorCode}]`:""})`);
  error.code="DRAWING_INTAKE_PERSISTENCE_FAILED";
  error.intake_version_id=intakeId;
  error.persistence={label,index:Number.isInteger(index)?index:null,table:table??null,driver_code:errorCode??null,driver_message:errorMessage??null,reason};
  return error;};

/**
 * Mark an intake Failed after a persistence failure.
 *
 * The parent row is written in its own batch before the children, so a child
 * failure leaves a real row behind. Leaving it 'Processing' misreports a dead
 * intake as still running, so the terminal failure state is recorded here. A
 * failure to record the failure must not mask the original error, and must never
 * be reported as success.
 */
const markIntakeFailed=async(db,intakeId,detail)=>{
  try{await db.prepare("UPDATE drawing_intake_versions SET status='Failed' WHERE id=?").bind(intakeId).run();}
  catch{/* recording the failure is best-effort; the thrown error is the contract */}};

const persist=async(env,document,result,user,reason)=>{const previous=await current(env.DB,document.id),versionNumber=Number(previous?.version_number||0)+1,inputFingerprint=await hash({sha256:document.sha256,parser:DRAWING_INTAKE_VERSION}),outputFingerprint=await hash(result);if(previous?.input_fingerprint===inputFingerprint&&previous?.output_fingerprint===outputFingerprint)return{...(await hydrate(env.DB,previous)),idempotent:true};const intakeId=id("drawingIntake"),pageIds=new Map(result.pages.map(p=>[p.pageNumber,id("drawingPage")]));await env.DB.batch([env.DB.prepare("INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(intakeId,document.project_id,document.id,document.version_id,versionNumber,inputFingerprint,outputFingerprint,result.parserVersion,"Processing",JSON.stringify(result.summary),user.id),...(previous?[env.DB.prepare("UPDATE drawing_intake_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?").bind(previous.id)]:[])]);
 const statements=[];for(const c of result.documentClassifications)statements.push(env.DB.prepare("INSERT INTO drawing_document_classifications VALUES (?,?,?,?,?,'Needs Review',CURRENT_TIMESTAMP)").bind(id("drawingClass"),intakeId,c.type,c.confidence,c.method));for(const p of result.pages)statements.push(env.DB.prepare("INSERT INTO drawing_pages (id,intake_version_id,page_number,width,height,coordinate_mode,classifications,text_count,source_review_status,review_status,extraction_method,created_at,rotation) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,0)").bind(pageIds.get(p.pageNumber),intakeId,p.pageNumber,p.width,p.height,p.coordinateMode,JSON.stringify(p.classifications),p.textCount,'Needs Review',p.reviewStatus,p.extractionMethod));statements.push(env.DB.prepare("INSERT INTO drawing_metadata VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Needs Review',CURRENT_TIMESTAMP)").bind(id("drawingMeta"),intakeId,result.metadata.drawingNumber,result.metadata.revision,result.metadata.sheetName,result.metadata.discipline,result.metadata.scale,result.metadata.issueDate,result.metadata.consultant,result.metadata.contractor,result.metadata.client,result.metadata.projectName,result.metadata.sheetSize,75,"Explicit title-block labels only"));for(const a of result.assets)statements.push(env.DB.prepare("INSERT INTO drawing_assets VALUES (?,?,?,?,?,?,?,?,?,'Needs Review',CURRENT_TIMESTAMP)").bind(id("drawingAsset"),intakeId,pageIds.get(a.pageNumber),a.assetType,a.text||null,a.boundingBox?JSON.stringify(a.boundingBox):null,a.coordinatesAvailable?1:0,a.detectionConfidence,a.detectionMethod));for(const l of result.legends){const legendId=id("drawingLegend");statements.push(env.DB.prepare("INSERT INTO drawing_legends VALUES (?,?,?,?,?,?, 'Needs Review',CURRENT_TIMESTAMP)").bind(legendId,intakeId,pageIds.get(l.pageNumber),l.legendVersion,l.confidence,l.detectionMethod));for(const e of l.entries)statements.push(env.DB.prepare("INSERT INTO drawing_legend_entries VALUES (?,?,?,?,?,?,?,'Needs Review',CURRENT_TIMESTAMP)").bind(id("legendEntry"),legendId,e.sequence,e.entryType,e.label,e.description,e.confidence));}for(const s of result.search)statements.push(env.DB.prepare("INSERT INTO drawing_search_entries VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(id("drawingSearch"),intakeId,pageIds.get(s.pageNumber),s.pageNumber,s.text,s.drawingNumber,s.sheetName,JSON.stringify(s.tags)));for(let i=0;i<statements.length;i+=75){const chunk=statements.slice(i,i+75);await assertBatch(env.DB.batch(chunk),`children[${i}-${i+chunk.length-1}]`,intakeId,chunk);}await verifyPersistedChildren(env.DB,{intakeId,projectId:document.project_id,documentId:document.id,documentVersionId:document.version_id,result});await env.DB.batch([env.DB.prepare("UPDATE drawing_intake_versions SET status='Completed' WHERE id=?").bind(intakeId),env.DB.prepare("INSERT INTO drawing_intake_audit_events (id,project_id,document_id,intake_version_id,action,previous_value,new_value,reason,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(id("drawingAudit"),document.project_id,document.id,intakeId,"Drawing Intake Completed",JSON.stringify(previous?{id:previous.id,version:previous.version_number}:null),JSON.stringify({version:versionNumber,summary:result.summary,classifications:result.documentClassifications}),reason,user.id)]);return{...(await hydrate(env.DB,await current(env.DB,document.id))),idempotent:false};};

export const handleDrawingIntakeApi=async(request,env)=>{const url=new URL(request.url),match=url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-intake(?:\/(start|rerun|search|history))?$/);if(!match)return null;if(!env.DB||!env.FILES)return json({error:{code:"DRAWING_INTAKE_UNAVAILABLE",message:"Drawing storage is unavailable."}},503);const resolved=await resolveApplicationContext(request,env);if(resolved.error)return json({error:resolved.error},resolved.error.status);const user=applicationActor(resolved.context);const document=await visibleDocument(env.DB,decodeURIComponent(match[1]),user.organizationId);if(!document)return json({error:{code:"DRAWING_NOT_FOUND",message:"Drawing document not found."}},404);const authority=await resolveProjectAuthority(env.DB,{projectId:document.project_id,actor:user});if(!authority)return json({error:{code:"DRAWING_INTAKE_NOT_AUTHORIZED",message:"The configured actor has no authority on this project, so drawing intake cannot be read or run."}},403);const op=match[2];if(!op&&request.method==="GET"){const version=await current(env.DB,document.id);return version?json(await hydrate(env.DB,version)):json({error:{code:"DRAWING_INTAKE_REQUIRED",message:"Start drawing intake first."}},409);}if(op==="history"&&request.method==="GET"){const rows=await env.DB.prepare("SELECT id,version_number,status,summary,review_status,superseded_at,created_by,created_at FROM drawing_intake_versions WHERE document_id=? ORDER BY version_number DESC").bind(document.id).all();return json({versions:(rows.results||[]).map(r=>({...r,summary:parse(r.summary,{})}))});}if(op==="search"&&request.method==="GET"){const version=await current(env.DB,document.id);if(!version)return json({results:[]});const q=String(url.searchParams.get("q")||"").trim(),page=Number(url.searchParams.get("page")||0),term=`%${q}%`;const rows=await env.DB.prepare("SELECT DISTINCT s.page_number,p.classifications,m.drawing_number,m.sheet_name,s.text_content,s.tags FROM drawing_search_entries s JOIN drawing_pages p ON p.id=s.page_id LEFT JOIN drawing_metadata m ON m.intake_version_id=s.intake_version_id LEFT JOIN drawing_legends l ON l.page_id=s.page_id LEFT JOIN drawing_legend_entries e ON e.legend_id=l.id WHERE s.intake_version_id=? AND (?=0 OR s.page_number=?) AND (?='' OR s.text_content LIKE ? OR s.drawing_number LIKE ? OR s.sheet_name LIKE ? OR s.tags LIKE ? OR e.label LIKE ? OR e.description LIKE ?) ORDER BY s.page_number LIMIT 250").bind(version.id,page,page,q,term,term,term,term,term,term).all();return json({query:q,page:page||null,results:(rows.results||[]).map(r=>({...r,classifications:parse(r.classifications,[]),tags:parse(r.tags,[])}))});}if(["start","rerun"].includes(op||"")&&request.method==="POST"){if(document.extension!=="pdf")return json({error:{code:"DRAWING_PDF_REQUIRED",message:"Drawing Intake currently requires PDF source."}},422);const body=await request.json().catch(()=>({})),object=await env.FILES.get(document.object_key);if(!object)return json({error:{code:"STORAGE_OBJECT_MISSING",message:"Stored drawing source is missing."}},409);try{const result=await extractDrawingStructure(new Uint8Array(await object.arrayBuffer()),{fileName:document.original_filename,revision:document.revision});return json(await persist(env,document,result,user,String(body.reason||"Drawing structural intake")),201);}catch(error){
      // A persistence failure is NOT an extraction failure. Children were lost,
      // so it is reported distinctly, the intake is moved to a truthful Failed
      // state instead of being left Processing forever, and it is never 201.
      if(error?.code==="DRAWING_INTAKE_PERSISTENCE_FAILED"){
        await markIntakeFailed(env.DB,error.intake_version_id,error.persistence);
        return json({error:{code:"DRAWING_INTAKE_PERSISTENCE_FAILED",message:"Drawing structure was extracted but could not be fully persisted, so this intake was not completed.",intake_version_id:error.intake_version_id,persistence:error.persistence,suggestedAction:"Retry drawing intake. If the failure persists, storage needs attention before this drawing can be treated as ingested."}},500);}
      return json({error:{code:"DRAWING_INTAKE_FAILED",message:error instanceof Error?error.message:"Drawing intake failed.",suggestedAction:"Verify that the PDF is readable and retry."}},422);}}return json({error:{code:"DRAWING_INTAKE_API_NOT_FOUND",message:"Drawing Intake operation not found."}},404);};
