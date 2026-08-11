import { classifyDocumentBytes, sampleDocumentContent } from "./document-classifier.mjs";
import { parseXlsxWorkbook } from "../document-parsers/xlsx.mjs";
import { parseXlsWorkbook } from "../document-parsers/xls.mjs";
import { extractBoqBytes } from "./boq-extractor.mjs";

export const KNOWLEDGE_EXTRACTION_VERSION="knowledge-library-v1.1";
const clean=v=>String(v??"").replace(/\s+/g," ").trim();
const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9.+/-]+/g," ").trim();
const unique=rows=>[...new Map(rows.map(row=>[`${row.factType}|${row.factKey}|${row.normalizedValue}|${JSON.stringify(row.sourceLocation)}`,row])).values()];
const manufacturerNames=["Honeywell","Farenhyt","Gamewell-FCI","Gamewell","FCI","Gent","Bosch","Hikvision","Cisco","Datwyler","Lenel","Palo Alto","APC","Schneider Electric","System Sensor","Silent Knight","Notifier","WISI","Sapling","Samsung","TOA","Hisense","Screenline","Corning","Huawei","Nedap","Baldwin Boxall"];
const currencies=[[/\bSAR\b|Saudi Riyal/ig,"SAR"],[/\bUSD\b|\$\s*\d/ig,"USD"],[/\bEUR\b|€/ig,"EUR"],[/\bAED\b/ig,"AED"]];
const standards=/\b(?:EN\s?54(?:-\d+)?|UL\s?\d*|FM(?:\s+Approved)?|NFPA\s?\d+|IEC\s?\d+|ISO\s?\d+|BS\s?\d+)\b/ig;
const certifications=/\b(?:UL Listed|FM Approved|EN54 Certified|CE Marked|SABER)\b/ig;
const protocols=/\b(?:BACnet|Modbus|RS-?485|RS-?232|Ethernet|PoE\+*|SLC|NAC|CAN bus|LonWorks|OPC)\b/ig;
const partPattern=/\b(?=[A-Z0-9][A-Z0-9./_-]{2,30}\b)(?=[A-Z0-9./_-]*\d)[A-Z0-9]+(?:[-_./][A-Z0-9]+)+\b/g;
const pricePattern=/(?:\b(SAR|USD|EUR|AED)\b\s*|([$€])\s*)(\d{1,9}(?:,\d{3})*(?:\.\d{1,4})?)/ig;
const headerNorm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"");
const push=(facts,factType,value,confidence,attributes={},sourceLocation={})=>{const originalValue=clean(value);if(!originalValue)return;facts.push({factType,factKey:norm(originalValue),originalValue,normalizedValue:norm(originalValue),confidence,attributes,sourceLocation});};
const cellAt=(row,column)=>row.cells.find(cell=>cell.column===column);
const valueAt=(row,column)=>cellAt(row,column)?.value??"";
const refAt=(row,column)=>cellAt(row,column)?.reference??"";
const findHeader=(sheet)=>{
 const aliases={code:["partnumber","partno","modelnumber","model","productcode","sku","obsoleteitem"],description:["description","partnoanddescription","partnodescription","itemdescription"],price:["listprice","lpin","lp","unitprice","perunitsar","price"],replacement:["replacement","replacementpart","replacementpartno"],currency:["currency"],coo:["coo","countryoforigin"],unit:["unit","uom"],qty:["qty","quantity"],make:["make","manufacturer","brand"],category:["producttype","category"],comments:["comments","remarks","notes"],warranty:["warrantyyears","warranty"],moq:["moq"]};
 for(const row of sheet.rows){const entries=row.cells.map(cell=>[headerNorm(cell.value),cell.column]);const columns={};for(const [key,names] of Object.entries(aliases))columns[key]=names.flatMap(name=>entries.filter(([label])=>label===name||((key==="price"||key==="replacement")&&name.length>3&&label.includes(name))).map(([,column])=>column))[0]||0;if(columns.code&&columns.description&&(columns.price||columns.replacement||columns.category||columns.qty||/price|product|obsolete/i.test(sheet.name)))return {row:row.sourceRow,columns,labels:Object.fromEntries(row.cells.map(c=>[c.column,clean(c.value)]))};}return null;
};
const currencyFromHeader=(label,text)=>/sar/i.test(label)?"SAR":/usd|\$/i.test(label)?"USD":/eur|€/i.test(label)?"EUR":/aed/i.test(label)?"AED":text.match(/\b(SAR|USD|EUR|AED)\b/i)?.[1]?.toUpperCase()||"Unknown";
const explicitRelationships=(description)=>{
 const rows=[];let match;
 const patterns=[["Requires",/\brequires?\s+([A-Z0-9][A-Z0-9._/-]{2,30})/ig],["Replacement",/\b(?:replacement(?:\s+for)?|replaced\s+by)\s+([A-Z0-9][A-Z0-9._/-]{2,30})/ig],["Compatible With",/\bcompatible\s+with\s+([A-Z0-9][A-Z0-9._/-]{2,30})/ig]];
 for(const [relationship,pattern] of patterns)while((match=pattern.exec(description)))rows.push({relationship,target:match[1]});return rows;
};
const structuredWorkbookFacts=(bytes,fileName,text,extension)=>{
 const workbook=extension==="xls"?parseXlsWorkbook(bytes,{fileName}):parseXlsxWorkbook(bytes,{fileName});const facts=[];let currentFamily="";
 for(const sheet of workbook.sheets){if(/cover|release notes|support agreement|\bssa\b|checklist|customer info|warranty|rma form/i.test(sheet.name))continue;let header=findHeader(sheet);if(!header&&/\bRFQ\b|\bBOM\b|\bQuote\b/i.test(fileName)){const candidates=sheet.rows.slice(0,30).filter(row=>{const code=clean(valueAt(row,1)),description=clean(valueAt(row,2));return /^[A-Z0-9][A-Z0-9._/-]{2,30}$/i.test(code)&&description.length>12;});if(candidates.length>=3)header={row:0,columns:{code:1,description:2,price:4,qty:3,make:0,coo:0,unit:0,category:0,comments:0,replacement:0},labels:{4:"Unclassified source unit price"}};}if(!header)continue;currentFamily="";
  for(const row of sheet.rows.filter(entry=>entry.sourceRow>header.row)){
   const code=clean(valueAt(row,header.columns.code));let description=clean(valueAt(row,header.columns.description));if(!description&&header.columns.description>1){const adjacent=clean(valueAt(row,header.columns.description-1));if(adjacent.length>20)description=adjacent;}const category=clean(valueAt(row,header.columns.category));
   const populated=row.cells.filter(c=>clean(c.value));
   if(!code&&populated.length===1){const candidate=clean(populated[0].value);if(candidate.length>2&&!/^total|note|terms|description/i.test(candidate))currentFamily=candidate;continue;}
   if(!code||!description||/^(part number|model number|part no)$/i.test(code))continue;
   const observationKey=`${sheet.name}:${row.sourceRow}:${code}`;const source={sheet:sheet.name,row:row.sourceRow,cell:refAt(row,header.columns.code),descriptionCell:refAt(row,header.columns.description),fileName};
   const make=clean(valueAt(row,header.columns.make));const coo=clean(valueAt(row,header.columns.coo));const unit=clean(valueAt(row,header.columns.unit));const comments=clean(valueAt(row,header.columns.comments));
   push(facts,"Part Number",code,99,{observationKey,description,family:currentFamily||category||"Unknown",manufacturer:make||"Unknown",unit:unit||"Unknown",countryOfOrigin:coo||"Unknown"},source);
   push(facts,"Product Description",description,98,{observationKey,partNumber:code}, {...source,cell:refAt(row,header.columns.description)});
   if(currentFamily)push(facts,"Product Family",currentFamily,92,{observationKey,partNumber:code},source);
   if(category)push(facts,"Category",category,94,{observationKey,partNumber:code},source);
   if(make)push(facts,"Manufacturer",make,95,{observationKey,partNumber:code},source);
   if(coo)push(facts,"Country of Origin",coo,95,{observationKey,partNumber:code},source);
   if(unit)push(facts,"Unit",unit,95,{observationKey,partNumber:code},source);
   const priceCell=cellAt(row,header.columns.price),rawPrice=priceCell?.value;const price=typeof rawPrice==="number"?rawPrice:Number(String(rawPrice).replaceAll(",",""));
   if(header.columns.price&&Number.isFinite(price)&&price>=0){const label=header.labels[header.columns.price]||"";const isCatalogue=/list price|\blp\b/i.test(label);if(isCatalogue){const currency=currencyFromHeader(label,text);push(facts,"Price",`${currency} ${price}`,96,{observationKey,partNumber:code,currency,amount:price,priceType:"Historical Catalogue Price",effectiveDate:"Unknown",validity:"Unknown",region:"Unknown",approvalStatus:"Discovery Only",costingEligible:false,originalHeader:label},{...source,cell:priceCell.reference});}}
   for(const match of description.matchAll(standards))push(facts,"Standard",match[0],92,{observationKey,partNumber:code},source);
   for(const match of description.matchAll(certifications))push(facts,"Certification",match[0],90,{observationKey,partNumber:code,evidenceLevel:"Catalogue statement; certificate not verified"},source);
   for(const match of description.matchAll(protocols))push(facts,"Protocol",match[0],88,{observationKey,partNumber:code},source);
   for(const rel of explicitRelationships(`${description} ${comments}`))push(facts,"Product Relationship",`${code} ${rel.relationship} ${rel.target}`,86,{observationKey,sourcePartNumber:code,targetPartNumber:rel.target,relationship:rel.relationship,explicit:true,reviewRequired:true},source);
   if(/\b(obsolete|discontinued|legacy)\b/i.test(`${description} ${comments}`))push(facts,"Lifecycle",code,90,{observationKey,partNumber:code,status:(`${description} ${comments}`.match(/obsolete|discontinued|legacy/i)||[])[0],evidence:`${description} ${comments}`},source);
   const replacement=clean(valueAt(row,header.columns.replacement));if(header.columns.replacement){push(facts,"Lifecycle",code,98,{observationKey,partNumber:code,status:"Obsolete",replacement:replacement||"Unknown",evidence:replacement||"No replacement value supplied"},{...source,cell:refAt(row,header.columns.replacement)});if(replacement&&!/^no replacement|obsolete with no replacement$/i.test(replacement))push(facts,"Product Relationship",`${code} Replacement ${replacement}`,92,{observationKey,sourcePartNumber:code,targetPartNumber:replacement,relationship:"Replacement",explicit:true,reviewRequired:true},{...source,cell:refAt(row,header.columns.replacement)});}
  }
 }
 return facts;
};

const structuredBoqFacts=(bytes,fileName,extension)=>{
 const extraction=extractBoqBytes(bytes,{fileName,extension});const facts=[];
 for(const row of extraction.rows){const source={...row.source,fileName};const identity=`${row.source.sheet||row.source.page||"source"}:${row.source.row}:${row.sequence}`;
  if(row.rowType==="BOQ Item"&&row.description)facts.push({factType:"BOQ Item",factKey:`boq-item:${identity}`,originalValue:row.description,normalizedValue:norm(row.description),confidence:row.confidence,attributes:{itemNumber:row.itemNumber,section:row.section,subsection:row.subsection,system:row.system?.value||"Unknown",unit:row.unit?.normalized||row.unit?.original||"Unknown",originalUnit:row.unit?.original||null,quantity:row.quantity?.numeric,originalQuantity:row.quantity?.original||null,quantityType:row.quantity?.type,manufacturer:row.manufacturer||null,model:row.model||null,reviewStatus:row.reviewStatus,warnings:row.warnings.map(warning=>warning.code),historicalObservation:true,costingEligible:false},sourceLocation:source});
  if(["Section Header","Subsection Header"].includes(row.rowType)&&row.description)facts.push({factType:"BOQ Section",factKey:`boq-section:${identity}`,originalValue:row.description,normalizedValue:norm(row.description),confidence:row.confidence,attributes:{section:row.section,subsection:row.subsection,hierarchyDepth:row.hierarchyDepth,historicalObservation:true},sourceLocation:source});
  if(row.rowType==="BOQ Item"&&row.partNumber)push(facts,"Part Number",row.partNumber,row.confidence,{description:row.description,manufacturer:row.manufacturer||"Unknown",sourceType:"BOQ Observation",historicalObservation:true,reviewRequired:true},source);
 }
 return {facts,summary:{...extraction.summary,itemsNeedingReview:extraction.rows.filter(row=>row.rowType==="BOQ Item"&&row.reviewStatus==="Needs Review").length}};
};

export function extractKnowledgeFromBytes(bytes,{fileName,extension,mimeType=""}){
 const detected=classifyDocumentBytes(bytes,{fileName,extension,declaredType:"Auto Detection"});
 const sample=sampleDocumentContent(bytes,{fileName,extension});const text=sample.text||"";let facts=[];
 const priceListEvidence=/price\s*(?:list|book)|pricelist|\blist price\b/i.test(`${fileName} ${text.slice(0,10000)}`),quotationEvidence=/\bquotation\b|\bquote(?:\s*(?:number|#)|\.(?:xlsx?|pdf)\b)|supplier quotation/i.test(`${fileName} ${text.slice(0,8000)}`);
 const rfqEvidence=/\bRFQ\b/i.test(fileName);const classification=priceListEvidence?{...detected,primaryType:"Price List",confidence:Math.max(96,detected.confidence),secondaryTypes:[...new Set([...(detected.secondaryTypes||[]),detected.primaryType].filter(type=>type!=="Price List"))],manualReviewRequired:false}:quotationEvidence?{...detected,primaryType:"Supplier Quotation",confidence:Math.max(92,detected.confidence),secondaryTypes:[...new Set([...(detected.secondaryTypes||[]),detected.primaryType].filter(type=>type!=="Supplier Quotation"))]}:rfqEvidence?{...detected,primaryType:"Supplier RFQ",confidence:Math.max(88,detected.confidence),secondaryTypes:[...new Set([...(detected.secondaryTypes||[]),detected.primaryType].filter(type=>type!=="Supplier RFQ"))]}:detected;
 let boqSummary=null;
 if(["xls","xlsx"].includes(extension))facts.push(...structuredWorkbookFacts(bytes,fileName,text,extension));
 if(classification.primaryType==="BOQ"&&["xls","xlsx","csv","pdf"].includes(extension)){const learnedBoq=structuredBoqFacts(bytes,fileName,extension);facts.push(...learnedBoq.facts);boqSummary=learnedBoq.summary;}
 for(const name of manufacturerNames)if(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i").test(text))push(facts,"Manufacturer",name,95,{},{fileName});
 if(!["xls","xlsx"].includes(extension))for(const match of text.matchAll(partPattern))push(facts,"Part Number",match[0],72,{candidate:true},{fileName});
 for(const match of text.matchAll(standards))push(facts,"Standard",match[0],88,{},{fileName});
 for(const match of text.matchAll(certifications))push(facts,"Certification",match[0],86,{evidenceLevel:"Document statement; certificate not verified"},{fileName});
 for(const match of text.matchAll(protocols))push(facts,"Protocol",match[0],78,{},{fileName});
 for(const match of text.matchAll(/\b([A-Z][A-Za-z0-9-]{2,30}\s+(?:Series|System|Family))\b/g))push(facts,"Product Family",match[1],72,{candidate:true},{fileName});
 push(facts,"Document Type",classification.primaryType,classification.confidence,{automaticClassification:true},{fileName});
 const revision=`${fileName} ${text.slice(0,15000)}`.match(/\b(?:revision|rev(?:ision)?|version|ver)\s*[:#.-]?\s*(V?\d+(?:\.\d+)*|R\d+)\b/i)?.[1];if(revision)push(facts,"Revision",revision,90,{},{fileName});
 const documentDate=`${fileName} ${text.slice(0,15000)}`.match(/\b(?:effective\s+from|document\s+date|date\s+of\s+publication)\s*[:.-]?\s*([0-3]?\d[\s./-]+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|[01]?\d)[\s,./-]+20\d{2})\b/i)?.[1];if(documentDate)push(facts,"Document Date",documentDate,88,{},{fileName});
 if(/\bKSA\b|Saudi Arabia/i.test(`${fileName} ${text.slice(0,15000)}`))push(facts,"Region","KSA",96,{},{fileName});else if(/\bMEA\b|Middle East(?: and Africa)?/i.test(`${fileName} ${text.slice(0,15000)}`))push(facts,"Region","MEA",92,{},{fileName});
 push(facts,"Language",/[\u0600-\u06ff]/.test(text)?"Arabic / English":"English",90,{},{fileName});
 for(const [pattern,currency] of currencies){pattern.lastIndex=0;if(pattern.test(text))push(facts,"Currency",currency,95,{},{fileName});}
 if(!["xls","xlsx"].includes(extension))for(const match of text.matchAll(pricePattern)){const currency=match[1]||(match[2]==="$"?"USD":match[2]==="€"?"EUR":"Unknown");push(facts,"Price",`${currency} ${match[3]}`,55,{currency,amount:Number(match[3].replaceAll(",","")),priceType:"Unclassified Source Price",approvalStatus:"Discovery Only",reviewRequired:true,costingEligible:false},{fileName});}
 const result=unique(facts),parts=result.filter(f=>f.factType==="Part Number"),prices=result.filter(f=>f.factType==="Price");
 const summary={filesProcessed:1,productsLearned:parts.filter(f=>f.confidence>=90&&!f.attributes.candidate).length,productCandidates:parts.filter(f=>f.confidence<90||f.attributes.candidate).length,boqItemsLearned:result.filter(f=>f.factType==="BOQ Item").length,boqSectionsLearned:result.filter(f=>f.factType==="BOQ Section").length,boqItemsRequiringReview:boqSummary?.itemsNeedingReview||0,newManufacturers:new Set(result.filter(f=>f.factType==="Manufacturer").map(f=>f.normalizedValue)).size,pricesDiscovered:prices.filter(f=>f.attributes.priceType==="Historical Catalogue Price").length,sourcePricesRequiringReview:prices.filter(f=>f.attributes.priceType!=="Historical Catalogue Price").length,accessoriesDiscovered:result.filter(f=>f.factType==="Product Relationship"&&/Requires|Compatible/.test(f.attributes.relationship||"")).length,certificationsDiscovered:result.filter(f=>f.factType==="Certification").length,standardsDiscovered:result.filter(f=>f.factType==="Standard").length,lifecycleRecords:result.filter(f=>f.factType==="Lifecycle").length,itemsRequiringReview:result.filter(f=>f.confidence<80||f.attributes.reviewRequired).length};
 return {classification,sample:{readable:sample.readable,requiresOcr:Boolean(sample.requiresOcr),extractionMethod:sample.extractionMethod,extractionQuality:sample.extractionQuality},facts:result,summary};
}

export function knowledgeFileCategory(type){return ({"Price List":"Price Lists","Product Catalogue":"Files","Product Datasheet":"Datasheets","Previous Project Reference":"Case Studies"}[type]||"Files");}
