export const createQuotationFingerprint = (snapshot) => {
  const payload = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `QF-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};
