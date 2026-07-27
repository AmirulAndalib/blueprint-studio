import { t } from './translations.js';
/** DOWNLOADS-UPLOADS.JS | Purpose: File transfers - download files/folders, upload files via drag-drop */
import { state, elements } from './state.js';
import { fetchWithAuth, downloadFileUrl, downloadFolderUrl, getAuthToken, urlWithTicket } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE, STREAM_BASE, UPLOAD_BASE } from './constants.js';
import { 
  showToast, 
  showConfirmDialog,
  showModal
} from './ui.js';
import { isTextFile } from './utils.js';
import { createZipProgressId, startUploadProgress, startZipProgress } from './zip-progress.js';
import {
  isSftpPath,
  parseSftpPath,
  uploadSftpFile,
  refreshSftp,
  sftpStreamUrl,
  getSftpConnectionDetails
} from './sftp.js?v=2.5.75';

function parentPath(path) {
  const clean = String(path || "").replace(/\/+$/g, "");
  const index = clean.lastIndexOf("/");
  return index > 0 ? clean.slice(0, index) : "";
}

async function refreshLocalUploadTarget(path) {
  try {
    const { loadDirectory } = await import('./file-tree.js');
    const targetPath = parentPath(path);
    state.loadedDirectories.delete(targetPath);
    await loadDirectory(targetPath);
  } catch (error) {
    console.warn("Failed to refresh uploaded folder target:", error);
    eventBus.emit("ui:reload-files", { force: true });
  }
}

/**
 * Downloads the currently active file via streaming URL
 */
export async function downloadCurrentFile() {
  if (!state.activeTab) {
    showToast(t("toast.no_file_open"), "warning");
    return;
  }
  await downloadFileByPath(state.activeTab.path);
}

/**
 * Downloads a file by its path using streaming URL (local or SFTP)
 */
export async function downloadFileByPath(path) {
  const filename = path.split("/").pop();
  try {
    let url;
    if (isSftpPath(path)) {
      // SFTP: direct stream URL avoids buffering the whole file in browser memory.
      const { connId, remotePath } = parseSftpPath(path);
      url = await sftpStreamUrl(connId, remotePath);
    } else {
      // Local: use authenticated serve_file URL
      url = await downloadFileUrl(path);
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Downloaded ${filename}`, "success");
  } catch (error) {
    showToast(`Failed to download ${filename}: ${error.message}`, "error");
  }
}

/**
 * Generic download handler
 */
export function downloadContent(filename, content, is_base64 = false, mimeType = "application/octet-stream") {
  try {
    let blobContent;
    let blobType = mimeType;

    if (is_base64) {
      const binaryString = atob(content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      blobContent = [bytes];
    } else {
      blobContent = [content];
      if (!blobType || blobType === "application/octet-stream") {
        blobType = "text/plain;charset=utf-8";
      }
    }

    const blob = new Blob(blobContent, { type: blobType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded ${filename}`, "success");
  } catch (error) {
    showToast(`Failed to download ${filename}: ${error.message}`, "error");
  }
}

/**
 * Downloads a folder as a ZIP file via streaming URL
 */
export async function downloadFolder(path) {
  const folderName = path.split('/').filter(Boolean).pop() || "download";
  const progressId = createZipProgressId();
  const stopProgress = startZipProgress(progressId, `Preparing ${folderName}.zip...`);
  try {
    const url = await downloadFolderUrl(path, progressId);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folderName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (error) {
    stopProgress();
    showToast(t("toast.download_items_fail", { error: error.message }), "error");
  }
}

/**
 * Downloads selected items (bulk download) — streams ZIP directly
 */
export async function downloadSelectedItems() {
  if (state.selectedItems.size === 0) return;
  const paths = Array.from(state.selectedItems);
  const progressId = createZipProgressId();
  const stopProgress = startZipProgress(progressId, "Preparing selected items ZIP...");

  try {
    const result = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prepare_download_multi", paths, progress_id: progressId }),
    });

    if (!result?.success || !result.stream_id) {
      throw new Error(result?.message || "Failed to prepare selected items download");
    }

    const url = await urlWithTicket(
      `${STREAM_BASE}?action=download_multi&stream_id=${encodeURIComponent(result.stream_id)}&_t=${Date.now()}`
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "download.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    eventBus.emit("ui:toggle-selection");
  } catch (error) {
    stopProgress();
    showToast(t("toast.delete_items_failed", { error: error.message }), "error");
  }
}

/**
 * Triggers the file upload input click
 */
export function triggerUpload() {
  if (elements.fileUploadInput) {
    elements.fileUploadInput.click();
  }
}

/**
 * Prompts user when a folder already exists during upload
 * @returns {Promise<string|null>} 'merge', 'replace', or null (cancel)
 */
async function promptFolderConflict(folderName) {
    const html = `
        <div style="margin-bottom: 16px; line-height: 1.5;">
            ${t("modal.folder_exists_message", { name: folderName })}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <button id="btn-folder-merge" class="modal-btn primary" style="width: 100%;">${t("modal.merge")}</button>
            <button id="btn-folder-replace" class="modal-btn danger" style="width: 100%;">${t("modal.replace")}</button>
        </div>
    `;

    return new Promise((resolve) => {
        const modalPromise = showModal({
            title: t("modal.folder_exists_title"),
            message: html,
            confirmText: null, // We use custom buttons
            cancelText: t("modal.cancel_button")
        });

        // Add listeners to custom buttons
        const checkButtons = setInterval(() => {
            const btnMerge = document.getElementById('btn-folder-merge');
            const btnReplace = document.getElementById('btn-folder-replace');
            const overlay = document.getElementById('modal-overlay');
            const closeBtn = document.getElementById('modal-close');
            const cancelBtn = document.getElementById('modal-cancel');

            if (btnMerge && btnReplace) {
                clearInterval(checkButtons);
                
                btnMerge.onclick = () => {
                    eventBus.emit('ui:hide-modal');
                    resolve('merge');
                };
                
                btnReplace.onclick = () => {
                    eventBus.emit('ui:hide-modal');
                    resolve('replace');
                };

                // If user clicks cancel or close, resolve with null
                if (closeBtn) closeBtn.addEventListener('click', () => resolve(null));
                if (cancelBtn) cancelBtn.addEventListener('click', () => resolve(null));
                if (overlay) overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) resolve(null);
                });
            }
        }, 50);

        modalPromise.then(res => {
            if (res === null) resolve(null);
        });
    });
}

function buildUploadedFolderPath(basePath, folderName) {
  const cleanFolderName = folderName.replace(/^\/+|\/+$/g, "");
  const rawBasePath = basePath || "";

  if (!rawBasePath) return cleanFolderName;
  if (rawBasePath === "/") return `/${cleanFolderName}`;

  const cleanBasePath = rawBasePath.replace(/\/+$/g, "");
  return `${cleanBasePath}/${cleanFolderName}`;
}

function formatUploadLabel(totalFiles) {
  return totalFiles === 1 ? "Uploading 1 file..." : `Uploading ${totalFiles} files...`;
}

function uploadProgressFor(progress, file, fileIndex, phase = "Uploading") {
  if (!progress) return null;
  return ({ loaded = 0, total = file.size || 0 } = {}) => {
    progress.update({
      fileName: file.name,
      fileIndex,
      loaded,
      total,
      message: "",
    });
  };
}

async function runUploadWithProgress(progress, file, fileIndex, phase, uploadFn) {
  const onProgress = uploadProgressFor(progress, file, fileIndex, phase);
  if (onProgress) onProgress({ loaded: 0, total: file.size || 0 });
  const result = await uploadFn(onProgress);
  if (progress) {
    progress.update({
      fileName: file.name,
      fileIndex,
      loaded: file.size || 0,
      total: file.size || 0,
      message: `${phase} ${file.name} - processing on server...`,
    });
  }
  return result;
}

function showUploadWarnings(result) {
  if (!result?.skipped_files) return;
  const examples = Array.isArray(result.skipped_examples) && result.skipped_examples.length
    ? `: ${result.skipped_examples.slice(0, 3).join(", ")}`
    : "";
  showToast(`Upload completed with ${result.skipped_files} skipped item(s)${examples}`, "warning", 8000);
}

/**
 * Processes file uploads
 */
export async function processUploads(files, targetFolder = null) {
  if (!files || files.length === 0) return;

  const isSftp = targetFolder && isSftpPath(targetFolder);
  let connId = null;
  let remoteBaseDir = null;
  
  if (isSftp) {
    const parsed = parseSftpPath(targetFolder);
    connId = parsed.connId;
    remoteBaseDir = parsed.remotePath;
  }

  let basePath = targetFolder;
  if (basePath === null) {
    basePath = state.lazyLoadingEnabled ? (state.currentNavigationPath || "") : (state.currentFolderPath || "");
  }
  
  let processedCount = 0;
  let successCount = 0;
  const totalFiles = files.length;
  const progress = startUploadProgress({ label: formatUploadLabel(totalFiles), totalFiles });

  for (const file of files) {
    processedCount++;
    try {
      const isZip = file.name.toLowerCase().endsWith('.zip');
      const isBinaryFile = !isTextFile(file.name);

      // ZIP extraction logic (Local and SFTP)
      if (isZip) {
        const unzip = await showConfirmDialog({
          title: t("modal.unzip_title"),
          message: t("modal.unzip_message", { name: file.name }),
          confirmText: t("modal.unzip_button"),
          cancelText: t("modal.upload_only"),
          isDanger: false
        });

        if (unzip) {
          const targetDir = isSftp ? remoteBaseDir : basePath;
          const folderName = file.name.replace(/\.zip$/i, '');
          const targetPath = buildUploadedFolderPath(targetDir, folderName);

          if (isSftp) {
            const connDetails = getSftpConnectionDetails(connId);
            if (!connDetails) {
              showToast(`Failed to unzip ${file.name}: SFTP connection not found`, "error");
              continue;
            }
            // Try without overwrite first
            let result = await runUploadWithProgress(
              progress,
              file,
              processedCount,
              "Uploading ZIP",
              (onProgress) => uploadFolderMultipartSftp(connDetails, targetPath, file, "merge", false, onProgress)
            );
            
            if (result && result.status === 409) {
                const mode = await promptFolderConflict(result.folder_name || folderName);
                if (mode) {
                    result = await runUploadWithProgress(
                      progress,
                      file,
                      processedCount,
                      "Uploading ZIP",
                      (onProgress) => uploadFolderMultipartSftp(connDetails, targetPath, file, mode, true, onProgress)
                    );
                } else {
                    continue;
                }
            }

            if (result && result.success) {
              successCount++;
              showUploadWarnings(result);
              await refreshSftp();
              continue;
            } else {
              showToast(`Failed to unzip on remote: ${result?.message || 'Unknown error'}`, "error");
            }
          } else {
            // Local folder upload
            let data = await runUploadWithProgress(
              progress,
              file,
              processedCount,
              "Uploading ZIP",
              (onProgress) => uploadFolderMultipart(targetPath, file, "merge", false, onProgress)
            );

            if (data && data.status === 409) {
                const mode = await promptFolderConflict(data.folder_name || folderName);
                if (mode) {
                    data = await runUploadWithProgress(
                      progress,
                      file,
                      processedCount,
                      "Uploading ZIP",
                      (onProgress) => uploadFolderMultipart(targetPath, file, mode, true, onProgress)
                    );
                } else {
                    continue;
                }
            }

            if (data && data.success) {
              successCount++;
              showUploadWarnings(data);
              await refreshLocalUploadTarget(targetPath);
              continue;
            }
          }
        }
      }

      let content;
      if (isBinaryFile) {
        // Binary files: use multipart upload (no base64, bypasses 16MB limit)
        if (isSftp) {
          const remotePath = remoteBaseDir === '/' ? `/${file.name}` : `${remoteBaseDir}/${file.name}`;
          const connDetails = getSftpConnectionDetails(connId);
          if (!connDetails) {
            showToast(`Failed to upload ${file.name}: SFTP connection not found`, "error");
            continue;
          }
          let res = await runUploadWithProgress(
            progress,
            file,
            processedCount,
            "Uploading",
            (onProgress) => uploadFileMultipartSftp(connDetails, remotePath, file, false, onProgress)
          );

          if (res && res.status === 409) {
            const confirm = await showConfirmDialog({
              title: t("modal.file_exists_title"),
              message: t("modal.file_exists_message", { name: file.name }),
              confirmText: t("modal.overwrite"),
              cancelText: t("modal.cancel_button"),
              isDanger: true
            });
            if (confirm) {
              res = await runUploadWithProgress(
                progress,
                file,
                processedCount,
                "Uploading",
                (onProgress) => uploadFileMultipartSftp(connDetails, remotePath, file, true, onProgress)
              );
            } else {
              continue;
            }
          }

          if (res && res.success) {
            successCount++;
          } else {
            showToast(`Failed to upload ${file.name}: ${res?.message || 'Unknown error'}`, "error");
          }
        } else {
          const filePath = basePath ? `${basePath}/${file.name}` : file.name;
          let res = await runUploadWithProgress(
            progress,
            file,
            processedCount,
            "Uploading",
            (onProgress) => uploadFileMultipart(filePath, file, false, onProgress)
          );

          if (res && res.status === 409) {
            const confirm = await showConfirmDialog({
              title: t("modal.file_exists_title"),
              message: t("modal.file_exists_message", { name: file.name }),
              confirmText: t("modal.overwrite"),
              cancelText: t("modal.cancel_button"),
              isDanger: true
            });
            if (confirm) {
              res = await runUploadWithProgress(
                progress,
                file,
                processedCount,
                "Uploading",
                (onProgress) => uploadFileMultipart(filePath, file, true, onProgress)
              );
            } else {
              continue;
            }
          }

          if (res && res.success) {
            successCount++;
          } else {
            showToast(`Failed to upload ${file.name}: ${res?.message || 'Unknown error'}`, "error");
          }
        }
        continue;
      }

      // Text files: use JSON upload (small, no need for multipart)
      progress.update({
        fileName: file.name,
        fileIndex: processedCount,
        loaded: 0,
        total: file.size || 0,
        message: `Reading ${file.name}`,
      });
      content = await readFileAsText(file);
      progress.update({
        fileName: file.name,
        fileIndex: processedCount,
        loaded: file.size || 0,
        total: file.size || 0,
        message: `Saving ${file.name}`,
      });

      if (isSftp) {
        const remotePath = remoteBaseDir === '/' ? `/${file.name}` : `${remoteBaseDir}/${file.name}`;
        
        // Try without overwrite first
        let res = await uploadSftpFile(connId, remotePath, content, false, isBinaryFile);
        
        // If file exists, prompt for overwrite
        if (res && res.status === 409) {
            const confirm = await showConfirmDialog({
                title: t("modal.file_exists_title"),
                message: t("modal.file_exists_message", { name: file.name }),
                confirmText: t("modal.overwrite"),
                cancelText: t("modal.cancel_button"),
                isDanger: true
            });
            if (confirm) {
                res = await uploadSftpFile(connId, remotePath, content, true, isBinaryFile);
            } else {
                continue; // Skip this file
            }
        }
        
        if (res && res.success) {
            successCount++;
        } else {
            showToast(`Failed to upload ${file.name}: ${res?.message || 'Unknown error'}`, "error");
        }
      } else {
        const filePath = basePath ? `${basePath}/${file.name}` : file.name;
        
        // Try without overwrite first
        let res = await uploadFile(filePath, content, false, isBinaryFile);
        
        // If file exists, prompt for overwrite
        if (res && res.status === 409) {
            const confirm = await showConfirmDialog({
                title: t("modal.file_exists_title"),
                message: t("modal.file_exists_message", { name: file.name }),
                confirmText: t("modal.overwrite"),
                cancelText: t("modal.cancel_button"),
                isDanger: true
            });
            if (confirm) {
                res = await uploadFile(filePath, content, true, isBinaryFile);
            } else {
                continue; // Skip this file
            }
        }
        
        if (res && res.success) {
            successCount++;
        } else {
            showToast(`Failed to upload ${file.name}: ${res?.message || 'Unknown error'}`, "error");
        }
      }
    } catch (error) {
      showToast(`Failed to upload ${file.name}: ${error.message}`, "error");
    }
  }

  if (successCount > 0) {
    progress.finish(successCount === totalFiles ? "Upload complete" : `Uploaded ${successCount} of ${totalFiles} files`);
    showToast(t("toast.upload_success"), "success");
    if (isSftp) await refreshSftp();
    else eventBus.emit("ui:reload-files", { force: true });
  } else {
    progress.fail("No files uploaded");
  }
}

/**
 * Triggers the folder upload input click
 */
export function triggerFolderUpload() {
  if (elements.folderUploadInput) {
    elements.folderUploadInput.click();
  }
}

/**
 * Handles folder upload (ZIP method) — supports both local and SFTP targets
 */
export async function handleFolderUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.zip')) {
    showToast(t("toast.select_zip"), "warning");
    event.target.value = "";
    return;
  }

  const progress = startUploadProgress({ label: `Uploading ${file.name}...`, totalFiles: 1 });

  try {
    let targetPath = state._nextFolderUploadTarget;
    state._nextFolderUploadTarget = null;
    if (targetPath === null) {
      targetPath = state.lazyLoadingEnabled ? (state.currentNavigationPath || "") : (state.currentFolderPath || "");
    }

    if (isSftpPath(targetPath)) {
      // SFTP folder upload
      const { connId, remotePath } = parseSftpPath(targetPath);
      const folderName = file.name.replace(/\.zip$/i, '');
      const remoteFolderPath = buildUploadedFolderPath(remotePath, folderName);
      const connDetails = getSftpConnectionDetails(connId);
      if (!connDetails) {
        progress.fail("SFTP connection not found");
        showToast(t("toast.upload_folder_fail", { error: "SFTP connection not found" }), "error");
        event.target.value = "";
        return;
      }

      let result = await runUploadWithProgress(
        progress,
        file,
        1,
        "Uploading ZIP",
        (onProgress) => uploadFolderMultipartSftp(connDetails, remoteFolderPath, file, "merge", false, onProgress)
      );

      if (result && result.status === 409) {
        const mode = await promptFolderConflict(result.folder_name || folderName);
        if (mode) {
          result = await runUploadWithProgress(
            progress,
            file,
            1,
            "Uploading ZIP",
            (onProgress) => uploadFolderMultipartSftp(connDetails, remoteFolderPath, file, mode, true, onProgress)
          );
        } else {
          progress.remove();
          event.target.value = "";
          return;
        }
      }

      if (result && result.success) {
        progress.finish("Upload complete");
        showToast(t("toast.upload_success"), "success");
        showUploadWarnings(result);
        await refreshSftp();
      } else {
        progress.fail("Upload failed");
        showToast(t("toast.upload_folder_fail", { error: result?.message || "Unknown error" }), "error");
      }
    } else {
      // Local folder upload
      const folderName = file.name.replace(/\.zip$/i, '');
      const localFolderPath = buildUploadedFolderPath(targetPath, folderName);
      let data = await runUploadWithProgress(
        progress,
        file,
        1,
        "Uploading ZIP",
        (onProgress) => uploadFolderMultipart(localFolderPath, file, "merge", false, onProgress)
      );

      if (data && data.status === 409) {
        const mode = await promptFolderConflict(data.folder_name || folderName);
        if (mode) {
          data = await runUploadWithProgress(
            progress,
            file,
            1,
            "Uploading ZIP",
            (onProgress) => uploadFolderMultipart(localFolderPath, file, mode, true, onProgress)
          );
        } else {
          progress.remove();
          event.target.value = "";
          return;
        }
      }

      if (data.success) {
        progress.finish("Upload complete");
        showToast(t("toast.upload_success"), "success");
        showUploadWarnings(data);
        await refreshLocalUploadTarget(localFolderPath);
      } else {
        progress.fail("Upload failed");
        showToast(t("toast.upload_folder_fail", { error: data.message || "Unknown error" }), "error");
      }
    }
  } catch (error) {
    progress.fail("Upload failed");
    showToast(t("toast.upload_folder_fail", { error: error.message }), "error");
  } finally {
    event.target.value = "";
  }
}

/** Utility to read file as text */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/** Utility to read file as base64 */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Basic single file upload (JSON body — for text files) */
export async function uploadFile(path, content, overwrite = false, is_base64 = false) {
  return fetchWithAuth(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "upload_file", path, content, overwrite, is_base64 }),
  });
}

async function sendMultipartUpload(formData, onProgress = null) {
  const token = await getAuthToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", UPLOAD_BASE, true);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      onProgress({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : 0,
      });
    };

    xhr.onload = () => {
      let data = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch (_) {
        data = { success: false, message: xhr.responseText || `HTTP ${xhr.status}` };
      }
      if (typeof data === "object" && data !== null && !("status" in data)) {
        data.status = xhr.status;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else if (xhr.status === 409) {
        resolve({ ...data, status: 409 });
      } else {
        reject(new Error(data?.message || `HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(formData);
  });
}

/**
 * Multipart file upload — streams raw binary to /api/blueprint_studio/upload.
 * Bypasses HA's 16MB JSON body limit. Used for binary files (images, video, etc.).
 */
export async function uploadFileMultipart(path, file, overwrite = false, onProgress = null) {
  const formData = new FormData();
  formData.append("path", path);
  formData.append("overwrite", overwrite ? "true" : "false");
  formData.append("file", file);

  return await sendMultipartUpload(formData, onProgress);
}

/**
 * Multipart ZIP folder upload — sends raw ZIP bytes and asks backend to extract.
 */
export async function uploadFolderMultipart(path, file, mode = "merge", overwrite = false, onProgress = null) {
  const formData = new FormData();
  formData.append("path", path);
  formData.append("overwrite", overwrite ? "true" : "false");
  formData.append("extract_zip", "true");
  formData.append("mode", mode);
  formData.append("file", file);

  return await sendMultipartUpload(formData, onProgress);
}

/**
 * Multipart SFTP upload — sends raw binary + connection details to /api/blueprint_studio/upload.
 * Bypasses HA's 16MB JSON body limit for SFTP binary uploads.
 */
export async function uploadFileMultipartSftp(conn, remotePath, file, overwrite = false, onProgress = null) {
  const formData = new FormData();
  formData.append("path", remotePath);
  formData.append("overwrite", overwrite ? "true" : "false");
  formData.append("connection", JSON.stringify({
    host: conn.host,
    port: conn.port || 22,
    username: conn.username,
    auth: conn.auth,
  }));
  formData.append("file", file);

  return await sendMultipartUpload(formData, onProgress);
}

/**
 * Multipart SFTP ZIP folder upload — sends raw ZIP bytes and asks backend to extract.
 */
export async function uploadFolderMultipartSftp(conn, remotePath, file, mode = "merge", overwrite = false, onProgress = null) {
  const formData = new FormData();
  formData.append("path", remotePath);
  formData.append("overwrite", overwrite ? "true" : "false");
  formData.append("extract_zip", "true");
  formData.append("mode", mode);
  formData.append("connection", JSON.stringify({
    host: conn.host,
    port: conn.port || 22,
    username: conn.username,
    auth: conn.auth,
  }));
  formData.append("file", file);

  return await sendMultipartUpload(formData, onProgress);
}

/** Handles file input change */
export async function handleFileUpload(event) {
  const files = event.target.files;
  const target = state._nextUploadTarget;
  state._nextUploadTarget = null;
  await processUploads(files, target);
  event.target.value = "";
}
