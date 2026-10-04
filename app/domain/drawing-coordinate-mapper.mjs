// AUTOMATIC-ASSISTED DRAWING REVIEW v0 -- coordinate mapping.
//
// Every extraction engine in this codebase (Drawing Intake, Structural
// Parser, Symbol Recognition) already emits bounding boxes in ONE canonical
// convention: PAGE-LOCAL NORMALIZED PDF COORDINATES -- origin at the
// MediaBox's lower-left corner shifted to (0,0), x in [0, pageWidth], y in
// [0, pageHeight], y increasing UPWARD (PDF user-space orientation).
//
// PDF.js renders into a <canvas> using the opposite convention -- origin at
// the top-left, y increasing DOWNWARD, scaled by the caller's chosen zoom
// and (optionally) rotated for display. This file is the ONE place that
// performs that conversion. Nothing else in the Visual Review UI is allowed
// to bake coordinate math into CSS/inline styles directly -- every overlay
// box must be produced by mapCanonicalBoxToViewport below, so there is a
// single point of truth for the Y-flip/scale/rotation logic.
//
// Pure domain logic: no DOM, no React, no fetch. Safe to unit test directly.

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const normalizeRotation = (rotation) => {
  const value = ((Number(rotation) || 0) % 360 + 360) % 360;
  return [0, 90, 180, 270].includes(value) ? value : 0;
};

// box: {x, y, width, height} in canonical page-local normalized PDF
// coordinates (bottom-left origin, y-up). page: {pageWidth, pageHeight} --
// the SAME native page dimensions already persisted per-page by Drawing
// Intake (drawing_pages.width/height) and echoed by every other drawing
// engine. viewport: {scale, rotation} -- rotation is the clockwise degrees
// PDF.js is asked to rotate the page for display (0 by default).
//
// Returns {left, top, width, height} in CSS-pixel canvas space (top-left
// origin), matching the canvas PDF.js actually paints into at that same
// scale/rotation -- or null if the inputs cannot produce valid geometry
// (missing/non-finite page dimensions, non-positive page size). Never
// returns negative width/height for a well-formed input box; a box that
// falls outside the page is clamped to the page bounds rather than
// producing off-canvas negative geometry that would silently misrender.
export const mapCanonicalBoxToViewport = (box, page, viewport = {}) => {
  if (!box || !page) return null;
  const pageWidth = Number(page.pageWidth);
  const pageHeight = Number(page.pageHeight);
  if (!isFiniteNumber(pageWidth) || !isFiniteNumber(pageHeight) || pageWidth <= 0 || pageHeight <= 0)
    return null;

  const scale = isFiniteNumber(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  const rotation = normalizeRotation(viewport.rotation);

  const rawX = Number(box.x);
  const rawY = Number(box.y);
  const rawWidth = Number(box.width);
  const rawHeight = Number(box.height);
  if (![rawX, rawY, rawWidth, rawHeight].every(isFiniteNumber)) return null;

  // Clamp the canonical box to the page bounds first -- extraction engines
  // occasionally emit geometry that runs a hair past the MediaBox edge
  // (rounding, or a glyph advance width). Clamping here, in canonical
  // space, keeps every downstream screen-space number non-negative and
  // on-canvas without the caller having to know why. This is interval
  // INTERSECTION with the page rect, not independent per-edge clamping --
  // a box that has NO overlap with the page at all (real data does occur:
  // some upstream extraction items carry coordinates far outside the
  // MediaBox, e.g. from a nested/compound transform the extractor didn't
  // fully resolve) must be rejected outright (null) rather than collapsed
  // to a fake degenerate point at whichever corner the clamp lands on --
  // a single point at (0,0) would visually claim a location this item's
  // real geometry never actually occupies, which is exactly the kind of
  // silent misrepresentation Visual Review must not produce. Only a box
  // that genuinely intersects the page keeps its (clamped) sub-rectangle.
  const width0 = Math.max(rawWidth, 0);
  const height0 = Math.max(rawHeight, 0);
  const x0 = Math.max(rawX, 0);
  const x1 = Math.min(pageWidth, rawX + width0);
  const y0 = Math.max(rawY, 0);
  const y1 = Math.min(pageHeight, rawY + height0);
  if (x1 <= x0 || y1 <= y0) return null;
  const x = x0;
  const width = x1 - x0;
  const y = y0;
  const height = y1 - y0;

  // Step 1: canonical (bottom-left, y-up) -> unrotated top-left pixel space
  // at this scale. This is the plain Y-flip every PDF.js viewport applies
  // even before any page-rotation is layered on.
  const scaledPageWidth = pageWidth * scale;
  const scaledPageHeight = pageHeight * scale;
  const ux = x * scale;
  const uy = (pageHeight - y - height) * scale;
  const uw = width * scale;
  const uh = height * scale;

  // Step 2: apply page rotation (clockwise degrees), matching the same
  // `rotation` value passed to PDF.js's page.getViewport(). 0/180 keep the
  // canvas's width/height as pageWidth*scale/pageHeight*scale; 90/270 swap
  // them, exactly as PDF.js's own viewport does.
  switch (rotation) {
    case 90:
      return { left: scaledPageHeight - uy - uh, top: ux, width: uh, height: uw };
    case 180:
      return { left: scaledPageWidth - ux - uw, top: scaledPageHeight - uy - uh, width: uw, height: uh };
    case 270:
      return { left: uy, top: scaledPageWidth - ux - uw, width: uh, height: uw };
    default:
      return { left: ux, top: uy, width: uw, height: uh };
  }
};

// Exact inverse of mapCanonicalBoxToViewport. `box` uses the viewport/canvas
// convention returned by the forward mapper: {left, top, width, height},
// top-left origin and y increasing downward. Inputs are intersected with the
// rotated viewport bounds before inversion, mirroring the forward mapper's
// canonical-space intersection behavior. A wholly off-canvas or zero-area
// box returns null rather than being collapsed to a fictitious page edge.
export const mapViewportBoxToCanonical = (box, page, viewport = {}) => {
  if (!box || !page) return null;
  const pageWidth = Number(page.pageWidth);
  const pageHeight = Number(page.pageHeight);
  if (!isFiniteNumber(pageWidth) || !isFiniteNumber(pageHeight) || pageWidth <= 0 || pageHeight <= 0)
    return null;

  const scale = isFiniteNumber(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  const rotation = normalizeRotation(viewport.rotation);
  const rawLeft = Number(box.left);
  const rawTop = Number(box.top);
  const rawWidth = Number(box.width);
  const rawHeight = Number(box.height);
  if (![rawLeft, rawTop, rawWidth, rawHeight].every(isFiniteNumber)) return null;

  const viewportSize = viewportPixelSize(page, { scale, rotation });
  const left0 = Math.max(rawLeft, 0);
  const left1 = Math.min(viewportSize.width, rawLeft + Math.max(rawWidth, 0));
  const top0 = Math.max(rawTop, 0);
  const top1 = Math.min(viewportSize.height, rawTop + Math.max(rawHeight, 0));
  if (left1 <= left0 || top1 <= top0) return null;
  const left = left0;
  const top = top0;
  const width = left1 - left0;
  const height = top1 - top0;
  const scaledPageWidth = pageWidth * scale;
  const scaledPageHeight = pageHeight * scale;

  let ux;
  let uy;
  let uw;
  let uh;
  switch (rotation) {
    case 90:
      ux = top;
      uy = scaledPageHeight - left - width;
      uw = height;
      uh = width;
      break;
    case 180:
      ux = scaledPageWidth - left - width;
      uy = scaledPageHeight - top - height;
      uw = width;
      uh = height;
      break;
    case 270:
      ux = scaledPageWidth - top - height;
      uy = left;
      uw = height;
      uh = width;
      break;
    default:
      ux = left;
      uy = top;
      uw = width;
      uh = height;
  }

  const canonicalWidth = uw / scale;
  const canonicalHeight = uh / scale;
  return {
    x: ux / scale,
    y: pageHeight - uy / scale - canonicalHeight,
    width: canonicalWidth,
    height: canonicalHeight,
  };
};

// Convenience for sizing the <canvas>/overlay container itself to match
// what PDF.js's own page.getViewport({scale, rotation}) would report, so
// the caller never has to duplicate the width/height swap logic above.
export const viewportPixelSize = (page, viewport = {}) => {
  const pageWidth = Number(page?.pageWidth);
  const pageHeight = Number(page?.pageHeight);
  if (!isFiniteNumber(pageWidth) || !isFiniteNumber(pageHeight) || pageWidth <= 0 || pageHeight <= 0)
    return null;
  const scale = isFiniteNumber(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  const rotation = normalizeRotation(viewport.rotation);
  const swapped = rotation === 90 || rotation === 270;
  return {
    width: (swapped ? pageHeight : pageWidth) * scale,
    height: (swapped ? pageWidth : pageHeight) * scale,
  };
};

// Canonical (unrotated user space, origin-normalized, y-up) box of one pdf.js
// text item. pdf.js reports the baseline origin as transform[4..5], the advance
// `width` along the run direction (a,b) and the font `height` along the up
// direction (c,d) -- not x/y extents. This is the axis-aligned bounds of that
// run, the same corner-AABB convention vector shapes get from their CTM, so it
// is identical to {x:e,y:f,width,height} for 0-degree text and stays correct
// for text drawn at any angle (e.g. every run on a /Rotate 90 sheet).
export const textItemCanonicalBox=(transform,width,height,originX=0,originY=0)=>{const[a,b,c,d,e,f]=[0,1,2,3,4,5].map(i=>Number(transform?.[i]||0)),w=Number(width||0),h=Number(height||0),x=e-originX,y=f-originY,run=Math.hypot(a,b),up=Math.hypot(c,d);if(!run||!up)return{x,y,width:w,height:h};const rx=a/run*w,ry=b/run*w,ux=c/up*h,uy=d/up*h;return{x:x+Math.min(0,rx)+Math.min(0,ux),y:y+Math.min(0,ry)+Math.min(0,uy),width:Math.abs(rx)+Math.abs(ux),height:Math.abs(ry)+Math.abs(uy)};};
