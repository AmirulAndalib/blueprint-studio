/** ZIP-PROGRESS.JS | Purpose: Non-blocking transfer progress UI. */
import { getAuthToken } from './api.js';
import { API_BASE } from './constants.js';
import { formatBytes } from './utils.js';
import { removeOperationFeedback, updateOperationFeedback } from './feedback-service.js';

function createTransferProgressId(prefix) {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createZipProgressId() {
  return createTransferProgressId("zip");
}

function updateProgressUi(progressId, progress, options = {}) {
  const filesDone = Number(progress?.files_done || 0);
  const totalFiles = Number(progress?.total_files || 0);
  const bytesDone = Number(progress?.bytes_done || 0);
  const bytesTotal = Number(progress?.bytes_total || 0);
  const percent = Number(progress?.percent);

  let message;
  if (progress?.message) {
      message = progress.message;
    } else if (progress?.status === "pending") {
      message = "Waiting for download to start...";
    } else if (progress?.status === "done") {
      const filePart = totalFiles ? `${totalFiles} file${totalFiles === 1 ? "" : "s"}` : `${filesDone} file${filesDone === 1 ? "" : "s"}`;
      message = `Complete: ${filePart}, ${formatBytes(bytesDone)}`;
    } else if (progress?.status === "uploading") {
      const filePart = totalFiles ? `File ${filesDone} of ${totalFiles}` : "Uploading";
      const bytePart = bytesTotal ? `${formatBytes(bytesDone)} of ${formatBytes(bytesTotal)}` : formatBytes(bytesDone);
      message = `${filePart} - ${bytePart}`;
    } else if (progress?.status === "error") {
      message = "Transfer failed";
    } else {
      message = `${filesDone} file${filesDone === 1 ? "" : "s"} processed, ${formatBytes(bytesDone)}`;
    }
  updateOperationFeedback(progressId, {
    label: options.label,
    icon: options.icon,
    status: progress?.status,
    message,
    detail: progress?.current_file,
    percent: Number.isFinite(percent) ? percent : undefined,
  });
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

  updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, { label, icon: "folder_zip" });

  async function poll() {
    if (stopped) return;
    try {
      const progress = await fetchProgress(progressId);
      if (!progress) {
        updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, { label, icon: "folder_zip" });
        timeoutId = setTimeout(poll, 800);
        return;
      }
      updateProgressUi(progressId, progress, { label, icon: "folder_zip" });
      if (progress.status === "done") {
        timeoutId = setTimeout(stop, 1200);
        return;
      }
      if (progress.status === "error") {
        timeoutId = setTimeout(stop, 1800);
        return;
      }
    } catch (_) {
      updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, { label, icon: "folder_zip" });
    }
    timeoutId = setTimeout(poll, 800);
  }

  function stop() {
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
    removeOperationFeedback(progressId);
  }

  timeoutId = setTimeout(poll, 500);
  return stop;
}

export function startUploadProgress({ label = "Uploading...", totalFiles = 1 } = {}) {
  const progressId = createTransferProgressId("upload");
  let timeoutId = null;

  updateProgressUi(progressId, {
    status: "pending",
    files_done: 0,
    total_files: totalFiles,
    bytes_done: 0,
    bytes_total: 0,
    percent: 0,
    message: "Waiting for upload to start...",
  }, { label, icon: "upload_file" });

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
    }, { label, icon: "upload_file" });
  }

  function finish(message = "Upload complete") {
    updateProgressUi(progressId, {
      status: "done",
      files_done: totalFiles,
      total_files: totalFiles,
      bytes_done: 0,
      percent: 100,
      message,
    }, { label, icon: "check_circle" });
    timeoutId = setTimeout(() => removeOperationFeedback(progressId), 1400);
  }

  function fail(message = "Upload failed") {
    updateProgressUi(progressId, {
      status: "error",
      files_done: 0,
      total_files: totalFiles,
      bytes_done: 0,
      message,
    }, { label, icon: "error" });
    timeoutId = setTimeout(() => removeOperationFeedback(progressId), 2200);
  }

  function remove() {
    clearRemoveTimer();
    removeOperationFeedback(progressId);
  }

  return { update, finish, fail, remove };
}
