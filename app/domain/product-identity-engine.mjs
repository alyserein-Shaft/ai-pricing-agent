export const PRODUCT_IDENTITY_RULESET_VERSION="product-identity-v1.0";
export const PRODUCT_IDENTITY_RULES=[
 {id:"PI-010",priority:10,decision:"Isolate observations without an explicit manufacturer by source document"},
 {id:"PI-020",priority:20,decision:"Group observations only when manufacturer and complete product code are exact"},
 {id:"PI-030",priority:30,decision:"Preserve punctuation, electrical, regional, colour, package and revision tokens"},
 {id:"PI-040",priority:40,decision:"Attach explicit aliases without replacing the official code"},
 {id:"PI-050",priority:50,decision:"Attach only explicit relationships and historical catalogue prices"},
];
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const codeNorm=v=>clean(v).toUpperCase();
const textNorm=v=>clean(v).toLowerCase();
const parse=(v,f={})=>{try{return typeof v==="string"?JSON.parse(v||""):v??f;}catch{return f;}};
const known=v=>{const x=clean(v);return x&&!/^unknown$/i.test(x)?x:null;};
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(typeof value==="string"?value:JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,"0")).join("");
const best=(rows,key)=>rows.map(row=>({value:known(parse(row.attributes,{} )[key]),confidence:Number(row.confidence||0)})).filter(x=>x.value).sort((a,b)=>b.confidence-a.confidence)[0]?.value||null;

export async function productIdentityRulesetFingerprint(){return digest({version:PRODUCT_IDENTITY_RULESET_VERSION,rules:PRODUCT_IDENTITY_RULES});}

export async function buildProductIdentityAnalysis({facts=[]}={}){
 const files=new Map(),byObservation=new Map();
 for(const fact of facts){files.set(fact.knowledge_file_id,{id:fact.knowledge_file_id,name:fact.file_name,type:fact.detected_type});const attributes=parse(fact.attributes,{}),key=attributes.observationKey||`${fact.knowledge_file_id}:${fact.id}`;if(!byObservation.has(key))byObservation.set(key,[]);byObservation.get(key).push({...fact,attributes,sourceLocation:parse(fact.source_location,{})});}
 const documentManufacturers=new Map();for(const fact of facts.filter(row=>row.fact_type==="Manufacturer"&&!parse(row.attributes,{}).observationKey)){const current=documentManufacturers.get(fact.knowledge_file_id)||new Set();current.add(clean(fact.original_value));documentManufacturers.set(fact.knowledge_file_id,current);}
 const groups=new Map();
 for(const fact of facts.filter(row=>row.fact_type==="Part Number")){
  const attributes=parse(fact.attributes,{}),code=clean(fact.original_value);if(!code)continue;const observationKey=attributes.observationKey||`${fact.knowledge_file_id}:${fact.id}`;let manufacturer=known(attributes.manufacturer);const fileManufacturers=[...(documentManufacturers.get(fact.knowledge_file_id)||[])];if(!manufacturer&&fileManufacturers.length===1)manufacturer=fileManufacturers[0];const identityKey=manufacturer?`${textNorm(manufacturer)}|${codeNorm(code)}`:`source:${fact.knowledge_file_id}|${codeNorm(code)}`;if(!groups.has(identityKey))groups.set(identityKey,[]);groups.get(identityKey).push({...fact,attributes,sourceLocation:parse(fact.source_location,{}),observationKey,manufacturer});
 }
 const identities=[];
 for(const [identityKey,partFacts] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const related=partFacts.flatMap(part=>(byObservation.get(part.observationKey)||[]).map(fact=>({...fact,partFact:part})));const codes=[...new Set(partFacts.map(row=>clean(row.original_value)))],manufacturers=[...new Set(partFacts.map(row=>row.manufacturer).filter(Boolean))];const sourceIds=[...new Set(partFacts.map(row=>row.knowledge_file_id))];
  const officialProductCode=codes[0],manufacturer=manufacturers.length===1?manufacturers[0]:null;const description=best(partFacts,"description")||related.filter(f=>f.fact_type==="Product Description").sort((a,b)=>b.confidence-a.confidence)[0]?.original_value||null;const family=best(partFacts,"family")||null;
  const prices=related.filter(f=>f.fact_type==="Price"&&f.attributes.priceType==="Historical Catalogue Price"&&f.attributes.partNumber===officialProductCode).map(f=>({knowledgeFactId:f.id,amount:String(f.attributes.amount),currency:f.attributes.currency||"Unknown",region:f.attributes.region||null,effectiveDate:f.attributes.effectiveDate||null,validity:f.attributes.validity||null,priceType:"Historical Catalogue Price",discoveryStatus:"Discovery Only",costingEligible:false,sourceLocation:f.sourceLocation}));
  const relationships=related.filter(f=>f.fact_type==="Product Relationship"&&codeNorm(f.attributes.sourcePartNumber)===codeNorm(officialProductCode)).map(f=>({knowledgeFactId:f.id,type:f.attributes.relationship,targetCode:f.attributes.targetPartNumber,evidence:f.original_value,confidence:Number(f.confidence),reviewStatus:"Needs Review"}));
  const aliases=related.filter(f=>f.fact_type==="Alias"&&f.attributes.explicit===true).map(f=>({knowledgeFactId:f.id,alias:f.original_value,aliasType:f.attributes.aliasType||"Explicit Alias",confidence:Number(f.confidence),reviewStatus:"Needs Review"}));
  const observations=related.map(f=>({knowledgeFileId:f.knowledge_file_id,knowledgeFactId:f.id,observationKey:f.partFact.observationKey,observationType:f.fact_type,originalValue:f.original_value,normalizedValue:f.normalized_value,attributes:f.attributes,sourceLocation:f.sourceLocation,confidence:Number(f.confidence),observedDate:f.attributes.effectiveDate||null,region:f.attributes.region||null,sourceType:f.detected_type||null}));
  const conflictingCodes=codes.length>1,conflictingManufacturers=manufacturers.length>1,confidence=Math.min(98,70+(manufacturer?10:0)+15+Math.min(3,sourceIds.length-1)*1);const identityKeyFingerprint=await digest(identityKey),fingerprint=identityKeyFingerprint;
  identities.push({identityKey,identityKeyFingerprint,fingerprint,manufacturer,brand:best(partFacts,"brand"),family,series:best(partFacts,"series"),model:best(partFacts,"model")||officialProductCode,officialProductCode,normalizedProductCode:codeNorm(officialProductCode),description,category:best(partFacts,"category"),subCategory:best(partFacts,"subCategory"),system:best(partFacts,"system"),unit:best(partFacts,"unit"),lifecycleStatus:related.find(f=>f.fact_type==="Lifecycle")?.attributes?.status||"Unknown",confidence,reviewStatus:"Needs Review",blockers:[...(manufacturer?[]:["Manufacturer is not explicitly established for this observation set."]),...(conflictingCodes?["Product-code observations conflict."]:[]),...(conflictingManufacturers?["Manufacturer observations conflict."]:[])],observations,aliases,prices,relationships,sourceCount:sourceIds.length});
 }
 const inputFingerprint=await digest({ruleset:PRODUCT_IDENTITY_RULESET_VERSION,facts:facts.map(f=>[f.id,f.normalized_value,f.source_location]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))});return {rulesetVersion:PRODUCT_IDENTITY_RULESET_VERSION,inputFingerprint,observationCount:facts.length,identityCount:identities.length,identities};
}
