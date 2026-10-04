// WLC loop-evidence validation pass: a fixed 2x2 quadrant crop grid was
// proven (by mapping the real LOOP-1..4/NAC LOOP bounding boxes through the
// same coordinate math the app renders with) to put an entire 5-label
// circuit-tag cluster inside a ~94px-wide sliver of a 1400px-wide crop --
// legible-looking on screen, but the vision model's own fixed input
// resolution downsamples the WHOLE crop uniformly, so a small cluster
// buried in a mostly-empty quadrant shrinks to a few illegible pixels
// regardless of how high the crop's OWN render resolution is. A blind grid
// crop cannot fix this: the fix is choosing WHERE to crop from real content
// density, not assuming a uniform split.
//
// This is a generic, content-density crop selector -- it clusters whatever
// text bounding boxes the page actually has (from Drawing Intake, already
// extracted for every document) into a fixed-size grid of buckets, and
// returns the union bounding box (padded) of the densest buckets. Nothing
// here is tuned to one drawing's labels or layout; it works identically for
// any sheet's own text distribution.
//
// Pure domain logic: no DOM, no canvas, no fetch. Safe to unit test
// directly; DrawingVisualReviewPanel.tsx is the only caller, which turns
// each returned canonical rect into an actual PDF.js render+slice.

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// cellSize: bucket width/height in canonical page units. Deliberately not a
// per-document tuned value -- a fixed physical size means the SAME real-
// world density threshold applies to every sheet regardless of its overall
// page dimensions (a bigger page just gets more buckets, not bigger ones).
const DEFAULT_CELL_SIZE = 450;
// How much canonical-unit margin to add around a bucket's own item extent
// -- enough to keep a label's immediate context (an adjacent value, a
// connecting line, a status word like "SPARE") in frame without pulling in
// unrelated content from a neighboring bucket.
const DEFAULT_PADDING = 140;

// assets: drawing_assets-shaped rows -- each optionally has
// { text_content, bounding_box: { x, y, width, height } } in canonical
// (bottom-left origin, y-up) coordinates, the same convention every
// extraction engine in this codebase already uses (see
// drawing-coordinate-mapper.mjs). Assets without a usable bounding box or
// text are ignored -- a density crop can only be grounded in evidence that
// actually has a real position.
export const computeDenseTextCropRegions = ({
  assets = [],
  pageWidth,
  pageHeight,
  maxRegions = 4,
  cellSize = DEFAULT_CELL_SIZE,
  padding = DEFAULT_PADDING,
} = {}) => {
  if (!isFiniteNumber(pageWidth) || !isFiniteNumber(pageHeight) || pageWidth <= 0 || pageHeight <= 0) return [];

  const buckets = new Map();
  for (const asset of assets) {
    const text = typeof asset?.text_content === "string" ? asset.text_content.trim() : "";
    const box = asset?.bounding_box;
    if (!text || !box) continue;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width) || 0;
    const height = Number(box.height) || 0;
    if (![x, y].every(isFiniteNumber)) continue;
    const key = `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
    const bucket = buckets.get(key) || { count: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    bucket.count += 1;
    bucket.minX = Math.min(bucket.minX, x);
    bucket.minY = Math.min(bucket.minY, y);
    bucket.maxX = Math.max(bucket.maxX, x + width);
    bucket.maxY = Math.max(bucket.maxY, y + height);
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, maxRegions))
    .map((bucket) => {
      const x0 = clamp(bucket.minX - padding, 0, pageWidth);
      const y0 = clamp(bucket.minY - padding, 0, pageHeight);
      const x1 = clamp(bucket.maxX + padding, 0, pageWidth);
      const y1 = clamp(bucket.maxY + padding, 0, pageHeight);
      return { rect: { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }, itemCount: bucket.count };
    })
    // Densest first -- if fewer than maxRegions buckets exist, the caller
    // simply gets fewer (real) crops rather than a padded/duplicated list.
    .sort((a, b) => b.itemCount - a.itemCount);
};

// Reserve context for sparse equipment/location labels, circuits, and notes
// BEFORE filling remaining slots by text density. Canonical PDF coordinates.
export const computeComplementaryCropRegions = ({ assets = [], pageWidth, pageHeight, maxRegions = 7 } = {}) => {
  if (!(pageWidth > 0 && pageHeight > 0)) return [];
  const textAssets = assets.filter(a => a.asset_type === 'Text' && a.bounding_box && a.text_content);
  const selected = [];
  const add = (rect, purpose) => {
    const x = clamp(rect.x, 0, pageWidth), y = clamp(rect.y, 0, pageHeight);
    const width = Math.min(rect.width, pageWidth - x), height = Math.min(rect.height, pageHeight - y);
    if (!(width > 0 && height > 0) || selected.length >= maxRegions) return;
    const overlaps = (a,b) => Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    if (selected.some(r => overlaps(r.rect,{x,y,width,height}) / Math.min(r.rect.width*r.rect.height,width*height) > .85)) return;
    selected.push({rect:{x,y,width,height},purpose,itemCount:textAssets.filter(a=>overlaps(a.bounding_box,{x,y,width,height})>0).length});
  };
  const families = [
    ['equipment / location', /CONTROL\s*PANEL|F\.?A\.?C\.?P|\b(?:AT|IN)\s+.*(?:ROOM|FLOOR|BUILDING)|WORKSTATION/i],
    ['circuit / status', /\bLOOP\s*[-\d]|NAC\s*LOOP|\bSPARE\b/i],
    ['notes / references', /GENERAL NOTES|FOR .*REFER|DWG\s*NO|NOT TO BE SCALED|SHEET TITLE/i],
  ];
  // One local cluster per family; nearby labels remain in the crop, while
  // distant note/title areas receive their own crop instead of a huge union.
  for (const [purpose,pattern] of families) {
    const hits = textAssets.filter(a=>pattern.test(a.text_content));
    const clusters=[];
    for (const hit of hits) {
      const b=hit.bounding_box;
      let cluster=clusters.find(c=>Math.abs(c.x-b.x)<320 && Math.abs(c.y-b.y)<320);
      if(!cluster){cluster={x:b.x,y:b.y,hits:[]};clusters.push(cluster);} cluster.hits.push(hit);
    }
    clusters.sort((a,b)=>b.hits.length-a.hits.length);
    for(const cluster of clusters.slice(0,purpose==='notes / references'?2:1)) {
      const boxes=cluster.hits.map(a=>a.bounding_box);
      const x=Math.max(0,Math.min(...boxes.map(b=>b.x))-95),y=Math.max(0,Math.min(...boxes.map(b=>b.y))-95);
      add({x,y,width:Math.max(...boxes.map(b=>b.x+b.width))+95-x,height:Math.max(...boxes.map(b=>b.y+b.height))+95-y},purpose);
    }
  }
  for(const region of computeDenseTextCropRegions({assets:textAssets,pageWidth,pageHeight,maxRegions:100,padding:95})) add(region.rect,'complementary detail');
  // Raster-only sheets still receive spatial coverage, without invented labels.
  if(!selected.length) for(const y of [0,pageHeight/2]) for(const x of [0,pageWidth/2]) add({x,y,width:pageWidth/2,height:pageHeight/2},'spatial coverage');
  return selected;
};
