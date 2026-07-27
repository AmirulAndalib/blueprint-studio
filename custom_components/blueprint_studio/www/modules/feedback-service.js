/** FEEDBACK-SERVICE.JS | Shared notifications and asynchronous operation feedback. */
import { state, elements } from "./state.js";

const activeNotifications = new Map();
const globalPendingMessages = [];
const NOTIFICATION_TYPES = new Set(["success", "error", "warning", "info"]);

function normalizeMessage(message) {
  return String(message ?? "").replace(/\s+/g, " ").trim();
}

function compactMessage(message) {
  const text = normalizeMessage(message);
  return text.length <= 64 ? text : `${text.slice(0, 61)}...`;
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

  const displayMessage = compactMessage(message);
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
    closeButton.setAttribute("aria-label", "Dismiss notification");
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
    setTimeout(() => {
      toast.classList.add("dismissing");
      setTimeout(() => removeNotification(key, toast), 180);
    }, duration);
  }
  return toast;
}

export function showGlobalPending(message = "Loading...") {
  globalPendingMessages.push(normalizeMessage(message) || "Loading...");
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
    stack = document.createElement("div");
    stack.id = "transfer-progress-stack";
    stack.className = "transfer-progress-stack";
    stack.setAttribute("role", "region");
    stack.setAttribute("aria-label", "Active operations");
    document.body.appendChild(stack);
  }
  return stack;
}

function ensureOperationCard(id) {
  const cardId = `transfer-progress-${id}`;
  let card = document.getElementById(cardId);
  if (card) return card;
  card = document.createElement("div");
  card.id = cardId;
  card.className = "zip-download-progress";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.innerHTML = `
    <div class="zip-progress-header">
      <span class="ui-icon material-icons zip-progress-icon" aria-hidden="true"></span>
      <span class="zip-progress-title"></span>
    </div>
    <div class="zip-progress-track" role="progressbar"><div class="zip-progress-bar"></div></div>
    <div class="zip-progress-meta"></div>
    <div class="zip-progress-file"></div>
  `;
  ensureOperationStack().appendChild(card);
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
  const percent = Number(options.percent);
  const determinate = Number.isFinite(percent);

  if (icon) icon.textContent = options.icon || "progress_activity";
  if (title) title.textContent = normalizeMessage(options.label) || "Operation in progress";
  if (meta) meta.textContent = normalizeMessage(options.message);
  if (detail) detail.textContent = normalizeMessage(options.detail);
  card.dataset.status = options.status || "running";
  card.setAttribute("aria-label", `${title?.textContent || "Operation"}: ${meta?.textContent || "In progress"}`);

  if (track && bar) {
    bar.classList.toggle("determinate", determinate);
    bar.style.width = determinate ? `${Math.max(0, Math.min(100, percent))}%` : "";
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    if (determinate) track.setAttribute("aria-valuenow", String(Math.round(percent)));
    else track.removeAttribute("aria-valuenow");
  }
  return card;
}

export function removeOperationFeedback(id) {
  document.getElementById(`transfer-progress-${id}`)?.remove();
  const stack = document.getElementById("transfer-progress-stack");
  if (stack && stack.children.length === 0) stack.remove();
}
