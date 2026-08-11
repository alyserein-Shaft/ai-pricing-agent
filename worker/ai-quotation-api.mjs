import { authenticateLibraryActor } from "./library-auth.mjs";
import { createConfiguredCloudflareStructuredProvider } from "./boq-understanding-provider.mjs";
import { loadPresalesWorkflowContext } from "./presales-workflow-api.mjs";
import { AI_QUOTATION_ENGINE_VERSION, AI_QUOTATION_PROMPT_VERSION, AI_QUOTATION_RESPONSE_SCHEMA, AI_QUOTATION_SCHEMA_VERSION, aiQuotationAdvisoryFreshness, aiQuotationConfigFingerprint, aiQuotationInputFingerprint, buildAiQuotationInput, generateAiQuotationAdvisory } from "../app/domain/ai-quotation-engineer.mjs";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store"}});
const access=async(db,projectId,userId)=>db.prepare("SELECT p.*,dp.client,dp.currency,dp.manual_status,COALESCE(pm.role,CASE WHEN p.owner_user_id=? THEN 'Project Manager' END) role FROM projects p LEFT JOIN project_dashboard_profiles dp ON dp.project_id=p.id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? AND pm.status='Active' WHERE p.id=? AND p.organization_id IS NOT NULL AND (p.owner_user_id=? OR pm.id IS NOT NULL)").bind(userId,userId,projectId,userId).first();
const versions={engineVersion:AI_QUOTATION_ENGINE_VERSION,promptVersion:AI_QUOTATION_PROMPT_VERSION,schemaVersion:AI_QUOTATION_SCHEMA_VERSION};
const hydrate=(row,inputFingerprint,configFingerprint=null)=>{if(!row)return null;const freshness=aiQuotationAdvisoryFreshness(row,{inputFingerprint,configFingerprint,versions});return {...row,advisory:JSON.parse(row.advisory_json||"{}"),validation:JSON.parse(row.validation_json||"{}"),freshness,stale:freshness!=="CURRENT",reusedHistorical:freshness==="CURRENT"&&Boolean(row.superseded_at)};};

export async function handleAiQuotationApi(request,env){
  const match=new URL(request.url).pathname.match(/^\/api\/projects\/([^/]+)\/ai-quotation(?:\/run)?$/);if(!match)return null;
  if(!env.DB)return json({error:{code:"AI_QUOTATION_STORAGE_UNAVAILABLE",message:"AI quotation advisory storage is unavailable."}},503);
  const auth=await authenticateLibraryActor(request,env);if(auth.error)return json({error:auth.error},auth.error.status);
  const actor=auth.actor,project=await access(env.DB,decodeURIComponent(match[1]),actor.id);if(!project)return json({error:{code:"PROJECT_NOT_FOUND",message:"Project was not found or is not available to this account."}},404);
  const context=await loadPresalesWorkflowContext(env.DB,project),input=buildAiQuotationInput({evidenceManifest:context.evidenceManifest,evidenceFingerprint:context.sourceFingerprint,workflow:context.workflow,quotation:context.currentQuotation}),inputFingerprint=aiQuotationInputFingerprint(input);
  if(request.method==="GET"){
    const provider=createConfiguredCloudflareStructuredProvider(env,{schema:AI_QUOTATION_RESPONSE_SCHEMA,maxTokens:3000}),configFingerprint=provider?aiQuotationConfigFingerprint(provider.metadata):null;
    const exact=configFingerprint?await env.DB.prepare("SELECT * FROM ai_quotation_advisories WHERE project_id=? AND input_fingerprint=? AND config_fingerprint=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(project.id,inputFingerprint,configFingerprint).first():await env.DB.prepare("SELECT * FROM ai_quotation_advisories WHERE project_id=? AND input_fingerprint=? AND engine_version=? AND prompt_version=? AND schema_version=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(project.id,inputFingerprint,AI_QUOTATION_ENGINE_VERSION,AI_QUOTATION_PROMPT_VERSION,AI_QUOTATION_SCHEMA_VERSION).first();
    const latest=exact||await env.DB.prepare("SELECT * FROM ai_quotation_advisories WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(project.id).first();
    return json({advisory:hydrate(latest,inputFingerprint,configFingerprint),evidenceFingerprint:context.sourceFingerprint,inputFingerprint});
  }
  if(request.method!=="POST")return json({error:{code:"METHOD_NOT_ALLOWED",message:"Use GET or POST."}},405);
  if(!Number(context.workflow?.facts?.boqItems||0)||!Number(context.workflow?.facts?.pricedItems||0))return json({error:{code:"AI_QUOTATION_EVIDENCE_REQUIRED",message:"AI advisory becomes available after a reviewed BOQ and governed pricing evidence are available.",blockers:context.workflow?.blockers||[]}},409);
  const provider=createConfiguredCloudflareStructuredProvider(env,{schema:AI_QUOTATION_RESPONSE_SCHEMA,maxTokens:3000});
  if(!provider)return json({error:{code:"AI_UNAVAILABLE",message:"No AI quotation provider is configured. Governed quotation workflow remains unchanged."}},503);
  const configFingerprint=aiQuotationConfigFingerprint(provider.metadata),existing=await env.DB.prepare("SELECT * FROM ai_quotation_advisories WHERE project_id=? AND input_fingerprint=? AND config_fingerprint=?").bind(project.id,inputFingerprint,configFingerprint).first();
  if(existing)return json({advisory:hydrate(existing,inputFingerprint,configFingerprint),idempotent:true,reusedHistorical:Boolean(existing.superseded_at)});
  const result=await generateAiQuotationAdvisory({input,provider});
  if(result.status!=="COMPLETED")return json({error:result.error,status:result.status},422);
  const id=`aiQuotation_${crypto.randomUUID()}`,createdAt=new Date().toISOString();
  await env.DB.batch([env.DB.prepare("UPDATE ai_quotation_advisories SET superseded_at=? WHERE project_id=? AND superseded_at IS NULL").bind(createdAt,project.id),env.DB.prepare("INSERT INTO ai_quotation_advisories (id,project_id,quotation_revision_id,evidence_fingerprint,input_fingerprint,config_fingerprint,provider,model,model_version,engine_version,prompt_version,schema_version,status,advisory_json,validation_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,project.id,context.currentQuotation?.id||null,context.sourceFingerprint,inputFingerprint,configFingerprint,provider.metadata.provider,provider.metadata.model,provider.metadata.modelVersion,AI_QUOTATION_ENGINE_VERSION,AI_QUOTATION_PROMPT_VERSION,AI_QUOTATION_SCHEMA_VERSION,"Completed",JSON.stringify(result.advisory),JSON.stringify({strictSchema:true,authorityFields:false}),actor.id,createdAt)]);
  return json({advisory:{id,status:"Completed",advisory:result.advisory,evidence_fingerprint:context.sourceFingerprint,input_fingerprint:inputFingerprint,config_fingerprint:configFingerprint,provider:provider.metadata.provider,model:provider.metadata.model,created_at:createdAt,freshness:"CURRENT",stale:false,reusedHistorical:false},idempotent:false,reusedHistorical:false},201);
}
