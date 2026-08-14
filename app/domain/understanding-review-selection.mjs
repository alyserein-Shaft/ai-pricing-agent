export function resolveUnderstandingReviewSelection(items, requestedKey) {
  const visible = Array.isArray(items) ? items.filter((item) => typeof item?.reviewKey === "string" && item.reviewKey) : [];
  if (requestedKey && visible.some((item) => item.reviewKey === requestedKey)) return requestedKey;
  return visible[0]?.reviewKey || "";
}

export function understandingReviewIdentitiesMatch(selectedKey, queueItem, detail) {
  return Boolean(
    selectedKey
    && queueItem?.reviewKey === selectedKey
    && detail?.reviewKey === selectedKey
    && detail?.authoritativeEvidence?.reviewKey === selectedKey
    && typeof detail?.selectionAuthority === "string"
    && detail.selectionAuthority.length === 64,
  );
}

export function shouldAcceptUnderstandingReviewDetail(requestedKey, currentKey, queueItem, detail) {
  return requestedKey === currentKey && understandingReviewIdentitiesMatch(currentKey, queueItem, detail);
}
