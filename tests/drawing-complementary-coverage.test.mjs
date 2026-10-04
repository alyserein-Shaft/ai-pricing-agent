import test from 'node:test';
import assert from 'node:assert/strict';
import {computeComplementaryCropRegions} from '../app/domain/drawing-crop-selection.mjs';
import {linkVisualEvidence} from '../app/domain/drawing-visual-evidence.mjs';
import {buildDrawingUnderstandingSummary} from '../app/domain/drawing-understanding-summary.mjs';
test('sparse equipment/location, circuit, notes survive a dense unrelated cluster',()=>{
 const asset=(text,x,y)=>({asset_type:'Text',text_content:text,bounding_box:{x,y,width:80,height:10}});
 const assets=[...Array.from({length:90},(_,i)=>asset('X',100+i,100)),asset('CONTROL PANEL',1100,1500),asset('AT LEVEL 2 ROOM 7',1100,1540),asset('LOOP-7',500,900),asset('SPARE',510,910),asset('GENERAL NOTES',1800,2500)];
 const r=computeComplementaryCropRegions({assets,pageWidth:2200,pageHeight:3000});
 for(const a of assets.slice(90))assert.ok(r.some(c=>c.rect.x<=a.bounding_box.x && c.rect.y<=a.bounding_box.y && c.rect.x+c.rect.width>=a.bounding_box.x+80 && c.rect.y+c.rect.height>=a.bounding_box.y+10),a.text_content);
 assert.ok(r.length<=7);
});
test('source fragments and duplicate circuit interpretations are not extra engineering findings',()=>{
 const items=[...Array.from({length:208},(_,i)=>({sourceType:'Text',label:String(i)})),{sourceType:'Loop',label:'LOOP-1'},{sourceType:'AiCircuit',label:'LOOP-1 (Detection) — Unknown',evidence:{spareStatus:'Unknown'}}];
 const s=buildDrawingUnderstandingSummary({items,historicalCount:40});
 assert.equal(s.counts.currentEngineering,1);assert.equal(s.counts.sourceFragments,208);assert.equal(s.counts.overlappingSources,1);assert.equal(s.counts.historical,40);
});
test('ungrounded cable and bare quantity are flagged rather than counted',()=>{
 const base={sourceEntity:{},hardReviewReasons:[],evidence:{normalizedValue:'2-wire 120V AC'}};
 const [item]=linkVisualEvidence([{...base,semanticType:'cableSpecs',label:'2-wire 120V AC'}],[{text:'2 X 1.5 sq.mm',sourceId:'a',pageNumber:1}]);
 assert.ok(item.evidence.groundingWarning);
});

test('cable mention counts use distinct source records, not the model estimate',()=>{
 const textEvidence=[{sourceId:'a',pageNumber:1,text:'4 X 1.0 sq.mm'},{sourceId:'b',pageNumber:1,text:'4 X 1.0 sq.mm'}];
 const [r]=linkVisualEvidence([{sourceEntity:{},hardReviewReasons:[],semanticType:'cableSpecs',label:'4 X 1.0',evidence:{normalizedValue:'4 X 1.0 sq.mm',occurrenceCount:99,circuitContext:'Unspecified'}}],textEvidence);
 assert.equal(r.evidence.occurrenceCount,2);assert.equal(r.evidence.modelOccurrenceCount,99);assert.match(r.label,/2 source text mentions/);
});

test('a spare annotation cannot be copied to a different loop',()=>{
 const source=(sourceId,text,x,y)=>({sourceId,text,pageNumber:1,boundingBox:{x,y,width:20,height:8}});
 const evidence=[source('a','LOOP-7',100,100),source('b','LOOP-8',100,140),source('s','SPARE',120,140)];
 const item=label=>({sourceEntity:{},hardReviewReasons:[],semanticType:'circuits',label:`${label} — Spare / Unpopulated`,evidence:{evidenceQuote:label,spareStatus:'Spare / Unpopulated'}});
 const [wrong,right]=linkVisualEvidence([item('LOOP-7'),item('LOOP-8')],evidence);
 assert.equal(wrong.evidence.spareStatus,'Unknown');assert.equal(right.evidence.spareStatus,'Spare / Unpopulated');assert.equal(right.evidence.statusEvidence.sourceId,'s');
});
