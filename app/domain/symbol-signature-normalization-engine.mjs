export const SYMBOL_SIGNATURE_ENGINE_VERSION =
  "symbol-signature-normalization-1.0.1";
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
  round = (v, p = 4) => Math.round(Number(v || 0) * 10 ** p) / 10 ** p,
  flat = (v) =>
    Array.isArray(v) ? v.flatMap(flat) : typeof v === "number" ? [v] : [];
const topology = (geometry) => {
  const fragments = Array.isArray(geometry) ? geometry : [geometry],
    closedPaths = fragments.filter((f) => {
      const c = flat(f.coordinates || []);
      return (
        c.length > 5 && c[0] === c[c.length - 3] && c[1] === c[c.length - 2]
      );
    }).length,
    filled = fragments.some((f) => Array.isArray(f.fill) && f.fill.length > 0),
    boxes = fragments.map((f) => f.boundingBox).filter(Boolean),
    outer = boxes.length
      ? {
          x: Math.min(...boxes.map((b) => b.x)),
          y: Math.min(...boxes.map((b) => b.y)),
          x2: Math.max(...boxes.map((b) => b.x + b.width)),
          y2: Math.max(...boxes.map((b) => b.y + b.height)),
        }
      : null;
  return {
    componentCount: fragments.length,
    closedPaths,
    filled,
    holeCount: !filled && closedPaths > 0 ? 1 : 0,
    outer,
  };
};
export const normalizeGeometry = async (geometry, rawSignature) => {
  const t = topology(geometry),
    b = t.outer || { x: 0, y: 0, x2: 1, y2: 1 },
    w = Math.max(0.0001, b.x2 - b.x),
    h = Math.max(0.0001, b.y2 - b.y),
    fragments = (Array.isArray(geometry) ? geometry : [geometry])
      .map((f) => {
        const box = f.boundingBox || b;
        return {
          box: [
            round((box.x - b.x) / w),
            round((box.y - b.y) / h),
            round(box.width / w),
            round(box.height / h),
          ],
          operators: [...(f.operators || [])].sort((a, b) => a - b),
          strokeWidth: 1,
          filled: Array.isArray(f.fill) && f.fill.length > 0,
        };
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    normalized = {
      aspect: round(Math.max(w / h, h / w)),
      componentCount: t.componentCount,
      closedPaths: t.closedPaths,
      holeCount: t.holeCount,
      filled: t.filled,
      fragments,
    };
  return {
    rawSignature,
    normalized,
    normalizedSignature: `normalized:${await digest(normalized)}`,
  };
};
export const compareNormalized = (approved, occurrence) => {
  const a = approved.normalized,
    o = occurrence.normalized,
    differences = [];
  if (a.filled !== o.filled)
    differences.push("Filled versus hollow topology differs");
  if (a.holeCount !== o.holeCount) differences.push("Hole count differs");
  if (a.componentCount !== o.componentCount)
    differences.push("Distinct component topology differs");
  if (a.closedPaths !== o.closedPaths)
    differences.push("Closed-path topology differs");
  const aspectDelta = Math.abs(a.aspect - o.aspect);
  if (aspectDelta > 0.12)
    differences.push("Shape ratio exceeds controlled tolerance");
  const topologyBlocked = differences.some((v) =>
      /topology|Filled|Hole|component/i.test(v),
    ),
    score = topologyBlocked
      ? 0
      : Math.max(0, Math.round(100 - aspectDelta * 100));
  return {
    eligible: !topologyBlocked && score >= 82,
    similarityScore: score,
    matchingBasis:
      "Translation invariant; controlled scale and shape-ratio normalization; fragment order independent; stroke width normalized",
    geometryDifferences: differences,
    confidence: topologyBlocked ? 0 : score,
  };
};
