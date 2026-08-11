export const PRICING_LEARNING_ENGINE_VERSION="project-pricing-learning-v1.0";
export const PRICE_TYPES=["Manufacturer List Price","Supplier Price","Purchase Cost","Selling Price","Discount","Margin"];
export const LEARNING_STAGES=["Understand","Learn","Remember"];
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
export const normalize=v=>clean(v).toLowerCase().replace(/[^a-z0-9.+/-]+/g," ").trim();
const unique=rows=>[...new Map(rows.map(row=>[`${row.observationType}|${row.observationKey}|${row.evidenceDocumentVersionId||"none"}`,row])).values()];

export function journeyStage(documentType="",fileName=""){
 const value=`${documentType} ${fileName}`.toLowerCase();
 if(/final quotation|commercial offer|quotation/.test(value)&&!/supplier/.test(value))return "Final Quotation";
 if(/supplier quotation|supplier quote/.test(value))return "Supplier Quotations";
 if(/supplier rfq/.test(value))return "Supplier RFQs";
 if(/\brfq\b|request for quotation/.test(value))return "Client RFQ";
 if(/cost sheet|pricing workbook|internal cost/.test(value))return "Internal Cost Sheets";
 if(/technical review|compliance/.test(value))return "Engineering Decisions";
 if(/commercial review/.test(value))return "Commercial Decisions";
 if(/specification/.test(value))return "Specifications";
 if(/drawing|\.dwg|\.dxf/.test(value))return "Drawings";
 if(/\bboq\b|bill of quantities/.test(value))return "BOQ";
 return "Supporting Evidence";
}

export function classifyPriceObservation(record={}){
 const source=String(record.sourceType||record.documentType||"").toLowerCase(),label=String(record.label||record.field||"").toLowerCase();
 if(/list price/.test(label)||/price list|catalogue/.test(source))return "Manufacturer List Price";
 if(/supplier quotation|supplier quote/.test(source))return "Supplier Price";
 if(/purchase cost|net cost|material cost|internal cost/.test(label)||/cost sheet/.test(source))return "Purchase Cost";
 if(/selling price|unit rate|final quotation|commercial offer/.test(label)||/final quotation/.test(source))return "Selling Price";
 if(/discount/.test(label))return "Discount";
 if(/margin|markup|profit/.test(label))return "Margin";
 return null;
}

export function buildObservations({project,boqItems=[],selectedProducts=[],priceRecords=[],decisions=[],sources=[]}){
 const rows=[];
 for(const item of boqItems)rows.push({observationType:"BOQ Item",observationKey:item.id||normalize(`${item.itemNumber}:${item.description}`),boqItemId:item.id,quantity:item.quantity??null,unit:item.unit??null,originalValue:{itemNumber:item.itemNumber,description:item.description,system:item.system,category:item.category,quantity:item.quantity,unit:item.unit},normalizedValue:{description:normalize(item.description),system:normalize(item.system),category:normalize(item.category)},confidence:item.confidence??90,evidenceDocumentId:item.documentId,evidenceDocumentVersionId:item.documentVersionId,evidenceLocation:item.sourceLocation||{},evidenceQuality:item.evidenceQuality||"Project Source"});
 for(const product of selectedProducts)rows.push({observationType:"Product Selection",observationKey:product.id||normalize(`${product.partNumber}:${product.boqItemId}`),boqItemId:product.boqItemId,manufacturer:product.manufacturer||null,partNumber:product.partNumber||null,productFamily:product.productFamily||null,quantity:product.quantity??null,unit:product.unit??null,originalValue:product,normalizedValue:{manufacturer:normalize(product.manufacturer),partNumber:normalize(product.partNumber),productFamily:normalize(product.productFamily)},confidence:product.confidence??80,evidenceDocumentId:product.documentId,evidenceDocumentVersionId:product.documentVersionId,evidenceLocation:product.sourceLocation||{},evidenceQuality:product.evidenceQuality||"Quotation Observation"});
 for(const price of priceRecords){const type=classifyPriceObservation(price);if(!type)continue;rows.push({observationType:type,observationKey:price.id||normalize(`${price.partNumber}:${price.amount}:${price.sourceReference}`),boqItemId:price.boqItemId||null,manufacturer:price.manufacturer||null,partNumber:price.partNumber||null,supplier:price.supplier||null,currency:price.currency||null,amountMinor:Number.isFinite(price.amountMinor)?price.amountMinor:null,percentageBasisPoints:Number.isFinite(price.percentageBasisPoints)?price.percentageBasisPoints:null,quantity:price.quantity??null,unit:price.unit??null,originalValue:price,normalizedValue:{amountMinor:price.amountMinor,currency:price.currency,partNumber:normalize(price.partNumber),supplier:normalize(price.supplier)},confidence:price.confidence??75,evidenceDocumentId:price.documentId,evidenceDocumentVersionId:price.documentVersionId,evidenceLocation:price.sourceLocation||{},evidenceQuality:price.evidenceQuality||"Historical Commercial Evidence"});}
 for(const decision of decisions)rows.push({observationType:decision.type||"Decision",observationKey:decision.id||normalize(`${decision.subject}:${decision.reason}`),boqItemId:decision.boqItemId||null,manufacturer:decision.manufacturer||null,partNumber:decision.partNumber||null,supplier:decision.supplier||null,originalValue:decision,normalizedValue:{subject:normalize(decision.subject),reason:normalize(decision.reason),outcome:normalize(decision.outcome)},confidence:decision.confidence??70,evidenceDocumentId:decision.documentId,evidenceDocumentVersionId:decision.documentVersionId,evidenceLocation:decision.sourceLocation||{},evidenceQuality:decision.evidenceQuality||"Decision Evidence"});
 return unique(rows).map(row=>({...row,projectId:project.id,historicalOnly:true}));
}

export function buildPricingCard(partNumber,observations=[]){
 const matching=observations.filter(row=>normalize(row.partNumber)===normalize(partNumber));
 const values=type=>matching.filter(row=>row.observationType===type);
 const distinct=key=>[...new Set(matching.map(row=>row[key]).filter(Boolean))];
 return {partNumber,manufacturer:distinct("manufacturer")[0]||null,historicalProjects:distinct("projectId"),historicalSuppliers:distinct("supplier"),historicalPrices:Object.fromEntries(PRICE_TYPES.map(type=>[type,values(type).map(row=>({currency:row.currency,amountMinor:row.amountMinor,percentageBasisPoints:row.percentageBasisPoints,projectId:row.projectId,evidenceDocumentId:row.evidenceDocumentId,evidenceLocation:row.evidenceLocation,historicalOnly:true}))])),accessories:matching.filter(row=>row.observationType==="Accessory").map(row=>row.originalValue),alternatives:matching.filter(row=>row.observationType==="Alternative Product").map(row=>row.originalValue),technicalDecisions:matching.filter(row=>row.observationType==="Technical Decision").map(row=>row.originalValue),commercialDecisions:matching.filter(row=>row.observationType==="Commercial Decision").map(row=>row.originalValue),lastSeen:matching.map(row=>row.createdAt).filter(Boolean).sort().at(-1)||null,evidenceSources:[...new Set(matching.map(row=>row.evidenceDocumentId).filter(Boolean))],historicalOnly:true};
}

export function projectSignals({project,boqItems=[],products=[]}){const rows=[["System",project.systemDomain,4],["Project Type",project.projectType,3],["Location",project.location,1],...boqItems.map(i=>["BOQ",`${i.system||""}:${i.category||i.description||""}`,2]),...products.map(p=>["Product",p.partNumber,2])];return rows.filter(([,v])=>normalize(v)).map(([signalType,signalValue,weight])=>({signalType,signalValue:String(signalValue),normalizedValue:normalize(signalValue),weight}));}
export function similarProjects(base=[],candidates=[]){const grouped=new Map();for(const c of candidates){if(!grouped.has(c.projectId))grouped.set(c.projectId,[]);grouped.get(c.projectId).push(c);}const denominator=base.reduce((sum,s)=>sum+Number(s.weight),0)||1;return [...grouped].map(([projectId,signals])=>{const set=new Set(signals.map(s=>`${s.signalType}:${s.normalizedValue}`)),matches=base.filter(s=>set.has(`${s.signalType}:${s.normalizedValue}`));return{projectId,score:Math.round(matches.reduce((sum,s)=>sum+Number(s.weight),0)/denominator*100),basis:matches.map(s=>({type:s.signalType,value:s.signalValue,weight:s.weight})),copiesQuotation:false};}).sort((a,b)=>b.score-a.score);}

export function buildLearningStages({project={},sources=[],observations=[],signals=[]}){
 const understoodFields=["name","client","location","industry","projectType","systemDomain","currency","tenderReference"].filter(key=>clean(project[key]));
 const journeyCoverage=[...new Set(sources.map(source=>source.journeyStage).filter(Boolean))];
 const evidenceBacked=observations.filter(row=>row.evidenceDocumentId||row.evidenceDocumentVersionId||row.boqItemId);
 const rememberedProducts=new Set(observations.map(row=>normalize(row.partNumber)).filter(Boolean));
 return [
  {stage:"Understand",status:sources.length||understoodFields.length?"Completed":"Needs Evidence",facts:understoodFields.length,sources:sources.length,output:{understoodFields,journeyCoverage},safety:"Missing project facts remain unknown."},
  {stage:"Learn",status:observations.length?"Completed":"Needs Evidence",facts:observations.length,evidenceBackedFacts:evidenceBacked.length,output:{observationTypes:[...new Set(observations.map(row=>row.observationType))]},safety:"Only source-supported facts and decisions are learned."},
  {stage:"Remember",status:observations.length?"Completed":"Waiting",facts:rememberedProducts.size,signals:signals.length,output:{productsRemembered:rememberedProducts.size,similaritySignals:signals.length},safety:"Memory is historical evidence, never automatic approval."}
 ];
}
