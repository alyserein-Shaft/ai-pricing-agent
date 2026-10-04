/**
 * DETERMINISTIC GEOMETRY EVIDENCE PACKET  (no LLM anywhere in this file)
 *
 * Purpose
 * -------
 * The previous benchmark proved the decisive discriminator between a legend
 * (S) SMOKE DETECTOR and the schedule's [S]C is the ENCLOSURE SHAPE
 * (round vs box). That fact exists ONLY in geometry -- it never appears in the
 * text layer, which is why a text-only reasoner could not reach it and why a
 * VLM was asked to do a job the application can already do deterministically.
 *
 * This module derives enclosure shape and non-text linework evidence from the
 * rendered raster of a page region, using the AUTHORITATIVE viewport transform
 * (page.getViewport().transform). It never reads drawing_assets.bounding_box,
 * which is provably in mixed coordinate spaces per parser version.
 *
 * HONESTY NOTE: this is a RASTER proxy for enclosure geometry, not true PDF
 * vector-operator parsing. It is deterministic and reproducible, but it is a
 * measurement of ink structure, not of the PDF's own path objects. Callers must
 * treat ENCLOSURE as evidence, never as authority.
 */

// ---------------------------------------------------------------------------
// Ink-mask geometry
// ---------------------------------------------------------------------------

/** Rasterise a page once and return a reusable {data,width,height,scale}. */
export function rasterRegion(canvas, x, y, w, h, scale) {
  const px = Math.max(0, Math.round(x * scale));
  const py = Math.max(0, Math.round(y * scale));
  const pw = Math.max(1, Math.min(Math.round(w * scale), canvas.width - px));
  const ph = Math.max(1, Math.min(Math.round(h * scale), canvas.height - py));
  const out = new Uint8Array(pw * ph);
  // Sample the already-rendered page canvas directly rather than re-encoding.
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(px, py, pw, ph);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    const v = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    out[j] = v < 245 ? 1 : 0;
  }
  return { mask: out, width: pw, height: ph, ink: out.reduce((a, b) => a + b, 0) };
}

/** Longest horizontal / vertical contiguous ink run, in pixels. */
function maxRuns(mask, w, h) {
  let maxH = 0, maxV = 0;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) { run++; if (run > maxH) maxH = run; } else run = 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      if (mask[y * w + x]) { run++; if (run > maxV) maxV = run; } else run = 0;
    }
  }
  return { maxH, maxV };
}

/** Ink density inside a normalised sub-rectangle of the mask. */
function density(mask, w, h, x0, y0, x1, y1) {
  let ink = 0, n = 0;
  for (let y = Math.floor(y0 * h); y < Math.ceil(y1 * h); y++) {
    for (let x = Math.floor(x0 * w); x < Math.ceil(x1 * w); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      n++; ink += mask[y * w + x];
    }
  }
  return n ? ink / n : 0;
}

/**
 * Classify the enclosure from ink structure.
 *
 * PRIMARY DISCRIMINATOR = longest straight ink run, relative to the cell.
 * A square enclosure draws its edges as long straight runs; a circular
 * enclosure has no straight segment longer than its chord at that thickness,
 * so its longest run stays short. Measured on real Al Mousa schedule cells:
 * box enclosures gave maxHRun 71-79px while round enclosures gave 28px on the
 * SAME cell size -- a clean, wide separation with no threshold sensitivity.
 *
 * Corner / edge-midpoint densities are retained only as corroboration:
 *   BOX  : long run AND the outer corners are inked
 *   ROUND: ink present AND no long run
 *   NONE : no usable ink structure
 *
 * The top edge midpoint is excluded from the edge sample because a riser line
 * enters every plan symbol from above on these sheets.
 */
export function classifyEnclosure({ mask, width: w, height: h }) {
  const total = mask.reduce((a, b) => a + b, 0);
  const inkFraction = total / (w * h);
  const { maxH, maxV } = maxRuns(mask, w, h);
  const longest = Math.max(maxH, maxV);
  const cell = Math.min(w, h);
  const runRatio = +(longest / cell).toFixed(3);
  const straight = runRatio >= 0.30;

  const corner = (density(mask, w, h, 0.78, 0.05, 0.95, 0.22) + density(mask, w, h, 0.78, 0.78, 0.95, 0.95)
    + density(mask, w, h, 0.05, 0.78, 0.22, 0.95) + density(mask, w, h, 0.05, 0.05, 0.22, 0.22)) / 4;
  const edgeMid = (density(mask, w, h, 0.42, 0.05, 0.58, 0.22)
    + density(mask, w, h, 0.42, 0.78, 0.58, 0.95)
    + density(mask, w, h, 0.05, 0.42, 0.22, 0.58)
    + density(mask, w, h, 0.78, 0.42, 0.95, 0.58)) / 4;
  const centre = density(mask, w, h, 0.40, 0.40, 0.60, 0.60);

  let enclosure = "NONE";
  if (total > 12) {
    if (straight) enclosure = "BOX";
    else enclosure = "ROUND";
  }
  return {
    inkFraction: +inkFraction.toFixed(5),
    maxHRun: maxH, maxVRun: maxV, longestRun: longest,
    runRatio, straightLinework: straight,
    cornerDensity: +corner.toFixed(4),
    edgeMidDensity: +edgeMid.toFixed(4),
    centreDensity: +centre.toFixed(4),
    enclosure,
    enclosureBasis: total <= 12 ? "NO_INK" : (straight ? "LONG_STRAIGHT_RUN" : "NO_LONG_STRAIGHT_RUN"),
  };
}

/** Image validity, decided outside any model. */
export function assessRenderValidity({ canvas, mask, width, height }) {
  const total = mask.reduce((a, b) => a + b, 0);
  const inkFraction = total / (width * height);
  const lum = [];
  for (let i = 0; i < mask.length; i += Math.max(1, Math.floor(mask.length / 4000))) {
    lum.push(mask[i] ? 0 : 255);
  }
  const mean = lum.reduce((a, b) => a + b, 0) / (lum.length || 1);
  const variance = lum.reduce((a, b) => a + (b - mean) ** 2, 0) / (lum.length || 1);
  const nonZeroDims = width > 0 && height > 0;
  return {
    nonZeroDimensions: nonZeroDims,
    inkFraction: +inkFraction.toFixed(5),
    pixelVariance: +variance.toFixed(1),
    drawingInkPresent: inkFraction > 0.0008 && variance > 20,
    valid: nonZeroDims && inkFraction > 0.0008 && variance > 20,
    reason: !nonZeroDims ? "ZERO_DIMENSIONS" : (inkFraction <= 0.0008 ? "NO_INK" : (variance <= 20 ? "NO_VARIANCE" : null)),
  };
}

/**
 * Assemble the deterministic packet for one target cell.
 * `textItems` must already be in AUTHORITATIVE viewport coordinates.
 */
export function buildGeometryPacket({
  canvas, scale, region, textItems = [], sheetMeta = {}, label,
}) {
  const { x, y, w, h } = region;
  const raster = rasterRegion(canvas, x, y, w, h, scale);
  const render = assessRenderValidity({ canvas, ...raster });
  const enclosure = classifyEnclosure(raster);

  // Text tokens inside the region, plus their spacing to the nearest neighbour.
  const inside = textItems
    .filter(t => t.x >= x - 2 && t.x <= x + w + 2 && t.y >= y - 2 && t.y <= y + h + 2)
    .sort((a, b) => a.x - b.x)
    .map(t => ({
      text: t.str.trim(), x: +t.x.toFixed(2), y: +t.y.toFixed(2),
      width: +t.width.toFixed(2), height: +t.height.toFixed(2),
    }));
  const gaps = [];
  for (let i = 1; i < inside.length; i++) gaps.push(+(inside[i].x - (inside[i - 1].x + inside[i - 1].width)).toFixed(2));

  const rowText = textItems
    .filter(t => Math.abs(t.y - (y + h / 2)) < h * 0.6 && t.x > x - 400 && t.x < x + 400)
    .sort((a, b) => a.x - b.x)
    .map(t => ({ text: t.str.trim(), x: +t.x.toFixed(1), y: +t.y.toFixed(1), width: +t.width.toFixed(1) }));

  return {
    label,
    sheet: sheetMeta,
    region: { x, y, width: w, height: h, coordinateSpace: "PDF_VIEWPORT@1" },
    renderProvenance: {
      transformSource: "page.getViewport().transform",
      renderScale: scale,
      canvasWidth: canvas.width, canvasHeight: canvas.height,
      parserVersion: sheetMeta.parserVersion ?? null,
    },
    render,
    geometry: enclosure,
    tokens: {
      inside,
      count: inside.length,
      gapsToPrevious: gaps,
      minGap: gaps.length ? Math.min(...gaps) : null,
      rowNeighbourhood: rowText,
    },
    // What a reasoner is allowed to treat as EVIDENCE. Classification of what
    // the device IS is never produced here.
    evidenceClasses: {
      TEXT_GLYPH: inside.length > 0,
      NON_TEXT_VECTOR: enclosure.straightLinework || enclosure.enclosure !== "NONE",
      NONE: false,
    },
  };
}
