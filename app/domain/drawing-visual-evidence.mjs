// Link proposals to the actual PDF text records. Model quotes are not proof
// that a source contains a claim. Unsupported numerical claims stay out of
// the engineering summary while their raw model response remains in history.
const normalize = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9.]/g,'');
export function linkVisualEvidence(items, textEvidence) {
  for(const item of items) {
    const quote=item.evidence?.evidenceQuote || item.evidence?.normalizedValue || item.label;
    const n=normalize(quote);
    const sources=textEvidence.filter(s=>normalize(s.text).length>=4 && (n.includes(normalize(s.text)) || normalize(s.text).includes(n) || (item.evidence.explicitLocation && normalize(s.text).includes(normalize(item.evidence.explicitLocation)))));
    item.sourceEntity.sourceReferences=sources.map(s=>({sourceId:s.sourceId,pageNumber:s.pageNumber,text:s.text,boundingBox:s.boundingBox}));
    item.evidence.sourceTextReferences=item.sourceEntity.sourceReferences;
    if(item.semanticType==='cableSpecs') {
      const spec=String(item.evidence.normalizedValue || '');
      const dimension=spec.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)/i)?.[0];
      const supported=dimension && textEvidence.some(s=>normalize(s.text).includes(normalize(dimension)));
      if(supported) {
        const mentions=textEvidence.filter(s=>normalize(s.text).includes(normalize(dimension)));
        item.evidence.modelOccurrenceCount=item.evidence.occurrenceCount;
        item.evidence.occurrenceCount=new Set(mentions.map(s=>s.sourceId)).size;
        item.evidence.occurrenceCountBasis='Distinct PDF text source records containing these dimensions; not cable quantities or lengths.';
        item.label=`${spec} (${item.evidence.occurrenceCount} source text mentions; ${item.evidence.circuitContext || 'Unspecified'})`;
        item.evidence.rawLabel=item.label;
      }
      if(!supported) {
        item.evidence.groundingWarning='Cable dimensions could not be matched to the extracted source text; inspect the saved images before relying on this proposal.';
        item.hardReviewReasons.push('SOURCE_TEXT_NOT_CORROBORATED');
      }
    }
    if(item.semanticType==='quantities' && /^\s*\d+\s*(?:nos?\.?|pcs?\.?)\s*$/i.test(item.evidence.sourceSymbolOrText || '')) {
      item.evidence.groundingWarning='Bare quantity annotation has no established device association; this is source text, not a device quantity.';
      item.hardReviewReasons.push('QUANTITY_DEVICE_ASSOCIATION_UNKNOWN');
    }
    if(item.semanticType==='circuits' && item.evidence.spareStatus !== 'Unknown') {
      const tag=item.label.match(/(?:NAC\s*LOOP|LOOP\s*[- ]\s*\d+)/i)?.[0];
      const tags=textEvidence.filter(s=>/^(?:NAC\s*LOOP|LOOP\s*[- ]\s*\d+)$/i.test(s.text.trim()) && s.boundingBox);
      const words=textEvidence.filter(s=>/^(?:SPARE|UNPOPULATED|IN USE)$/i.test(s.text.trim()) && s.boundingBox);
      const statusEvidence=words.find(word=>{
        const ranked=tags.map(t=>({t,d:Math.hypot(t.boundingBox.x-word.boundingBox.x,t.boundingBox.y-word.boundingBox.y)})).sort((a,b)=>a.d-b.d);
        return ranked.length && normalize(ranked[0].t.text)===normalize(tag) && ranked[0].d<=Math.max(40,word.boundingBox.height*4) &&
          (!ranked[1] || ranked[1].d>ranked[0].d*1.5) && (item.evidence.spareStatus==='In Use' ? /IN USE/i.test(word.text) : /SPARE|UNPOPULATED/i.test(word.text));
      });
      if(statusEvidence) {
        const ref={sourceId:statusEvidence.sourceId,pageNumber:statusEvidence.pageNumber,text:statusEvidence.text,boundingBox:statusEvidence.boundingBox};
        item.sourceEntity.sourceReferences.push(ref);
        item.evidence.statusEvidence=ref;
      } else {
        item.evidence.modelSpareStatus=item.evidence.spareStatus;
        item.evidence.spareStatus='Unknown';
        item.label=item.label.replace(/—.*$/,'— Unknown');
        item.evidence.rawLabel=item.label;
        item.hardReviewReasons.push('CIRCUIT_STATUS_SOURCE_ASSOCIATION_UNCONFIRMED');
      }
    }
    // An exact source location remains a candidate, never a human approval.
    if(item.semanticType==='equipment' && item.evidence.explicitLocation && !textEvidence.some(s=>normalize(s.text).includes(normalize(item.evidence.explicitLocation)))) {
      item.evidence.groundingWarning='The stated location is not an exact source-text match; inspect the image evidence.';
      item.hardReviewReasons.push('LOCATION_SOURCE_REVIEW_REQUIRED');
    }
  }
  return items;
}
