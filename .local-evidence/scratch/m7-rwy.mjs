import { DatabaseSync } from "node:sqlite";
import { loadUnderstandingReviewRows } from "../../worker/estimator-understanding-review-api.mjs";
const P="project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const w={prepare(s){const st=db.prepare(s);return{bind(...p){return{all:async()=>({results:st.all(...p)}),first:async()=>st.get(...p)??null};}};}};
const rows=await loadUnderstandingReviewRows(w,P);
const prof=(await w.prepare("SELECT boq_item_id id, readiness_status rs FROM requirement_profile_versions v JOIN boq_items b ON b.id=v.boq_item_id WHERE b.project_id=? AND v.superseded_at IS NULL").bind(P).all()).results;
const byId=new Map(rows.map(r=>[r.boqItemId,r]));
let rwy=0,valid=0,stale=0;
for(const p of prof){
  if(p.rs!=="Ready with Warnings") continue; rwy++;
  const r=byId.get(p.id);
  const ok=Boolean(r&&r.reviewStatus==="APPROVED"&&r.reviewVersionId&&r.interpretationId&&r.reviewInterpretationId===r.interpretationId&&r.reviewInputFingerprint===r.effective?.currentInputFingerprint);
  if(ok) valid++; else stale++;
}
console.log(`Ready-with-Warnings total=${rwy}  VALID approved understanding=${valid}  STALE/unapproved understanding=${stale}`);
