/** Shared bounds for user-visible histories retained in memory or settings. */

export const MAX_AI_CHAT_HISTORY = 20;
export const MAX_NAVIGATION_HISTORY = 100;

export function keepLatestHistory(items, limit) {
  if (!Array.isArray(items) || limit <= 0) return [];
  return items.slice(-limit);
}

export function appendBoundedHistory(items, value, limit) {
  const history = Array.isArray(items) ? items : [];
  history.push(value);
  if (history.length > limit) history.splice(0, history.length - limit);
  return history;
}
