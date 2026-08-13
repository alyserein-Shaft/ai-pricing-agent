const COMPLETE_STATUSES = new Set(["complete", "completed", "approved"]);
const DANGER_STATUSES = new Set(["blocked", "failed"]);

export const HOME_ACTION_SUMMARY_LIMIT = 6;

export function projectProgressTone({ progress = 0, status = "" } = {}) {
  const normalizedStatus = String(status).trim().toLowerCase();
  if (DANGER_STATUSES.has(normalizedStatus)) return "danger";
  if (Number(progress) === 100 && COMPLETE_STATUSES.has(normalizedStatus)) return "success";
  return "primary";
}

export function homeActionQueuePresentation(actions = [], expanded = false) {
  const normalizedActions = Array.isArray(actions) ? actions : [];
  return {
    total: normalizedActions.length,
    visible: expanded
      ? normalizedActions
      : normalizedActions.slice(0, HOME_ACTION_SUMMARY_LIMIT),
    hasMore: normalizedActions.length > HOME_ACTION_SUMMARY_LIMIT,
  };
}
