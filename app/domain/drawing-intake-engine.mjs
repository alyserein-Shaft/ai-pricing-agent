export const DRAWING_INTAKE_VERSION = "drawing-intake-1.0.0";
export const DRAWING_CLASSIFICATIONS = ["Floor Plan", "Riser Diagram", "Single Line Diagram (SLD)", "Wiring Diagram", "Device Layout", "Legend Sheet", "Installation Detail", "Typical Detail", "Sequence of Operation", "Notes Sheet", "Schedule", "Mixed Drawing", "Unknown"];
export const PAGE_CLASSIFICATIONS = ["Cover", ...DRAWING_CLASSIFICATIONS];

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const confidence = (hits) => Math.min(98, 58 + hits * 10);
const rules = [
  ["Floor Plan", [/\bfloor plan\b/i, /\blevel\s+\d+\b/i, /\bground floor\b/i]],
  ["Riser Diagram", [/\briser\b/i, /\bvertical schematic\b/i]],
  ["Single Line Diagram (SLD)", [/\bsingle[- ]line\b/i, /\bSLD\b/i]],
  ["Wiring Diagram", [/\bwiring (?:diagram|detail)\b/i, /\bterminal diagram\b/i]],
  ["Device Layout", [/\bdevice layout\b/i, /\bequipment layout\b/i]],
  ["Legend Sheet", [/\blegend\b/i, /\bsymbols?\s*(?:and|&)\s*abbreviations?\b/i]],
  ["Installation Detail", [/\binstallation detail\b/i, /\bmounting detail\b/i]],
  ["Typical Detail", [/\btypical detail\b/i, /\btyp\.\s*detail\b/i]],
  ["Sequence of Operation", [/\bsequence of operation\b/i, /\bcause\s*(?:and|&)\s*effect\b/i]],
  ["Notes Sheet", [/\bgeneral notes?\b/i, /\bdrawing notes?\b/i]],
  ["Schedule", [/\bschedule\b/i, /\bequipment schedule\b/i]],
];
const classify = (text, allowCover = false) => {
  const matches = rules.map(([type, patterns]) => ({ type, hits: patterns.filter((pattern) => pattern.test(text)).length })).filter((entry) => entry.hits > 0).map((entry) => ({ type: entry.type, confidence: confidence(entry.hits), method: "Deterministic explicit-title rules" }));
  if (allowCover && /\b(?:cover sheet|drawing index|project title)\b/i.test(text)) matches.unshift({ type: "Cover", confidence: 88, method: "Deterministic explicit-title rules" });
  if (!matches.length) return [{ type: "Unknown", confidence: 0, method: "No explicit structural label detected" }];
  return matches;
};
const explicit = (text, labels) => { for (const label of labels) { const inline = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*(?::|#|-)\\s*([^\\n]{2,100})`, "im")); if (inline) return clean(inline[1]); const nextLine = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*\\n\\s*([^\\n]{2,100})`, "im")); if (nextLine) return clean(nextLine[1]); } return null; };
const drawingNumber = (text) => explicit(text, ["drawing (?:no\\.?|number)", "dwg\\.? no\\.?"]);

export const extractDrawingStructure = async (bytes, metadata = {}) => {
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = class DOMMatrix { constructor(values=[1,0,0,1,0,0]) { [this.a,this.b,this.c,this.d,this.e,this.f]=values; } multiplySelf(){return this;} preMultiplySelf(){return this;} translate(){return this;} scale(){return this;} invertSelf(){return this;} };
  if (!globalThis.ImageData) globalThis.ImageData = class ImageData { constructor(data,width,height){this.data=data;this.width=width;this.height=height;} };
  if (!globalThis.Path2D) globalThis.Path2D = class Path2D { addPath(){} };
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), disableWorker: true, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages=[]; const assets=[]; const legends=[]; const search=[];
  for (let pageNumber=1; pageNumber<=pdf.numPages; pageNumber++) {
    const page=await pdf.getPage(pageNumber), viewport=page.getViewport({scale:1}), content=await page.getTextContent({disableNormalization:false});
    const items=content.items.filter((item)=>"str" in item && clean(item.str)); const vector=items.length>0; const lines=new Map();
    for (const item of items) { const x=Number(item.transform?.[4]||0),y=Number(item.transform?.[5]||0),w=Number(item.width||0),h=Number(item.height||0),rowKey=Math.round(y*2)/2,row=lines.get(rowKey)||[];row.push({text:clean(item.str),x,y,width:w,height:h});lines.set(rowKey,row);assets.push({pageNumber,assetType:"Text",text:clean(item.str),boundingBox:{x,y,width:w,height:h,pageWidth:viewport.width,pageHeight:viewport.height},coordinatesAvailable:true,detectionConfidence:99,detectionMethod:"PDF text item geometry"}); }
    const ordered=[...lines.entries()].sort((a,b)=>b[0]-a[0]).map(([,row])=>row.sort((a,b)=>a.x-b.x).map((item)=>item.text).join(" ")); const pageText=ordered.join("\n"); const classifications=classify(pageText,true); const isLegend=classifications.some((entry)=>entry.type==="Legend Sheet");
    const issueDateText=explicit(pageText,["issue date","date"]),issueDates=issueDateText?.match(/\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g)||[];
    const metadataValues={ drawingNumber:drawingNumber(pageText), revision:explicit(pageText,["revision","rev\\.?"]), sheetName:explicit(pageText,["sheet (?:name|title)","drawing title","title"]), discipline:explicit(pageText,["discipline"]), scale:explicit(pageText,["scale"]), issueDate:issueDates.length===1?issueDates[0]:null, consultant:explicit(pageText,["consultant"]), contractor:explicit(pageText,["contractor"]), client:explicit(pageText,["client","owner"]), projectName:explicit(pageText,["project (?:name|title)"]), sheetSize:explicit(pageText,["sheet size","paper size"]) };
    const titleItems=items.filter((item)=>Number(item.transform?.[5]||0)<viewport.height*.25); if(titleItems.length>=3)assets.push({pageNumber,assetType:"Title Block",text:titleItems.map((item)=>clean(item.str)).join(" "),boundingBox:{x:0,y:0,width:viewport.width,height:viewport.height*.25,pageWidth:viewport.width,pageHeight:viewport.height},coordinatesAvailable:true,detectionConfidence:72,detectionMethod:"Bottom-quarter text region"});
    if(/\bnorth\b/i.test(pageText)){const north=items.find((item)=>/^north$/i.test(clean(item.str)));assets.push({pageNumber,assetType:"North Arrow",text:"North",boundingBox:north?{x:Number(north.transform?.[4]||0),y:Number(north.transform?.[5]||0),width:Number(north.width||0),height:Number(north.height||0),pageWidth:viewport.width,pageHeight:viewport.height}:null,coordinatesAvailable:Boolean(north),detectionConfidence:north?82:55,detectionMethod:"Explicit NORTH text marker"});}
    const tableLines=ordered.filter((line)=>line.split(/\s{2,}|\t|\|/).filter(Boolean).length>=3); if(tableLines.length>=3)assets.push({pageNumber,assetType:/schedule/i.test(pageText)?"Schedule":"Table",text:tableLines.join("\n"),boundingBox:null,coordinatesAvailable:false,detectionConfidence:68,detectionMethod:"Repeated aligned text columns; geometry not safely bounded"});
    if(isLegend){const entries=ordered.filter((line)=>/\s[-:=]\s/.test(line)).slice(0,500).map((line,index)=>{const [label,...rest]=line.split(/\s[-:=]\s/);return{sequence:index+1,label:clean(label),description:clean(rest.join(" - ")),entryType:/\babbr/i.test(pageText)?"Abbreviation":"Detected Symbol / Device Label",confidence:70};});legends.push({pageNumber,legendVersion:metadataValues.revision||metadata.revision||null,entries,confidence:classifications.find((entry)=>entry.type==="Legend Sheet")?.confidence||70,detectionMethod:"Explicit legend heading and delimited entries"});assets.push({pageNumber,assetType:"Legend",text:pageText,boundingBox:null,coordinatesAvailable:false,detectionConfidence:legends.at(-1).confidence,detectionMethod:"Explicit legend heading"});}
    for(const line of ordered)search.push({pageNumber,text:line,drawingNumber:metadataValues.drawingNumber,sheetName:metadataValues.sheetName,tags:classifications.map((entry)=>entry.type)});
    pages.push({pageNumber,width:viewport.width,height:viewport.height,coordinateMode:vector?"Vector Coordinates Available":"Coordinates Unavailable",classifications,metadata:metadataValues,textCount:items.length,reviewStatus:"Needs Review",extractionMethod:vector?"Native PDF text geometry":"Raster/no readable text layer"});
  }
  const docTypes=[...new Set(pages.flatMap((page)=>page.classifications.map((entry)=>entry.type)).filter((type)=>type!=="Cover"&&type!=="Unknown"))]; if(docTypes.length>1)docTypes.push("Mixed Drawing"); if(!docTypes.length)docTypes.push("Unknown");
  const combined=pages.map((page)=>page.metadata); const first=(field)=>combined.map((entry)=>entry[field]).find(Boolean)||null;
  return { parserVersion:DRAWING_INTAKE_VERSION,documentClassifications:docTypes.map((type)=>({type,confidence:type==="Mixed Drawing"?90:Math.max(...pages.flatMap((page)=>page.classifications.filter((entry)=>entry.type===type).map((entry)=>entry.confidence)),0),method:"Aggregated page classifications"})),metadata:{drawingNumber:first("drawingNumber"),revision:first("revision")||metadata.revision||null,sheetName:first("sheetName"),discipline:first("discipline"),scale:first("scale"),issueDate:first("issueDate"),consultant:first("consultant"),contractor:first("contractor"),client:first("client"),projectName:first("projectName"),sheetSize:first("sheetSize")},pages,assets,legends,search,summary:{pageCount:pages.length,assetCount:assets.length,legendCount:legends.length,searchEntryCount:search.length,vectorPages:pages.filter((page)=>page.coordinateMode==="Vector Coordinates Available").length,rasterPages:pages.filter((page)=>page.coordinateMode==="Coordinates Unavailable").length}};
};
