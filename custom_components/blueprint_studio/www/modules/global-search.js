/** GLOBAL-SEARCH.JS | Purpose: * Provides sidebar-based global search and replace functionality across all files. */
import { state, elements } from './state.js';
import { HA_ENTITIES } from './ha-autocomplete.js';
import { t, tp } from './translations.js';
import { fetchWithAuth, urlWithTicket } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE, STREAM_BASE } from './constants.js';
import { copyToClipboard } from './utils.js';
import { refreshActivityRail } from './activity-rail.js';
import { startOperationFeedback } from './feedback-service.js';
import {
  showToast,
  showConfirmDialog
} from './ui.js';

// Search is intentionally single-flight: a new query owns the result surface
// and cancels any stream/fallback still producing results for the old query.
let activeSearchController = null;
let activeSearchSequence = 0;

function isCurrentSearch(sequence, controller) {
  return sequence === activeSearchSequence && !controller.signal.aborted;
}

function setGlobalSearchLoading(visible) {
  if (!elements.globalSearchLoading) return;
  elements.globalSearchLoading.classList.toggle("active", visible);
  elements.globalSearchLoading.setAttribute("aria-hidden", String(!visible));
  refreshActivityRail();
}

/**
 * Performs global search across all files
 * @param {string} query - Search query
 * @param {Object} options - Search options (caseSensitive, useRegex, matchWord, include, exclude)
 */
export async function performGlobalSearch(query, options = {}) {
  if (!query || query.length < 2) return;

  activeSearchController?.abort();
  const controller = new AbortController();
  activeSearchController = controller;
  const sequence = ++activeSearchSequence;

  setGlobalSearchLoading(true);
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
      setGlobalSearchLoading(false);
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

      const response = await fetch(await urlWithTicket(`${STREAM_BASE}?${params}`), {
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("Stream unavailable");

      const fileResults = [];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!isCurrentSearch(sequence, controller)) return;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          let hadNew = false;
          for (const line of lines) {
              if (!line.trim()) continue;
              try { fileResults.push(JSON.parse(line)); hadNew = true; } catch { /* skip */ }
          }
          // Incrementally patch the DOM as each file's results arrive
          if (hadNew && isCurrentSearch(sequence, controller)) {
              state._lastGlobalSearchResults = fileResults;
              renderGlobalSearchResults(fileResults, entityMatches);
          }
      }

      if (!isCurrentSearch(sequence, controller)) return;
      setGlobalSearchLoading(false);
      state._lastGlobalSearchResults = fileResults;
      renderGlobalSearchResults(fileResults, entityMatches);

  } catch (streamErr) {
      // Fallback: POST-based search (no incremental render)
      if (controller.signal.aborted || sequence !== activeSearchSequence) return;
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
              signal: controller.signal,
          });
          if (!isCurrentSearch(sequence, controller)) return;
          const fileResults = Array.isArray(data) ? data : [];
          setGlobalSearchLoading(false);
          state._lastGlobalSearchResults = fileResults;
          renderGlobalSearchResults(fileResults, entityMatches);
      } catch (e) {
          if (controller.signal.aborted || sequence !== activeSearchSequence) return;
          setGlobalSearchLoading(false);
          console.error(t('search.global_failed_log'), e);
          if (elements.globalSearchResults) {
              elements.globalSearchResults.innerHTML = `<div class="global-search-error-state">${escapeHtml(t('search.global_failed', { error: e.message }))}</div>`;
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
                <div class="ui-empty-state search-empty-state">
                    <span class="ui-icon material-icons global-search-empty-icon">search</span>
                    <p class="global-search-empty-copy">${t("search.empty_state_text")}</p>
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
export async function copyEntityId(entityId) {
  const success = await copyToClipboard(entityId);
  showToast(success ? t('toast.copied_value', { value: entityId }) : t('toast.copy_failed'), success ? "success" : "error");
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

  const request = Object.freeze({
      query,
      replacement,
      caseSensitive: elements.btnMatchCase?.classList.contains("active") || false,
      useRegex: elements.btnUseRegex?.classList.contains("active") || false,
      matchWord: elements.btnMatchWord?.classList.contains("active") || false,
      include: elements.globalSearchInclude?.value || "",
      exclude: elements.globalSearchExclude?.value || "",
      matchCount: results.length,
      fileCount,
  });
  await runGlobalReplace(request);
}

function restoreGlobalSearchRequest(request) {
  eventBus.emit("ui:switch-sidebar-view", "search");
  if (elements.globalSearchInput) elements.globalSearchInput.value = request.query;
  if (elements.globalReplaceInput) elements.globalReplaceInput.value = request.replacement;
  if (elements.globalSearchInclude) elements.globalSearchInclude.value = request.include || "";
  if (elements.globalSearchExclude) elements.globalSearchExclude.value = request.exclude || "";
  for (const [button, active] of [
      [elements.btnMatchCase, request.caseSensitive],
      [elements.btnUseRegex, request.useRegex],
      [elements.btnMatchWord, request.matchWord],
  ]) {
      button?.classList.toggle("active", Boolean(active));
      button?.setAttribute("aria-pressed", String(Boolean(active)));
  }
  elements.globalReplaceContainer?.classList.add("expanded");
  elements.btnToggleReplaceAll?.classList.add("rotated");
  elements.btnToggleReplaceAll?.setAttribute("aria-expanded", "true");
  if (request.include || request.exclude) {
      elements.globalPatternsContainer?.classList.add("expanded");
      elements.btnTogglePatterns?.setAttribute("aria-expanded", "true");
  }
  setTimeout(() => elements.globalSearchInput?.focus(), 50);
}

function openGlobalSearchRequest(request) {
  restoreGlobalSearchRequest(request);
  triggerGlobalSearch();
}

async function runGlobalReplace(request) {
  const operation = startOperationFeedback({
      label: t('search_ops.replace_label', { query: request.query }),
      icon: "find_replace",
      scope: t('search_ops.workspace_scope'),
      target: request.include || t('search_ops.matches_in_files', { matches: request.matchCount, files: request.fileCount }),
      message: tp('search_ops.replacing_files', request.fileCount),
      retry: () => runGlobalReplace(request),
      open: () => openGlobalSearchRequest(request),
      openLabel: t('search_ops.open'),
      openIcon: "search",
  });

  try {
      const response = await fetchWithAuth(API_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              action: "global_replace",
              query: request.query,
              replacement: request.replacement,
              case_sensitive: request.caseSensitive,
              use_regex: request.useRegex,
              match_word: request.matchWord,
              include: request.include,
              exclude: request.exclude
          }),
      });

      if (response.success) {
          operation.finish(tp('search_ops.files_updated', response.files_updated || 0), {
              detail: tp('search_ops.matches_reviewed', request.matchCount),
          });
          eventBus.emit("ui:reload-files", { force: true });
          if (state.activeSidebarView === "search" && elements.globalSearchInput?.value === request.query) {
              triggerGlobalSearch();
          }
      } else {
          operation.fail(t('search_ops.workspace_replace_failed'), response.message || t('search_ops.replace_not_applied'));
      }
  } catch (e) {
      operation.fail(t('search_ops.workspace_replace_failed'), e.message);
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
        title: t('search_ops.replace_in_file_title'),
        message: t('search_ops.replace_in_file_message', { query: escapeHtml(query), replacement: escapeHtml(replacement), file: path.split('/').pop() }),
        confirmText: t('search_ops.replace_confirm'),
        cancelText: t('modal.cancel_button'),
        isDanger: true
    });

  if (!confirmed) return;

  const request = Object.freeze({
      query,
      replacement,
      path,
      caseSensitive: elements.btnMatchCase?.classList.contains('active') || false,
      useRegex: elements.btnUseRegex?.classList.contains('active') || false,
      matchWord: elements.btnMatchWord?.classList.contains('active') || false,
  });
  await runReplaceInFile(request);
}

async function runReplaceInFile(request) {
  const operation = startOperationFeedback({
      label: t('search_ops.replace_file_label', { file: request.path.split('/').pop() }),
      icon: "find_replace",
      scope: t('search_ops.workspace_scope'),
      target: request.path,
      message: t('search_ops.replacing_file'),
      retry: () => runReplaceInFile(request),
      open: () => openGlobalSearchRequest({ ...request, include: request.path, exclude: "" }),
      openLabel: t('search_ops.open'),
      openIcon: "search",
  });

    try {
        const response = await fetchWithAuth(API_BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "global_replace",
                query: request.query,
                replacement: request.replacement,
                include: request.path,
                case_sensitive: request.caseSensitive,
                use_regex: request.useRegex,
                match_word: request.matchWord
            }),
        });

        if (response.success) {
            operation.finish(t('search_ops.file_updated', { file: request.path.split('/').pop() }));
            const tab = state.openTabs.find(t => t.path === request.path);
            if (tab) eventBus.emit("file:open", { path: request.path, forceReload: true });
            if (state.activeSidebarView === "search" && elements.globalSearchInput?.value === request.query) {
                triggerGlobalSearch();
            }
        } else {
            operation.fail(t('search_ops.file_replace_failed'), response.message || t('search_ops.replace_not_applied'));
        }
    } catch (e) {
        operation.fail(t('search_ops.file_replace_failed'), e.message);
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
                showToast(t('toast.replacement_applied'), "success");
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
    return `<div class="search-result-match global-search-match-row" id="${matchId}" onclick="if(event.target.closest('.match-hover-actions')) return; window.blueprintStudio.openFileAndScroll('${escapedPath}', ${m.line})">
        <span class="global-search-match-line">${m.line}:</span>
        <span class="global-search-match-excerpt">${escapeHtml(m.content.trim())}</span>
        <div class="match-hover-actions global-search-match-actions">
            <span class="ui-icon material-icons global-search-match-action-icon" title="${t('search.replace_match')}" aria-label="${t('search.replace_match')}" onclick="event.stopPropagation(); window.blueprintStudio.replaceSingleMatch('${escapedPath}', ${m.line}, '${matchId}')">find_replace</span>
            <span class="ui-icon material-icons global-search-match-action-icon" title="${t('common.dismiss')}" aria-label="${t('common.dismiss')}" onclick="event.stopPropagation(); document.getElementById('${matchId}').remove()">close</span>
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
        <div class="search-result-file-header global-search-file-header" onclick="if(event.target.closest('.search-action-btn')) return; document.getElementById('results-${safeId}').classList.toggle('hidden'); this.querySelector('.arrow').classList.toggle('rotated');">
            <span class="ui-icon material-icons arrow rotated global-search-file-toggle-icon">chevron_right</span>
            <span class="global-search-file-name">${filename}</span>
            <span class="global-search-file-folder">${folder}</span>
            <div class="search-result-actions global-search-file-actions">
                <span class="ui-icon material-icons search-action-btn global-search-file-action-icon" title="${t('search.replace_file')}" aria-label="${t('search.replace_file')}" onclick="event.stopPropagation(); window.blueprintStudio.replaceInFile('${escapedPath}')">find_replace</span>
                <span class="ui-icon material-icons search-action-btn global-search-file-action-icon" title="${t('search.dismiss_file')}" aria-label="${t('search.dismiss_file')}" onclick="event.stopPropagation(); document.getElementById('group-${safeId}').remove()">close</span>
                <span class="badge global-search-file-badge">${matches.length}</span>
            </div>
        </div>
        <div class="search-result-list global-search-file-list" id="results-${safeId}">
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
          <div class="ui-empty-state search-empty-state">
              <span class="ui-icon material-icons global-search-empty-icon">search</span>
              <p class="global-search-empty-copy">${t("search.empty_state_text")}</p>
          </div>`;
      return;
  }

  if ((!results || results.length === 0) && (!entityResults || entityResults.length === 0)) {
      elements.globalSearchResults.innerHTML = `
          <div class="ui-empty-state search-empty-state">
              <span class="ui-icon material-icons global-search-empty-icon">search_off</span>
              <p class="global-search-empty-copy">${t("search.no_results")}</p>
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
              <div class="search-result-file-header global-search-file-header global-search-entity-header" onclick="document.getElementById('results-entities').classList.toggle('hidden'); this.querySelector('.arrow').classList.toggle('rotated');">
                  <span class="ui-icon material-icons arrow rotated global-search-file-toggle-icon">chevron_right</span>
                  <span class="global-search-file-name global-search-entity-title">${t("search.entities")}</span>
                  <span class="badge global-search-file-badge global-search-entity-badge">${entityResults.length}</span>
              </div>
              <div class="search-result-list global-search-file-list global-search-entity-list" id="results-entities">
                  ${entityResults.map(e => `
                      <div class="search-result-match global-search-entity-row" onclick="window.blueprintStudio.copyEntityId('${e.entity_id}')">
                          <div class="global-search-entity-name">${escapeHtml(e.friendly_name || e.entity_id)}</div>
                          <div class="global-search-entity-id">${escapeHtml(e.entity_id)}</div>
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
