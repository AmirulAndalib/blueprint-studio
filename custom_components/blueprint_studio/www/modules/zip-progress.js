import { t } from './translations.js';
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
      message = t('transfer.waiting_download');
    } else if (progress?.status === "done") {
      const fileCount = totalFiles || filesDone;
      message = t('transfer.complete', { count: fileCount, bytes: formatBytes(bytesDone) });
    } else if (progress?.status === "uploading") {
      const filePart = totalFiles ? t('transfer.file_progress', { current: filesDone, total: totalFiles }) : t('transfer.uploading');
      const bytePart = bytesTotal ? t('transfer.bytes_progress', { loaded: formatBytes(bytesDone), total: formatBytes(bytesTotal) }) : formatBytes(bytesDone);
      message = t('transfer.progress', { files: filePart, bytes: bytePart });
    } else if (progress?.status === "error") {
      message = t('transfer.failed');
    } else {
      message = t('transfer.processed', { count: filesDone, bytes: formatBytes(bytesDone) });
    }
  updateOperationFeedback(progressId, {
    label: options.label,
    icon: options.icon,
    status: progress?.status,
    message,
    detail: progress?.current_file,
    percent: Number.isFinite(percent) ? percent : undefined,
    scope: options.scope,
    target: options.target,
    failureDetail: options.failureDetail,
    actions: options.actions,
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

async function cancelZip(progressId) {
  const token = await getAuthToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API_BASE, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({ action: "cancel_zip", progress_id: progressId }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || `Cancellation failed (HTTP ${response.status})`);
  }
  return result;
}

export function startZipProgress(progressId, label = t('transfer.preparing_zip'), operation = {}) {
  let stopped = false;
  let timeoutId = null;
  let cancellationRequested = false;

  const presentation = { label, icon: "folder_zip", ...operation };
  const cancelAction = [{
    label: t('transfer.cancel'),
    icon: "close",
    callback: async () => {
      if (cancellationRequested || stopped) return;
      cancellationRequested = true;
      presentation.actions = [];
      updateProgressUi(progressId, {
        status: "cancelling",
        message: t('transfer.cancelling_zip'),
      }, { ...presentation, icon: "pending", actions: [] });
      try {
        await cancelZip(progressId);
      } catch (error) {
        stop(error.message || t('transfer.cancel_failed'));
      }
    },
  }];
  presentation.actions = cancelAction;
  updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, presentation);

  async function poll() {
    if (stopped) return;
    try {
      const progress = await fetchProgress(progressId);
      if (!progress) {
        updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, presentation);
        timeoutId = setTimeout(poll, 800);
        return;
      }
      updateProgressUi(progressId, progress, presentation);
      if (progress.status === "done") {
        stop();
        return;
      }
      if (progress.status === "error" || progress.status === "cancelled") {
        stop();
        return;
      }
    } catch (_) {
      updateProgressUi(progressId, { status: "pending", files_done: 0, bytes_done: 0 }, presentation);
    }
    timeoutId = setTimeout(poll, 800);
  }

  function stop(errorMessage = "") {
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
    if (errorMessage) {
      updateProgressUi(progressId, { status: "error", message: errorMessage }, { ...presentation, icon: "error", actions: [] });
    }
  }

  timeoutId = setTimeout(poll, 500);
  return stop;
}

export function startUploadProgress({
    label = t('transfer.uploading'),
  totalFiles = 1,
  scope = "",
  target = "",
  onCancel = null,
  onRetry = null,
  onOpen = null,
  openLabel = t('transfer.show'),
  openIcon = "folder_open",
} = {}) {
  const progressId = createTransferProgressId("upload");
  let timeoutId = null;
  let cancellationRequested = false;
  const retryAction = typeof onRetry === "function"
    ? [{ label: "Retry", icon: "refresh", primary: true, callback: onRetry }]
    : [];
  const openAction = typeof onOpen === "function"
    ? [{ label: openLabel, icon: openIcon, callback: onOpen }]
    : [];
  const terminalActions = (includeRetry = false) => [
    ...(includeRetry ? retryAction : []),
    ...openAction,
  ];

  const cancelAction = typeof onCancel === "function"
    ? [{
        label: t('transfer.cancel'),
        icon: "close",
        callback: async () => {
          if (cancellationRequested) return;
          cancellationRequested = true;
          updateProgressUi(progressId, {
            status: "running",
            files_done: 0,
            total_files: totalFiles,
            message: t('transfer.cancelling_upload'),
          }, { label, icon: "pending", scope, target, actions: [] });
          await onCancel();
        },
      }]
    : [];

  updateProgressUi(progressId, {
    status: "pending",
    files_done: 0,
    total_files: totalFiles,
    bytes_done: 0,
    bytes_total: 0,
    percent: 0,
    message: t('transfer.waiting_upload'),
  }, { label, icon: "upload_file", scope, target, actions: cancelAction });

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
    }, { label, icon: "upload_file", scope, target, actions: cancellationRequested ? [] : cancelAction });
  }

  function finish(message = t('transfer.upload_complete')) {
    updateProgressUi(progressId, {
      status: "done",
      files_done: totalFiles,
      total_files: totalFiles,
      bytes_done: 0,
      percent: 100,
      message,
    }, { label, icon: "check_circle", scope, target, actions: terminalActions() });
  }

  function fail(message = t('transfer.upload_failed'), failureDetail = message) {
    updateProgressUi(progressId, {
      status: "error",
      files_done: 0,
      total_files: totalFiles,
      bytes_done: 0,
      message,
    }, { label, icon: "error", scope, target, failureDetail, actions: terminalActions(true) });
  }

  function cancel(message = t('transfer.upload_cancelled')) {
    cancellationRequested = true;
    updateProgressUi(progressId, {
      status: "cancelled",
      files_done: 0,
      total_files: totalFiles,
      bytes_done: 0,
      message,
    }, {
      label,
      icon: "cancel",
      scope,
      target,
      failureDetail: t('transfer.upload_cancelled_detail'),
      actions: terminalActions(true),
    });
  }

  function remove() {
    clearRemoveTimer();
    removeOperationFeedback(progressId);
  }

  return { update, finish, fail, cancel, remove, isCancellationRequested: () => cancellationRequested };
}
