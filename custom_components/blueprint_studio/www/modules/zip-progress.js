/** ZIP-PROGRESS.JS | Purpose: Non-blocking transfer progress UI. */
import { getAuthToken } from './api.js';
import { API_BASE } from './constants.js';
import { formatBytes } from './utils.js';

function createTransferProgressId(prefix) {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createZipProgressId() {
  return createTransferProgressId("zip");
}

function ensureProgressStack() {
  let stack = document.getElementById("transfer-progress-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "transfer-progress-stack";
    stack.className = "transfer-progress-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

function ensureProgressElements(progressId, label = null, icon = "folder_zip") {
  const cardId = `transfer-progress-${progressId}`;
  let wrapper = document.getElementById(cardId);
  if (!wrapper) {
    const stack = ensureProgressStack();
    wrapper = document.createElement("div");
    wrapper.id = cardId;
    wrapper.className = "zip-download-progress";
    wrapper.innerHTML = `
      <div class="zip-progress-header">
        <span class="material-icons zip-progress-icon"></span>
        <span class="zip-progress-title"></span>
      </div>
      <div class="zip-progress-track"><div class="zip-progress-bar"></div></div>
      <div class="zip-progress-meta">Preparing...</div>
      <div class="zip-progress-file"></div>
    `;
    stack.appendChild(wrapper);
  }
  const iconEl = wrapper.querySelector(".zip-progress-icon");
  if (iconEl) iconEl.textContent = icon;
  const title = wrapper.querySelector(".zip-progress-title");
  if (title && label !== null) title.textContent = label;
  return wrapper;
}

function removeProgressElements(progressId) {
  document.getElementById(`transfer-progress-${progressId}`)?.remove();
  const stack = document.getElementById("transfer-progress-stack");
  if (stack && stack.children.length === 0) stack.remove();
}

function updateProgressUi(progressId, progress, options = {}) {
  const wrapper = ensureProgressElements(progressId, options.label, options.icon);
  const meta = wrapper.querySelector(".zip-progress-meta");
  const file = wrapper.querySelector(".zip-progress-file");
  const bar = wrapper.querySelector(".zip-progress-bar");
  const filesDone = Number(progress?.files_done || 0);
  const totalFiles = Number(progress?.total_files || 0);
  const bytesDone = Number(progress?.bytes_done || 0);
  const bytesTotal = Number(progress?.bytes_total || 0);
  const percent = Number(progress?.percent);

  if (bar) {
    if (Number.isFinite(percent)) {
      bar.classList.add("determinate");
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    } else {
      bar.classList.remove("determinate");
      bar.style.width = "";
    }
  }

  if (meta) {
    if (progress?.message) {
      meta.textContent = progress.message;
    } else if (progress?.status === "pending") {
      meta.textContent = "Waiting for download to start...";
    } else if (progress?.status === "done") {
      const filePart = totalFiles ? `${totalFiles} file${totalFiles === 1 ? "" : "s"}` : `${filesDone} file${filesDone === 1 ? "" : "s"}`;
      meta.textContent = `Complete: ${filePart}, ${formatBytes(bytesDone)}`;
    } else if (progress?.status === "uploading") {
      const filePart = totalFiles ? `File ${filesDone} of ${totalFiles}` : "Uploading";
      const bytePart = bytesTotal ? `${formatBytes(bytesDone)} of ${formatBytes(bytesTotal)}` : formatBytes(bytesDone);
      meta.textContent = `${filePart} - ${bytePart}`;
    } else if (progress?.status === "error") {
      meta.textContent = "Transfer failed";
    } else {
      meta.textContent = `${filesDone} file${filesDone === 1 ? "" : "s"} processed, ${formatBytes(bytesDone)}`;
    }
  }

  if (file) {
    file.textContent = progress?.current_file ? progress.current_file : "";
  }
}

async function fetchProgress(progressId) {
  const token = await getAuthToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}?action=zip_progress&progress_id=${encodeURIComponent(progressId)}&_t=${Date.now()}`, {
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) return null;

  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

export function startZipProgress(progressId, label = "Preparing ZIP download...") {
  let stopped = false;
  let timeoutId = null;

  ensureProgressElements(progressId, label, "folder_zip");
  updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, { icon: "folder_zip" });

  async function poll() {
    if (stopped) return;
    try {
      const progress = await fetchProgress(progressId);
      if (!progress) {
        updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, { icon: "folder_zip" });
        timeoutId = setTimeout(poll, 800);
        return;
      }
      updateProgressUi(progressId, progress, { icon: "folder_zip" });
      if (progress.status === "done") {
        timeoutId = setTimeout(stop, 1200);
        return;
      }
      if (progress.status === "error") {
        timeoutId = setTimeout(stop, 1800);
        return;
      }
    } catch (_) {
      updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, { icon: "folder_zip" });
    }
    timeoutId = setTimeout(poll, 800);
  }

  function stop() {
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
    removeProgressElements(progressId);
  }

  timeoutId = setTimeout(poll, 500);
  return stop;
}

export function startUploadProgress({ label = "Uploading...", totalFiles = 1 } = {}) {
  const progressId = createTransferProgressId("upload");
  let timeoutId = null;

  ensureProgressElements(progressId, label, "upload_file");
  updateProgressUi(progressId, {
    status: "pending",
    files_done: 0,
    total_files: totalFiles,
    bytes_done: 0,
    bytes_total: 0,
    percent: 0,
    message: "Waiting for upload to start...",
  }, { icon: "upload_file" });

  function clearRemoveTimer() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function update({ fileName = "", fileIndex = 1, loaded = 0, total = 0, status = "uploading", message = "" } = {}) {
    clearRemoveTimer();
    const percent = total > 0 ? (loaded / total) * 100 : undefined;
    updateProgressUi(progressId, {
      status,
      files_done: fileIndex,
      total_files: totalFiles,
      bytes_done: loaded,
      bytes_total: total,
      percent,
      current_file: fileName,
      message,
    }, { icon: "upload_file" });
  }

  function finish(message = "Upload complete") {
    updateProgressUi(progressId, {
      status: "done",
      files_done: totalFiles,
      total_files: totalFiles,
      bytes_done: 0,
      percent: 100,
      message,
    }, { icon: "check_circle" });
    timeoutId = setTimeout(() => removeProgressElements(progressId), 1400);
  }

  function fail(message = "Upload failed") {
    updateProgressUi(progressId, {
      status: "error",
      files_done: 0,
      total_files: totalFiles,
      bytes_done: 0,
      message,
    }, { icon: "error" });
    timeoutId = setTimeout(() => removeProgressElements(progressId), 2200);
  }

  function remove() {
    clearRemoveTimer();
    removeProgressElements(progressId);
  }

  return { update, finish, fail, remove };
}
