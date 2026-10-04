import { DatabaseSync } from "node:sqlite";
import { open, stat } from "node:fs/promises";
import { createSpecificationJob, processSpecificationJob } from "../worker/specification-extraction-background.mjs";

class Statement { constructor(db,sql,values=[]){this.db=db;this.sql=sql;this.values=values;} bind(...values){return new Statement(this.db,this.sql,values);} run(){const r=this.db.prepare(this.sql).run(...this.values);return{meta:{changes:Number(r.changes||0),last_row_id:r.lastInsertRowid}};} first(){return this.db.prepare(this.sql).get(...this.values)||null;} all(){return{results:this.db.prepare(this.sql).all(...this.values)};} }
class D1 { constructor(path){this.sqlite=new DatabaseSync(path);} prepare(sql){return new Statement(this.sqlite,sql);} batch(ss){this.sqlite.exec("BEGIN IMMEDIATE");try{const o=ss.map(s=>s.run());this.sqlite.exec("COMMIT");return o;}catch(e){this.sqlite.exec("ROLLBACK");throw e;}} close(){this.sqlite.close();} }

const [databasePath,pdfPath,documentId,action="process"]=process.argv.slice(2); if(!databasePath||!pdfPath||!documentId)throw new Error("database, pdf and document id required");
const DB=new D1(databasePath), fileSize=(await stat(pdfPath)).size;
const env={DB,FILES:{head:async()=>({size:fileSize}),get:async(_key,options={})=>{const offset=Number(options.range?.offset||0),length=Number(options.range?.length||fileSize);const handle=await open(pdfPath,"r");try{const buffer=Buffer.alloc(Math.min(length,fileSize-offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);const bytes=buffer.subarray(0,bytesRead);return{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}finally{await handle.close();}}},SPECIFICATION_QUEUE:{send:async()=>{}}};
try{
  let job=null;
  if(action==="create"){const result=await createSpecificationJob(env,{documentId,userId:"local-development-user",reason:"Hotel representative end-to-end completion",chunkSize:50});job=result.job;}
  else { job=DB.prepare("SELECT * FROM specification_extraction_jobs WHERE document_id=? AND status NOT IN ('Cancelled') ORDER BY created_at DESC LIMIT 1").bind(documentId).first(); if(!job){const result=await createSpecificationJob(env,{documentId,userId:"local-development-user",reason:"Hotel representative end-to-end completion",chunkSize:50});job=result.job;} }
  if(action==="process") await processSpecificationJob(env,{jobId:job.id});
  job=DB.prepare("SELECT id,status,total_pages,processed_pages,current_page,current_chunk,completed_chunks,remaining_chunks FROM specification_extraction_jobs WHERE id=?").bind(job.id).first(); console.log(JSON.stringify(job));
}finally{DB.close();}
