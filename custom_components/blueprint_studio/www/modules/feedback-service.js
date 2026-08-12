/** FEEDBACK-SERVICE.JS | Shared notifications and asynchronous operation feedback. */
import { state, elements } from "./state.js";
import { t, tp } from './translations.js?v=2.5.270';

const activeNotifications = new Map();
const globalPendingMessages = [];
const NOTIFICATION_TYPES = new Set(["success", "error", "warning", "info"]);
const operationRecords = new Map();
const MAX_OPERATION_HISTORY = 24;
let operationClock = null;

function operationAnnouncer() {
  let announcer = document.getElementById("operation-announcer");
  if (announcer) return announcer;
  announcer = document.createElement("div");
  announcer.id = "operation-announcer";
  announcer.className = "ui-visually-hidden";
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");
  announcer.setAttribute("aria-atomic", "true");
  document.body.appendChild(announcer);
  return announcer;
}

function announceOperationTransition(label, status, message) {
  const announcer = operationAnnouncer();
  const statusLabel = t(`operations.status_${status === 'done' ? 'complete' : status === 'error' ? 'failed' : status}`);
  const summary = t('operations.card_label', { operation: label, status: statusLabel });
  announcer.textContent = [summary, normalizeMessage(message)].filter(Boolean).join('. ');
}

function normalizeMessage(message) {
  return String(message ?? "").replace(/\s+/g, " ").trim();
}

function normalizeDetail(message) {
  return String(message ?? "").replace(/\r\n?/g, "\n").trim();
}

function notificationIcon(type) {
  return {
    success: "done",
    error: "error_outline",
    warning: "warning_amber",
    info: "info",
  }[type] || "info";
}

function removeNotification(key, element) {
  if (activeNotifications.get(key) !== element) return;
  activeNotifications.delete(key);
  element.remove();
}

function toastContainer() {
  return elements.toastContainer?.isConnected
    ? elements.toastContainer
    : document.getElementById("toast-container");
}

function globalPendingElements() {
  return {
    overlay: elements.loadingOverlay?.isConnected
      ? elements.loadingOverlay
      : document.getElementById("loading-overlay"),
    text: elements.loadingText?.isConnected
      ? elements.loadingText
      : document.getElementById("loading-text"),
  };
}

export function notify(message, options = {}) {
  const type = NOTIFICATION_TYPES.has(options.type) ? options.type : "success";
  const action = options.action || null;
  let duration = Number.isFinite(options.duration) ? options.duration : 3000;
  if (!state.showToasts && type !== "error" && !action) return null;
  if (type === "error" && duration === 3000) duration = 0;

  const displayMessage = normalizeMessage(message);
  if (!displayMessage) return null;
  const key = options.key || `${type}:${displayMessage}`;
  if (activeNotifications.has(key)) return activeNotifications.get(key);

  const toast = document.createElement("div");
  toast.className = `ui-toast toast ${type}`;
  toast.dataset.toastKey = key;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const statusIcon = document.createElement("span");
  statusIcon.className = "ui-icon material-icons toast-status-icon";
  statusIcon.setAttribute("aria-hidden", "true");
  statusIcon.textContent = notificationIcon(type);
  toast.appendChild(statusIcon);

  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = displayMessage;
  toast.appendChild(text);

  let dismissTimer = null;
  if (type === "error" || displayMessage.length > 64) {
    toast.classList.add("toast--expandable");
    const expandButton = document.createElement("button");
    expandButton.className = "toast-expand-btn";
    expandButton.type = "button";
    expandButton.setAttribute("aria-label", t('notification.show_full'));
    expandButton.setAttribute("aria-expanded", "false");
    expandButton.title = t('notification.show_full_message');
    const expandIcon = document.createElement("span");
    expandIcon.className = "ui-icon material-icons";
    expandIcon.setAttribute("aria-hidden", "true");
    expandIcon.textContent = "more_horiz";
    expandButton.appendChild(expandIcon);
    const toggleExpanded = () => {
      const expanded = toast.classList.toggle("expanded");
      expandButton.setAttribute("aria-expanded", String(expanded));
      expandButton.setAttribute("aria-label", expanded ? t('notification.collapse') : t('notification.show_full'));
      expandButton.title = expanded ? t('notification.collapse_message') : t('notification.show_full_message');
      expandIcon.textContent = expanded ? "expand_less" : "more_horiz";
      if (expanded && dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
    };
    expandButton.addEventListener("click", toggleExpanded);
    text.addEventListener("click", toggleExpanded);
    toast.appendChild(expandButton);
  }

  if (action?.text && typeof action.callback === "function") {
    const actionButton = document.createElement("button");
    actionButton.className = "toast-action-btn";
    actionButton.type = "button";
    actionButton.textContent = action.text;
    actionButton.addEventListener("click", () => {
      action.callback();
      removeNotification(key, toast);
    });
    toast.appendChild(actionButton);
  }

  if (duration === 0) {
    const closeButton = document.createElement("button");
    closeButton.className = "toast-close-btn";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", t('notification.dismiss'));
    const closeIcon = document.createElement("span");
    closeIcon.className = "ui-icon material-icons toast-dismiss-icon";
    closeIcon.setAttribute("aria-hidden", "true");
    closeIcon.textContent = "close";
    closeButton.appendChild(closeIcon);
    closeButton.addEventListener("click", () => removeNotification(key, toast));
    toast.appendChild(closeButton);
  }

  const container = toastContainer();
  if (!container) return null;
  container.appendChild(toast);
  activeNotifications.set(key, toast);

  if (duration > 0) {
    dismissTimer = setTimeout(() => {
      toast.classList.add("dismissing");
      setTimeout(() => removeNotification(key, toast), 180);
    }, duration);
  }
  return toast;
}

export function showGlobalPending(message = "") {
  globalPendingMessages.push(normalizeMessage(message) || t('common.loading'));
  const { overlay, text } = globalPendingElements();
  if (text) text.textContent = globalPendingMessages.at(-1);
  overlay?.classList.add("visible");
}

export function hideGlobalPending() {
  globalPendingMessages.pop();
  const { overlay, text } = globalPendingElements();
  if (globalPendingMessages.length > 0) {
    if (text) text.textContent = globalPendingMessages.at(-1);
    return;
  }
  overlay?.classList.remove("visible");
}

export function setControlPending(control, pending) {
  if (!control) return;
  control.classList.toggle("loading", Boolean(pending));
  control.disabled = Boolean(pending);
  control.setAttribute("aria-busy", String(Boolean(pending)));
}

function ensureOperationStack() {
  let stack = document.getElementById("transfer-progress-stack");
  if (!stack) {
    stack = document.createElement("aside");
    stack.id = "transfer-progress-stack";
    stack.className = "operation-center transfer-progress-stack minimized";
    stack.setAttribute("role", "region");
    stack.setAttribute("aria-label", t('operations.title'));
    stack.innerHTML = `
      <div class="operation-center-header">
        <span class="ui-icon material-icons" aria-hidden="true">pending_actions</span>
        <strong>${t('operations.title')}</strong>
        <span class="operation-center-count" aria-live="polite" aria-atomic="true">${tp('operations.active_count', 0)}</span>
        <button type="button" class="ui-icon-button operation-center-clear" aria-label="${t('operations.clear_completed')}" title="${t('operations.clear_completed_short')}"><span class="ui-icon material-icons" aria-hidden="true">done_all</span></button>
        <button type="button" class="ui-icon-button operation-center-toggle" aria-label="${t('operations.expand')}" title="${t('operations.expand_short')}"><span class="ui-icon material-icons" aria-hidden="true">expand_less</span></button>
      </div>
      <div class="operation-center-list">
        <section class="operation-group operation-group-active" aria-labelledby="operation-active-heading">
          <h2 id="operation-active-heading" class="operation-group-heading">${t('operations.active')}</h2>
          <div class="operation-group-list"></div>
        </section>
        <section class="operation-group operation-group-recent" aria-labelledby="operation-recent-heading">
          <h2 id="operation-recent-heading" class="operation-group-heading">${t('operations.recent')}</h2>
          <div class="operation-group-list"></div>
        </section>
      </div>
    `;
    stack.querySelector(".operation-center-clear")?.addEventListener("click", clearCompletedOperations);
    stack.querySelector(".operation-center-toggle")?.addEventListener("click", () => {
      const minimized = stack.classList.toggle("minimized");
      const button = stack.querySelector(".operation-center-toggle");
      button?.setAttribute("aria-label", minimized ? t('operations.expand') : t('operations.minimize'));
      button?.setAttribute("title", minimized ? t('operations.expand_short') : t('operations.minimize_short'));
      const icon = button?.querySelector(".ui-icon");
      if (icon) icon.textContent = minimized ? "expand_less" : "expand_more";
    });
    document.body.appendChild(stack);
    syncOperationCenterVisibility();
  }
  return stack;
}

export function syncOperationCenterVisibility() {
  const stack = document.getElementById("transfer-progress-stack");
  if (!stack) return;
  const visible = state.showOperationCenter !== false;
  stack.hidden = !visible;
  document.body.classList.toggle("operation-center-open", visible);
}

function isTerminalOperation(status) {
  return ["done", "error", "cancelled"].includes(status);
}

function operationList(status = "running") {
  const stack = ensureOperationStack();
  const group = isTerminalOperation(status) ? ".operation-group-recent" : ".operation-group-active";
  return stack.querySelector(`${group} .operation-group-list`);
}

function formatElapsed(startedAt, endedAt = Date.now()) {
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  if (seconds < 60) return t('operations.elapsed_seconds', { seconds });
  const minutes = Math.floor(seconds / 60);
  return t('operations.elapsed_minutes', { minutes, seconds: seconds % 60 });
}

function refreshOperationCenter() {
  const stack = document.getElementById("transfer-progress-stack");
  if (!stack) return;
  const active = [...operationRecords.values()].filter(record => !["done", "error", "cancelled"].includes(record.status)).length;
  const count = stack.querySelector(".operation-center-count");
  const countText = active
    ? tp('operations.active_count', active)
    : tp('operations.recent_count', operationRecords.size);
  if (count && count.textContent !== countText) count.textContent = countText;
  stack.querySelector(".operation-center-clear")?.toggleAttribute("disabled", ![...operationRecords.values()].some(record => ["done", "error", "cancelled"].includes(record.status)));
  for (const group of stack.querySelectorAll(".operation-group")) {
    group.hidden = !group.querySelector(".zip-download-progress");
  }
  for (const [id, record] of operationRecords) {
    const elapsed = document.getElementById(`transfer-progress-${id}`)?.querySelector(".operation-elapsed");
    if (elapsed) elapsed.textContent = formatElapsed(record.startedAt, record.endedAt);
  }
}

function startOperationClock() {
  if (operationClock) return;
  operationClock = setInterval(refreshOperationCenter, 1000);
}

function trimOperationHistory() {
  if (operationRecords.size <= MAX_OPERATION_HISTORY) return;
  for (const [id, record] of operationRecords) {
    if (!isTerminalOperation(record.status)) continue;
    removeOperationFeedback(id);
    if (operationRecords.size <= MAX_OPERATION_HISTORY) break;
  }
}

function ensureOperationCard(id) {
  const cardId = `transfer-progress-${id}`;
  let card = document.getElementById(cardId);
  if (card) return card;
  card = document.createElement("div");
  card.id = cardId;
  card.className = "zip-download-progress";
  card.setAttribute("role", "group");
  card.innerHTML = `
    <div class="zip-progress-header">
      <span class="ui-icon material-icons zip-progress-icon" aria-hidden="true"></span>
      <span class="zip-progress-title"></span>
      <span class="operation-status"></span>
    </div>
    <div class="operation-scope"></div>
    <div class="zip-progress-track" role="progressbar"><div class="zip-progress-bar"></div></div>
    <div class="zip-progress-meta"></div>
    <div class="zip-progress-file"></div>
    <details class="operation-details"><summary>${t('operations.details')}</summary><div class="operation-details-text"></div></details>
    <div class="operation-footer"><span class="operation-elapsed">${t('operations.elapsed_seconds', { seconds: 0 })}</span><div class="operation-actions"></div></div>
  `;
  operationList().prepend(card);
  return card;
}

export function updateOperationFeedback(id, options = {}) {
  const card = ensureOperationCard(id);
  const icon = card.querySelector(".zip-progress-icon");
  const title = card.querySelector(".zip-progress-title");
  const track = card.querySelector(".zip-progress-track");
  const bar = card.querySelector(".zip-progress-bar");
  const meta = card.querySelector(".zip-progress-meta");
  const detail = card.querySelector(".zip-progress-file");
  const scope = card.querySelector(".operation-scope");
  const status = card.querySelector(".operation-status");
  const details = card.querySelector(".operation-details");
  const detailsText = card.querySelector(".operation-details-text");
  const actions = card.querySelector(".operation-actions");
  const percent = Number(options.percent);
  const determinate = Number.isFinite(percent);
  const previous = operationRecords.get(id);
  const nextStatus = options.status || "running";
  const terminal = isTerminalOperation(nextStatus);
  operationRecords.set(id, {
    startedAt: previous?.startedAt || Date.now(),
    endedAt: terminal ? previous?.endedAt || Date.now() : null,
    status: nextStatus,
    label: normalizeMessage(options.label) || previous?.label || t('operations.operation'),
    scope: normalizeMessage(options.scope) || previous?.scope || '',
    target: normalizeMessage(options.target) || previous?.target || '',
  });

  if (icon) icon.textContent = options.icon || "progress_activity";
  if (title) title.textContent = normalizeMessage(options.label) || t('operations.in_progress');
  if (meta) meta.textContent = normalizeMessage(options.message);
  if (detail) detail.textContent = normalizeMessage(options.detail);
  const fullDetail = normalizeDetail(options.failureDetail);
  if (details && detailsText) {
    details.hidden = !fullDetail;
    detailsText.textContent = fullDetail;
    if (!fullDetail) details.open = false;
  }
  if (scope) scope.textContent = [normalizeMessage(options.scope), normalizeMessage(options.target)].filter(Boolean).join(" -> ");
  if (status) status.textContent = t(`operations.status_${nextStatus === 'done' ? 'complete' : nextStatus === 'error' ? 'failed' : nextStatus}`);
  card.dataset.status = nextStatus;
  card.setAttribute("aria-label", t('operations.card_label', {
    operation: title?.textContent || t('operations.operation'),
    status: meta?.textContent || t('operations.in_progress_short'),
  }));
  if (terminal && previous?.status !== nextStatus) {
    announceOperationTransition(title?.textContent || t('operations.operation'), nextStatus, meta?.textContent);
  }

  if (track && bar) {
    track.hidden = terminal;
    bar.classList.toggle("determinate", determinate);
    bar.style.width = determinate ? `${Math.max(0, Math.min(100, percent))}%` : "";
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    if (determinate) track.setAttribute("aria-valuenow", String(Math.round(percent)));
    else track.removeAttribute("aria-valuenow");
  }
  const destination = operationList(nextStatus);
  if (destination && card.parentElement !== destination) destination.prepend(card);
  if (actions) {
    actions.replaceChildren();
    for (const action of Array.isArray(options.actions) ? options.actions : []) {
      if (!action?.label || typeof action.callback !== "function") continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `operation-action${action.primary ? " primary" : ""}`;
      button.setAttribute("aria-label", action.ariaLabel || action.label);
      button.title = action.title || action.label;
      if (action.icon) {
        const actionIcon = document.createElement("span");
        actionIcon.className = "ui-icon material-icons";
        actionIcon.setAttribute("aria-hidden", "true");
        actionIcon.textContent = action.icon;
        button.appendChild(actionIcon);
      }
      const actionLabel = document.createElement("span");
      actionLabel.textContent = action.label;
      button.appendChild(actionLabel);
      button.addEventListener("click", () => {
        Promise.resolve(action.callback()).catch(error => {
          console.error(`[BPS] Operation action failed: ${action.label}`, error);
        });
      });
      actions.appendChild(button);
    }
  }
  refreshOperationCenter();
  startOperationClock();
  trimOperationHistory();
  return card;
}

export function startOperationFeedback(options = {}) {
  const id = options.id
    || window.crypto?.randomUUID?.()
    || `operation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const base = {
    label: options.label,
    icon: options.icon,
    scope: options.scope,
    target: options.target,
  };
  const openAction = typeof options.open === "function"
    ? { label: options.openLabel || t('operations.open'), icon: options.openIcon || "open_in_new", callback: options.open }
    : null;
  const retryAction = typeof options.retry === "function"
    ? { label: options.retryLabel || t('common.retry'), icon: "refresh", primary: true, callback: options.retry }
    : null;
  const runningActions = Array.isArray(options.runningActions) ? options.runningActions : [];
  const terminalActions = includeRetry => [includeRetry ? retryAction : null, openAction].filter(Boolean);

  updateOperationFeedback(id, {
    ...base,
    status: "running",
    message: options.message || t('operations.in_progress_ellipsis'),
    actions: runningActions,
  });

  return {
    id,
    update(next = {}) {
      updateOperationFeedback(id, { ...base, status: "running", actions: runningActions, ...next });
    },
    finish(message = t('operations.complete'), next = {}) {
      updateOperationFeedback(id, { ...base, icon: "check_circle", status: "done", message, actions: terminalActions(false), ...next });
    },
    fail(message = t('operations.failed'), failureDetail = message, next = {}) {
      updateOperationFeedback(id, { ...base, icon: "error", status: "error", message, failureDetail, actions: terminalActions(true), ...next });
    },
    cancel(message = t('operations.cancelled'), next = {}) {
      updateOperationFeedback(id, {
        ...base,
        icon: "cancel",
        status: "cancelled",
        message,
        actions: terminalActions(true),
        ...next,
      });
    },
  };
}

export function removeOperationFeedback(id) {
  operationRecords.delete(id);
  document.getElementById(`transfer-progress-${id}`)?.remove();
  const stack = document.getElementById("transfer-progress-stack");
  if (stack && operationRecords.size === 0) {
    stack.remove();
    document.body.classList.remove("operation-center-open");
  }
  if (operationRecords.size === 0 && operationClock) {
    clearInterval(operationClock);
    operationClock = null;
  }
  refreshOperationCenter();
}

export function clearCompletedOperations() {
  for (const [id, record] of [...operationRecords]) {
    if (isTerminalOperation(record.status)) removeOperationFeedback(id);
  }
}

export function getActiveOperationSummary() {
  return [...operationRecords.values()]
    .filter(record => !isTerminalOperation(record.status))
    .map(record => ({
      label: record.label,
      scope: record.scope,
      target: record.target,
    }));
}
