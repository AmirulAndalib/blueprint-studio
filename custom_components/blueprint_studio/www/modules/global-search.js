/** GLOBAL-SEARCH.JS | Purpose: * Provides sidebar-based global search and replace functionality across all files. */
import { state, elements } from './state.js';
import { HA_ENTITIES } from './ha-autocomplete.js';
import { t } from './translations.js';
import { fetchWithAuth, urlWithTicket } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE, STREAM_BASE } from './constants.js';
import {
  showToast,
  showGlobalLoading,
  hideGlobalLoading,
  showConfirmDialog
} from './ui.js';

/**
 * Performs global search across all files
 * @param {string} query - Search query
 * @param {Object} options - Search options (caseSensitive, useRegex, matchWord, include, exclude)
 */
export async function performGlobalSearch(query, options = {}) {
  if (!query || query.length < 2) return;

  if (elements.globalSearchLoading) elements.globalSearchLoading.style.display = "block";
  if (elements.globalSearchResults) elements.globalSearchResults.innerHTML = "";

  const activeTab = document.querySelector('.search-mode-tab.active');
  const mode = activeTab ? activeTab.dataset.mode : 'all';

  // Search Entities synchronously first (fast, in-memory)
  const entityMatches = (mode === 'all' || mode === 'entities')
      ? HA_ENTITIES.filter(e =>
            e.entity_id.toLowerCase().includes(query.toLowerCase()) ||
            (e.friendly_name && e.friendly_name.toLowerCase().includes(query.toLowerCase()))
        ).slice(0, 100)
      : [];

  if (mode === 'entities') {
      if (elements.globalSearchLoading) elements.globalSearchLoading.style.display = "none";
      state._lastGlobalSearchResults = [];
      renderGlobalSearchResults([], entityMatches);
      return;
  }

  // Search Files using streaming NDJSON — results appear as each file is scanned
  try {
      const params = new URLSearchParams({
          action: "search_stream",
          query: query,
      });
      if (options.caseSensitive) params.set("case_sensitive", "true");
      if (options.useRegex) params.set("use_regex", "true");
      if (options.matchWord) params.set("match_word", "true");
      if (options.include) params.set("include", options.include);
      if (options.exclude) params.set("exclude", options.exclude);

      const response = await fetch(await urlWithTicket(`${STREAM_BASE}?${params}`));
      if (!response.ok || !response.body) throw new Error("Stream unavailable");

      const fileResults = [];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          let hadNew = false;
          for (const line of lines) {
              if (!line.trim()) continue;
              try { fileResults.push(JSON.parse(line)); hadNew = true; } catch { /* skip */ }
          }
          // Incrementally patch the DOM as each file's results arrive
          if (hadNew) {
              state._lastGlobalSearchResults = fileResults;
              renderGlobalSearchResults(fileResults, entityMatches);
          }
      }

      if (elements.globalSearchLoading) elements.globalSearchLoading.style.display = "none";
      state._lastGlobalSearchResults = fileResults;
      renderGlobalSearchResults(fileResults, entityMatches);

  } catch (streamErr) {
      // Fallback: POST-based search (no incremental render)
      try {
          const data = await fetchWithAuth(API_BASE, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  action: "global_search",
                  query: query,
                  case_sensitive: options.caseSensitive || false,
                  use_regex: options.useRegex || false,
                  match_word: options.matchWord || false,
                  include: options.include || "",
                  exclude: options.exclude || ""
              }),
          });
          const fileResults = Array.isArray(data) ? data : [];
          if (elements.globalSearchLoading) elements.globalSearchLoading.style.display = "none";
          state._lastGlobalSearchResults = fileResults;
          renderGlobalSearchResults(fileResults, entityMatches);
      } catch (e) {
          if (elements.globalSearchLoading) elements.globalSearchLoading.style.display = "none";
          console.error("Search failed", e);
          if (elements.globalSearchResults) {
              elements.globalSearchResults.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--error-color);">Search failed: ${e.message}</div>`;
          }
      }
  }
}

/**
 * Triggers global search based on current UI input states
 */
export function triggerGlobalSearch() {
    if (!elements.globalSearchInput) return;
    const query = elements.globalSearchInput.value;

    if (!query || query.length < 2) {
        if (elements.globalSearchResults) {
            elements.globalSearchResults.innerHTML = `
                <div class="search-empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-secondary); display: flex; flex-direction: column; align-items: center;">
                    <span class="material-icons" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;">search</span>
                    <p style="margin: 0; font-size: 14px;">${t("search.empty_state_text")}</p>
                </div>`;
        }
        return;
    }

    performGlobalSearch(query, {
        caseSensitive: elements.btnMatchCase?.classList.contains("active"),
        useRegex: elements.btnUseRegex?.classList.contains("active"),
        matchWord: elements.btnMatchWord?.classList.contains("active"),
        include: elements.globalSearchInclude?.value || "",
        exclude: elements.globalSearchExclude?.value || ""
    });
}

/**
 * Copies entity ID to clipboard
 */
export function copyEntityId(entityId) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(entityId).then(() => {
          showToast(`Copied: ${entityId}`, "success");
      }).catch(() => _copyFallback(entityId));
  } else {
      _copyFallback(entityId);
  }
}

function _copyFallback(text) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-999px;left:-999px;';
    document.body.appendChild(el);
    el.select();
    try {
        document.execCommand('copy');
        showToast(`Copied: ${text}`, "success");
    } catch {
        showToast(`Copy failed`, "error");
    }
    document.body.removeChild(el);
}

/**
 * Opens a file and scrolls to a specific line, highlighting it briefly.
 */
export async function openFileAndScroll(path, line) {
  const lineIdx = line - 1;

  const _scrollAndHighlight = (editor) => {
      editor.setCursor({ line: lineIdx, ch: 0 });
      editor.scrollIntoView({ line: lineIdx, ch: 0 }, 200);
      editor.focus();
      const marker = editor.markText(
          { line: lineIdx, ch: 0 },
          { line: lineIdx + 1, ch: 0 },
          { className: "cm-search-active" }
      );
      setTimeout(() => marker.clear(), 2000);
  };

  // If the file is already the active tab, scroll immediately
  if (state.activeTab && state.activeTab.path === path && state.editor) {
      _scrollAndHighlight(state.editor);
      return;
  }

  eventBus.emit("file:open", { path });

  const unbind = eventBus.on('ui:refresh-tabs', () => {
      if (state.activeTab && state.activeTab.path === path && state.editor) {
          // Small delay to let the editor finish setValue/refresh
          setTimeout(() => _scrollAndHighlight(state.editor), 50);
          unbind();
      }
  });

  setTimeout(unbind, 5000);
}

/**
 * Performs global find and replace
 */
export async function performGlobalReplace() {
  if (!elements.globalSearchInput) return;
  const query = elements.globalSearchInput.value;
  const replacement = elements.globalReplaceInput?.value || "";
  const results = state._lastGlobalSearchResults || [];

  if (!query || results.length === 0) return;

  const grouped = {};
  results.forEach(res => {
      if (!grouped[res.path]) grouped[res.path] = 0;
      grouped[res.path]++;
  });
  const fileCount = Object.keys(grouped).length;

  const confirmed = await showConfirmDialog({
      title: t("search.replace_confirm_title"),
      message: t("search.replace_confirm_message", { query: escapeHtml(query), replacement: escapeHtml(replacement), occurrences: results.length, files: fileCount }),
      confirmText: t("search.replace_all"),
      cancelText: t("modal.cancel"),
      isDanger: true
  });

  if (!confirmed) return;

  try {
      showGlobalLoading(t("search.replace_loading", { count: fileCount }));

      const response = await fetchWithAuth(API_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              action: "global_replace",
              query: query,
              replacement: replacement,
              case_sensitive: elements.btnMatchCase?.classList.contains("active"),
              use_regex: elements.btnUseRegex?.classList.contains("active"),
              match_word: elements.btnMatchWord?.classList.contains("active"),
              include: elements.globalSearchInclude?.value || "",
              exclude: elements.globalSearchExclude?.value || ""
          }),
      });

      hideGlobalLoading();

      if (response.success) {
          showToast(t("search.replace_success", { count: response.files_updated }), "success");
          eventBus.emit("ui:reload-files", { force: true });
          triggerGlobalSearch();
      } else {
          showToast(t("search.replace_failed", { error: response.message }), "error");
      }
  } catch (e) {
      hideGlobalLoading();
      showToast(t("search.replace_error", { error: e.message }), "error");
  }
}

/**
 * Replaces all occurrences in a single file
 */
export async function replaceInFile(path) {
    if (!elements.globalSearchInput) return;
    const query = elements.globalSearchInput.value;
    const replacement = elements.globalReplaceInput?.value || "";
    if (!query) return;

    const confirmed = await showConfirmDialog({
        title: "Replace in File",
        message: `Replace all occurrences of <b>"${escapeHtml(query)}"</b> with <b>"${escapeHtml(replacement)}"</b> in <b>${path.split('/').pop()}</b>?`,
        confirmText: "Replace",
        cancelText: "Cancel",
        isDanger: true
    });

    if (!confirmed) return;

    try {
        showGlobalLoading("Replacing...");
        const response = await fetchWithAuth(API_BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "global_replace",
                query: query,
                replacement: replacement,
                include: path,
                case_sensitive: elements.btnMatchCase?.classList.contains('active'),
                use_regex: elements.btnUseRegex?.classList.contains('active'),
                match_word: elements.btnMatchWord?.classList.contains('active')
            }),
        });
        hideGlobalLoading();

        if (response.success) {
            showToast("File updated successfully", "success");
            const tab = state.openTabs.find(t => t.path === path);
            if (tab) eventBus.emit("file:open", { path, forceReload: true });
            triggerGlobalSearch();
        }
    } catch (e) {
        hideGlobalLoading();
        showToast(`Replace failed: ${e.message}`, "error");
    }
}

/**
 * Replaces a single match in the editor
 */
export async function replaceSingleMatch(path, line, matchId) {
    const replacement = elements.globalReplaceInput?.value || "";

    await openFileAndScroll(path, line);

    setTimeout(() => {
        if (state.editor && state.activeTab && state.activeTab.path === path) {
            const lineIdx = line - 1;
            const lineText = state.editor.getLine(lineIdx);
            const query = elements.globalSearchInput.value;

            const useRegex = elements.btnUseRegex?.classList.contains('active');
            const caseSensitive = elements.btnMatchCase?.classList.contains('active');
            const matchWord = elements.btnMatchWord?.classList.contains('active');

            let searchPattern = query;
            if (!useRegex) searchPattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (matchWord) searchPattern = `\\b${searchPattern}\\b`;

            const regex = new RegExp(searchPattern, caseSensitive ? 'g' : 'gi');
            const newLineText = lineText.replace(regex, replacement);

            if (lineText !== newLineText) {
                state.editor.replaceRange(newLineText, {line: lineIdx, ch: 0}, {line: lineIdx, ch: lineText.length});
                showToast("Applied replacement in editor", "success");
                document.getElementById(matchId)?.remove();
            }
        }
    }, 100);
}

/**
 * Builds HTML for a single match row
 */
function _buildMatchHtml(m, matchId) {
    const escapedPath = m.path.replace(/'/g, "\\'");
    return `<div class="search-result-match" id="${matchId}" onclick="if(event.target.closest('.match-hover-actions')) return; window.blueprintStudio.openFileAndScroll('${escapedPath}', ${m.line})" style="padding: 6px 12px 6px 34px; cursor: pointer; font-family: monospace; font-size: 12px; border-bottom: 1px solid var(--border-color); display: flex; position: relative; align-items: center;">
        <span style="color: var(--text-secondary); margin-right: 8px; min-width: 20px;">${m.line}:</span>
        <span style="white-space: pre; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(m.content.trim())}</span>
        <div class="match-hover-actions" style="display: flex; gap: 4px; position: absolute; right: 12px; background: var(--bg-primary); padding-left: 8px; opacity: 0;">
            <span class="material-icons" title="Replace this match" onclick="event.stopPropagation(); window.blueprintStudio.replaceSingleMatch('${escapedPath}', ${m.line}, '${matchId}')" style="font-size: 14px; opacity: 0.7;">find_replace</span>
            <span class="material-icons" title="Dismiss" onclick="event.stopPropagation(); document.getElementById('${matchId}').remove()" style="font-size: 14px; opacity: 0.7;">close</span>
        </div>
    </div>`;
}

/**
 * Builds HTML for a complete file group (header + all matches)
 */
function _buildFileGroupHtml(path, matches) {
    const filename = path.split("/").pop();
    const folder = path.split("/").slice(0, -1).join("/");
    const safeId = path.replace(/[^a-zA-Z0-9]/g, '-');
    const escapedPath = path.replace(/'/g, "\\'");
    return `<div class="search-result-file" id="group-${safeId}">
        <div class="search-result-file-header" onclick="if(event.target.closest('.search-action-btn')) return; document.getElementById('results-${safeId}').classList.toggle('hidden'); this.querySelector('.arrow').classList.toggle('rotated');" style="padding: 8px 12px; background: var(--bg-tertiary); cursor: pointer; display: flex; align-items: center; border-bottom: 1px solid var(--border-color);">
            <span class="material-icons arrow rotated" style="font-size: 16px; margin-right: 6px; transition: transform 0.2s;">chevron_right</span>
            <span style="font-weight: 600; font-size: 13px;">${filename}</span>
            <span style="font-size: 11px; color: var(--text-secondary); margin-left: 8px; opacity: 0.7;">${folder}</span>
            <div class="search-result-actions" style="margin-left: auto; display: flex; gap: 8px; align-items: center;">
                <span class="material-icons search-action-btn" title="Replace in this file" onclick="event.stopPropagation(); window.blueprintStudio.replaceInFile('${escapedPath}')" style="font-size: 14px; opacity: 0.6;">find_replace</span>
                <span class="material-icons search-action-btn" title="Dismiss file" onclick="event.stopPropagation(); document.getElementById('group-${safeId}').remove()" style="font-size: 14px; opacity: 0.6;">close</span>
                <span class="badge" style="background: var(--accent-color); color: white; border-radius: 10px; padding: 0 6px; font-size: 10px;">${matches.length}</span>
            </div>
        </div>
        <div class="search-result-list" id="results-${safeId}" style="display: block;">
            ${matches.map((m, idx) => _buildMatchHtml(m, `match-${safeId}-${idx}`)).join('')}
        </div>
    </div>`;
}

/**
 * Renders global search results in the sidebar.
 * On the first call (empty container) does a full render.
 * On subsequent calls during streaming, patches only new/updated groups
 * so collapsed groups stay collapsed and the list doesn't flicker.
 */
function renderGlobalSearchResults(results, entityResults = []) {
  if (!elements.globalSearchResults) return;

  if (elements.globalSearchInput && elements.globalSearchInput.value.length < 2) {
      elements.globalSearchResults.innerHTML = `
          <div class="search-empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-secondary); display: flex; flex-direction: column; align-items: center;">
              <span class="material-icons" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;">search</span>
              <p style="margin: 0; font-size: 14px;">${t("search.empty_state_text")}</p>
          </div>`;
      return;
  }

  if ((!results || results.length === 0) && (!entityResults || entityResults.length === 0)) {
      elements.globalSearchResults.innerHTML = `
          <div class="search-empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-secondary); display: flex; flex-direction: column; align-items: center;">
              <span class="material-icons" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;">search_off</span>
              <p style="margin: 0; font-size: 14px;">${t("search.no_results")}</p>
          </div>`;
      return;
  }

  // Group file results by path
  const grouped = {};
  results.forEach(res => {
      if (!grouped[res.path]) grouped[res.path] = [];
      grouped[res.path].push(res);
  });

  const isFirstRender = !elements.globalSearchResults.querySelector('.search-result-file, .search-result-group');

  if (isFirstRender) {
      let html = "";
      if (entityResults && entityResults.length > 0) {
          html += `<div class="search-result-group">
              <div class="search-result-file-header" onclick="document.getElementById('results-entities').classList.toggle('hidden'); this.querySelector('.arrow').classList.toggle('rotated');" style="padding: 8px 12px; background: var(--bg-tertiary); cursor: pointer; display: flex; align-items: center; border-bottom: 1px solid var(--border-color);">
                  <span class="material-icons arrow rotated" style="font-size: 16px; margin-right: 6px; transition: transform 0.2s;">chevron_right</span>
                  <span style="font-weight: 600; font-size: 13px;">${t("search.entities")}</span>
                  <span class="badge" style="margin-left: auto; background: var(--success-color); color: white; border-radius: 10px; padding: 0 6px; font-size: 10px;">${entityResults.length}</span>
              </div>
              <div class="search-result-list" id="results-entities" style="display: block;">
                  ${entityResults.map(e => `
                      <div class="search-result-match" onclick="window.blueprintStudio.copyEntityId('${e.entity_id}')" style="padding: 6px 12px 6px 34px; cursor: pointer; font-size: 12px; border-bottom: 1px solid var(--border-color); display: flex; flex-direction: column;">
                          <div style="font-weight: 600; color: var(--text-primary);">${e.friendly_name || e.entity_id}</div>
                          <div style="font-family: monospace; color: var(--text-secondary); font-size: 11px;">${e.entity_id}</div>
                      </div>
                  `).join('')}
              </div>
          </div>`;
      }
      for (const [path, matches] of Object.entries(grouped)) {
          html += _buildFileGroupHtml(path, matches);
      }
      elements.globalSearchResults.innerHTML = html;

      const btnCollapse = document.getElementById('btn-collapse-search');
      if (btnCollapse) {
          const icon = btnCollapse.querySelector('.material-icons');
          if (icon) icon.textContent = 'unfold_less';
          btnCollapse.title = t("search.collapse_all");
      }
      return;
  }

  // Incremental patch: add new groups, append new matches to existing ones
  for (const [path, matches] of Object.entries(grouped)) {
      const safeId = path.replace(/[^a-zA-Z0-9]/g, '-');
      const existingGroup = document.getElementById(`group-${safeId}`);

      if (!existingGroup) {
          const div = document.createElement('div');
          div.innerHTML = _buildFileGroupHtml(path, matches);
          elements.globalSearchResults.appendChild(div.firstElementChild);
      } else {
          // Update badge count
          const badge = existingGroup.querySelector('.search-result-actions .badge');
          if (badge) badge.textContent = matches.length;

          // Append only newly arrived matches
          const list = document.getElementById(`results-${safeId}`);
          if (list) {
              const renderedCount = list.querySelectorAll('.search-result-match').length;
              for (let i = renderedCount; i < matches.length; i++) {
                  const matchId = `match-${safeId}-${i}`;
                  const matchDiv = document.createElement('div');
                  matchDiv.innerHTML = _buildMatchHtml(matches[i], matchId);
                  list.appendChild(matchDiv.firstElementChild);
              }
          }
      }
  }
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Exposes core functions to the window object for HTML onclick attributes
 */
export function initGlobalSearchWindowFunctions() {
    window.blueprintStudio = window.blueprintStudio || {};
    window.blueprintStudio.copyEntityId = copyEntityId;
    window.blueprintStudio.openFileAndScroll = openFileAndScroll;
    window.blueprintStudio.replaceSingleMatch = replaceSingleMatch;
    window.blueprintStudio.replaceInFile = replaceInFile;
}
