const baseUrl = process.env.AI_SMOKE_BASE_URL || "http://127.0.0.1:5173";
const projectId = process.env.AI_SMOKE_PROJECT_ID || "project_0a49e924-1c3d-4cfb-b48a-02a66c00200c";
const boqItemId = process.env.AI_SMOKE_BOQ_ITEM_ID || "boqitem_320c1a86-0155-4afc-af91-29066071c3a4";

const requestJson = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${path}: ${JSON.stringify(value)}`);
  return value;
};
const readItem = async () => {
  const value = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/estimator-understanding`);
  return value.items.find((item) => item.boqItemId === boqItemId) || null;
};
const unsafeKeys = [];
const scan = (value, path = "") => {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (/(^|_)(product_?id|approval|approved|price|unit_?cost|selling|quotation)(_|$)/i.test(key)) unsafeKeys.push(next);
    scan(child, next);
  }
};

const runPath = `/api/boq-items/${encodeURIComponent(boqItemId)}/estimator-understanding/retry`;
const firstRun = await requestJson(runPath, { method: "POST" });
if (firstRun.status === "AI_UNAVAILABLE") throw new Error("Real Workers AI binding is unavailable.");
if (!firstRun.items?.[0] || !["COMPLETED", "NEEDS_REVIEW"].includes(firstRun.items[0].status)) throw new Error(`Real interpretation failed: ${JSON.stringify(firstRun)}`);
const persistedBefore = await readItem();
if (!persistedBefore?.interpretation) throw new Error("Interpretation was not persisted through the application API.");
scan(persistedBefore.interpretation);
if (unsafeKeys.length) throw new Error(`Interpretation crossed its authority boundary: ${unsafeKeys.join(", ")}`);
const readiness = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/estimator-readiness`);
const readinessItem = readiness.items?.find((item) => item.boqItemId === boqItemId);
if (!readinessItem?.understanding || readinessItem.understanding.status === "AI_UNAVAILABLE") throw new Error("Estimator Readiness did not consume the persisted interpretation.");
const replay = await requestJson(runPath, { method: "POST" });
const persistedAfter = await readItem();
if (persistedAfter.version !== persistedBefore.version) throw new Error(`Idempotency failed: v${persistedBefore.version} became v${persistedAfter.version}.`);

console.log(JSON.stringify({
  smoke: "REAL_PROVIDER_PASSED",
  projectId,
  boqItemId,
  provider: persistedAfter.provider,
  model: persistedAfter.model,
  status: persistedAfter.status,
  version: persistedAfter.version,
  interpretation: persistedAfter.interpretation,
  estimatorReadiness: readinessItem,
  replayReused: replay.summary?.reused === 1,
}, null, 2));
