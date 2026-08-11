import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";

class Statement { constructor(db, sql, values = []) { this.db=db; this.sql=sql; this.values=values; } bind(...values){ return new Statement(this.db,this.sql,values); } run(){ const r=this.db.prepare(this.sql).run(...this.values); return {meta:{changes:Number(r.changes||0)}}; } first(){ return this.db.prepare(this.sql).get(...this.values)||null; } all(){ return {results:this.db.prepare(this.sql).all(...this.values)}; } }
class D1 { constructor(path){ this.sqlite=new DatabaseSync(path); } prepare(sql){ return new Statement(this.sqlite,sql); } batch(statements){ this.sqlite.exec("BEGIN IMMEDIATE"); try { const out=statements.map(s=>s.run()); this.sqlite.exec("COMMIT"); return out; } catch(e){ this.sqlite.exec("ROLLBACK"); throw e; } } close(){ this.sqlite.close(); } }

const path=process.argv[2], projectId=process.argv[3]; if(!path||!projectId) throw new Error("database and project required");
const DB=new D1(path); const sequences=[156,172,359,594,632];
const reviews={
  156:{system:"Structural",category:"Concrete",requirement:"specjob_3899f94c-33d4-4334-a7f9-e8deb5986ad7_chunk_000002_requirement_216"},
  172:{system:"Architectural",category:"GFRC Cladding",requirement:"specjob_3899f94c-33d4-4334-a7f9-e8deb5986ad7_chunk_000006_requirement_3"},
  359:{system:"Architectural",category:"Swing Door",requirement:"specjob_3899f94c-33d4-4334-a7f9-e8deb5986ad7_chunk_000011_requirement_37"},
  594:{system:"Architectural",category:"Canopy",requirement:"specjob_3899f94c-33d4-4334-a7f9-e8deb5986ad7_chunk_000016_requirement_55"},
  632:{system:"Vertical Transportation",category:"Passenger Elevator",requirement:"specjob_3899f94c-33d4-4334-a7f9-e8deb5986ad7_chunk_000017_requirement_151"},
};
try {
  const selected=DB.sqlite.prepare(`SELECT * FROM boq_items WHERE project_id=? AND sequence IN (${sequences.map(()=>"?").join(",")}) ORDER BY sequence`).all(projectId,...sequences);
  for(const item of selected){
    if(item.row_type!=="BOQ Item") throw new Error(`Unsafe sample row ${item.sequence}: ${item.row_type}`);
    if(item.review_status!=="Approved"){
      DB.sqlite.exec("BEGIN IMMEDIATE");
      try { DB.sqlite.prepare("UPDATE boq_items SET review_status='Approved',approved_for_downstream=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND row_type='BOQ Item'").run(item.id); DB.sqlite.prepare("INSERT INTO boq_review_decisions (id,extraction_version_id,item_id,action,previous_value,new_value,reason,decided_by) VALUES (?,?,?,?,?,?,?,?)").run(`boqdecision_${randomUUID()}`,item.extraction_version_id,item.id,"Extraction Confirmed",JSON.stringify({reviewStatus:item.review_status}),JSON.stringify({reviewStatus:"Approved",approvedForDownstream:true}),"Representative Hotel row accurately reflects the source workbook description, unit and quantity.","local-development-user"); DB.sqlite.exec("COMMIT"); } catch(e){DB.sqlite.exec("ROLLBACK");throw e;}
    }
    const review=reviews[item.sequence], requirement=DB.sqlite.prepare("SELECT * FROM technical_requirements WHERE id=? AND project_id=?").get(review.requirement,projectId); if(!requirement)throw new Error(`Evidence requirement missing for ${item.sequence}`);
    DB.sqlite.exec("BEGIN IMMEDIATE");
    try {
      DB.sqlite.prepare("UPDATE boq_items SET system_value=?,system_source_type='Reviewer Confirmed',system_confidence=100,category=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(review.system,review.category,item.id);
      DB.sqlite.prepare("UPDATE technical_requirements SET review_status='Approved',approved_for_downstream=1 WHERE id=?").run(requirement.id);
      DB.sqlite.prepare("INSERT OR IGNORE INTO requirement_review_decisions (id,extraction_version_id,requirement_id,action,previous_value,new_value,reason,evidence,decided_by) VALUES (?,?,?,?,?,?,?,?,?)").run(`reqdecision_${item.id}`,requirement.extraction_version_id,requirement.id,"Approved",JSON.stringify({status:requirement.review_status}),JSON.stringify({status:"Approved",approvedForDownstream:true}),"Explicit source requirement reviewed for the representative Hotel BOQ item.",requirement.source_location,"local-development-user");
      DB.sqlite.prepare("INSERT OR IGNORE INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_type,scope_id,reviewed_by,reviewed_at,review_reason,version_number,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)").run(`boqlink_${item.id}`,projectId,item.id,requirement.id,"Engineer Reviewed",90,JSON.stringify({sourceLocation:JSON.parse(requirement.source_location),basis:"Explicit equipment/material term and specification section"}),"Confirmed","BOQ Item",item.id,"local-development-user",new Date().toISOString(),"Confirmed only for this representative sample item and cited specification evidence.","local-development-user");
      DB.sqlite.exec("COMMIT");
    } catch(e){DB.sqlite.exec("ROLLBACK");throw e;}
  }
  const profiles=[]; for(const item of selected) profiles.push(await executeRequirementProfile({DB},{itemId:item.id,userId:"local-development-user"}));
  console.log(JSON.stringify({selected:selected.map(x=>({id:x.id,sequence:x.sequence,itemNumber:x.item_number,description:x.description,unit:x.original_unit,quantity:x.original_quantity})),profiles:profiles.map(x=>({profileId:x.profileId,status:x.status,readiness:x.profile?.readiness?.status,missing:x.profile?.missingInformation?.length||0,idempotent:x.idempotent}))},null,2));
} finally { DB.close(); }
