export const SYMBOL_SEGMENTATION_ENGINE_VERSION =
  "symbol-cell-segmentation-1.0.0";
const digest = async (v) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(v)),
        ),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  boxOf = (fs) => {
    const xs = fs.flatMap((f) => [
        f.boundingBox.x,
        f.boundingBox.x + f.boundingBox.width,
      ]),
      ys = fs.flatMap((f) => [
        f.boundingBox.y,
        f.boundingBox.y + f.boundingBox.height,
      ]);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  },
  gap = (a, b) =>
    Math.hypot(
      Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
      Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0),
    );
export const segmentSymbolCell = async (candidate) => {
  const cell = candidate.symbolCellBBox,
    all = candidate.fragments.map((f, index) => ({
      ...f,
      originalIndex: index,
    })),
    inside = [],
    excluded = [];
  for (const f of all) {
    const b = f.boundingBox;
    if (
      b.x < cell.x ||
      b.y < cell.y ||
      b.x + b.width > cell.x + cell.width ||
      b.y + b.height > cell.y + cell.height
    ) {
      excluded.push({
        fragment: f,
        reason: "Crosses approved symbol-cell boundary",
      });
      continue;
    }
    if (
      (b.width > cell.width * 0.65 && b.height < 1.5) ||
      (b.height > cell.height * 0.65 && b.width < 1.5)
    ) {
      excluded.push({ fragment: f, reason: "Table border or leader" });
      continue;
    }
    if (b.width * b.height < 0.12) {
      excluded.push({ fragment: f, reason: "Background micro-fragment" });
      continue;
    }
    inside.push(f);
  }
  const parent = inside.map((_, i) => i),
    find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i]))),
    join = (a, b) => {
      a = find(a);
      b = find(b);
      if (a !== b) parent[b] = a;
    };
  for (let i = 0; i < inside.length; i++)
    for (let j = i + 1; j < inside.length; j++) {
      const a = inside[i],
        b = inside[j],
        style =
          JSON.stringify([a.stroke, a.fill]) ===
          JSON.stringify([b.stroke, b.fill]),
        continuity =
          JSON.stringify(a.transform) === JSON.stringify(b.transform);
      if (gap(a.boundingBox, b.boundingBox) <= 0.2 && (style || continuity))
        join(i, j);
    }
  const groups = new Map();
  inside.forEach((f, i) => {
    const root = find(i),
      list = groups.get(root) || [];
    list.push(f);
    groups.set(root, list);
  });
  const clusters = [];
  let n = 0;
  for (const fragments of groups.values()) {
    const bbox = boxOf(fragments),
      signature = `cluster:${await digest(fragments.map((f) => ({ o: f.operators, c: f.coordinates, t: f.transform, s: f.stroke, f: f.fill })))}`,
      repeated =
        fragments.filter(
          (f) => f.boundingBox.width < 12 && f.boundingBox.height < 12,
        ).length / fragments.length,
      circularCandidate =
        bbox.width >= 6 &&
        bbox.width <= 20 &&
        bbox.height >= 6 &&
        bbox.height <= 20 &&
        Math.abs(bbox.width / bbox.height - 1) <= 0.18,
      reason =
        fragments.length === 1 && bbox.width < 3 && bbox.height < 3
          ? "Likely text-outline fragment"
          : repeated > 0.85 && fragments.length > 15 && !circularCandidate
            ? "Likely text outlines or hatching"
            : null,
      confidence = reason ? 25 : Math.min(92, 55 + fragments.length * 3);
    clusters.push({
      clusterNumber: ++n,
      boundingBox: bbox,
      fragments,
      fragmentCount: fragments.length,
      geometrySignature: signature,
      detectionBasis:
        "Connected/overlapping paths with compatible stroke, fill, and transform inside one approved symbol cell",
      confidence,
      exclusionReason: reason,
    });
  }
  return {
    clusters: clusters.sort(
      (a, b) =>
        a.boundingBox.x - b.boundingBox.x || a.boundingBox.y - b.boundingBox.y,
    ),
    excluded,
    summary: {
      inputFragmentCount: all.length,
      insideFragmentCount: inside.length,
      clusterCount: clusters.length,
      excludedFragmentCount: excluded.length,
      preExcludedClusterCount: clusters.filter((c) => c.exclusionReason).length,
    },
  };
};
