import { renderMarkdown, addCodeCopyButtons, ensureMarkdownDependencies } from './asset-preview.js';
/** AI-UI.JS | Purpose: * Handles AI sidebar, chat interface, code formatting, and AI provider */
import { state } from './state.js';
import { copyToClipboard, ensureDiffLibrariesLoaded } from './utils.js';
import { eventBus } from './event-bus.js';
import { fetchWithAuth } from './api.js';
import { API_BASE } from './constants.js';
import { t, tp } from './translations.js';
import { saveSettings } from './settings.js';
import {
  AI_SIDEBAR_MIN_WIDTH,
  constrainAiSidebarWidth,
  getAiSidebarMaxWidth,
  isWorkspaceDrawerMode,
} from './workspace-layout.js';
import { captureEditorViewports, scheduleEditorViewportRestore } from './editor-viewport.js';
import { createDiffReviewToolbar, createDiffToggle, markWhitespaceOnlyChanges, renderTextDiff } from './diff-review.js';
import { startOperationFeedback } from './feedback-service.js';
import { MAX_AI_CHAT_HISTORY, appendBoundedHistory } from './history-limits.js';

let aiSidebarInitialized = false;
let activeAiRequest = null;
let aiContextPreviewController = null;
let aiContextPreviewTimer = null;
let lastAiPrompt = '';
const AI_PROPOSAL_HISTORY_KEY = 'blueprint-studio.ai-proposal-history.v1';
const AI_PROPOSAL_HISTORY_LIMIT = 20;

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function captureProposalEditorContext() {
  const editor = state.editor;
  if (!editor || !state.activeTab) return null;
  return {
    activePath: state.activeTab.path,
    editor,
    selections: editor.listSelections?.() || null,
    cursor: editor.getCursor?.() || null,
    scroll: editor.getScrollInfo?.() || null,
  };
}

function restoreProposalEditorContext(context) {
  if (!context || state.activeTab?.path !== context.activePath) return;
  requestAnimationFrame(() => {
    const editor = context.editor;
    if (!editor?.getWrapperElement?.()?.isConnected) return;
    if (context.selections?.length) editor.setSelections(context.selections);
    else if (context.cursor) editor.setCursor(context.cursor);
    if (context.scroll) editor.scrollTo(context.scroll.left, context.scroll.top);
    editor.focus();
  });
}

function readProposalHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(AI_PROPOSAL_HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, AI_PROPOSAL_HISTORY_LIMIT) : [];
  } catch (_error) {
    return [];
  }
}

let aiProposalHistory = readProposalHistory();

function writeProposalHistory() {
  aiProposalHistory = aiProposalHistory.slice(0, AI_PROPOSAL_HISTORY_LIMIT);
  try { localStorage.setItem(AI_PROPOSAL_HISTORY_KEY, JSON.stringify(aiProposalHistory)); } catch (_error) { /* Metadata history is optional. */ }
  renderProposalHistory();
}

function currentProviderLabel() {
  if (state.aiType === 'cloud') return state.cloudProvider || 'cloud';
  if (state.aiType === 'local-ai') return state.localAiProvider || 'local';
  if (state.aiType === 'hass-agent') return 'Home Assistant';
  return 'rule-based';
}

function revealAiStudio() {
  eventBus.emit('ui:toggle-ai-sidebar', true);
}

function compactPathTarget(paths = []) {
  const normalized = [...new Set((paths || []).filter(Boolean).map(String))];
  if (!normalized.length) return t('ai_ops.no_file_target');
  if (normalized.length === 1) return normalized[0];
  return tp('ai_ops.files_target', normalized.length, { path: normalized[0] });
}

function requestProviderLabel(request) {
  if (request.providerLabel) return request.providerLabel;
  if (request.ai_type === 'cloud') return request.cloud_provider || t('ai_ops.cloud_provider');
  if (request.ai_type === 'local-ai') return state.localAiProvider || t('ai_ops.local_ai');
  if (request.ai_type === 'hass-agent') return t('ai_ops.hass_agent');
  return t('ai_ops.rule_based_assistant');
}

function aiRequestTarget(request) {
  const mode = AI_TASK_MODES.has(request.task_mode) ? request.task_mode : 'ask';
  const path = String(request.current_file || '').replace(/^(sftp|ssh):\/\/[^/]+/i, '$1://remote');
  return [requestProviderLabel(request), mode, path].filter(Boolean).join(' -> ');
}

function startAiOperation({ label, icon, message, scope, target, retry, runningActions = [] }) {
  return startOperationFeedback({
    label,
    icon,
    message,
    scope,
    target,
    retry,
    runningActions,
    openLabel: t('ai_ops.ai_studio'),
    openIcon: 'smart_toy',
    open: revealAiStudio,
  });
}

function resultFailure(result, fallback) {
  return result?.message || result?.error || fallback;
}

function ensureProposalHistory(proposal) {
  if (!proposal?.id || aiProposalHistory.some(item => item.proposalId === proposal.id)) return;
  aiProposalHistory.unshift({
    proposalId: proposal.id,
    provider: currentProviderLabel(),
    timestamp: Date.now(),
    status: 'proposed',
    files: proposal.edits.map(edit => edit.path),
  });
  writeProposalHistory();
}

function updateProposalHistory(proposalId, status, details = {}) {
  const entry = aiProposalHistory.find(item => item.proposalId === proposalId);
  if (!entry) return;
  Object.assign(entry, details, { status });
  writeProposalHistory();
}

async function reloadProposalPaths(paths) {
  for (const path of paths || []) {
    const openTab = state.openTabs.find(tab => tab.path === path);
    if (openTab) await Promise.all(eventBus.emit('file:open', {
      path, forceReload: true, noActivate: state.activeTab?.path !== path,
    }));
  }
  eventBus.emit('ui:refresh-tree');
  eventBus.emit('ui:refresh-tabs');
}

function renderProposalHistory() {
  const tray = document.getElementById('ai-proposal-history');
  const list = document.getElementById('ai-proposal-history-list');
  if (!tray || !list) return;
  tray.classList.toggle('hidden', aiProposalHistory.length === 0);
  list.replaceChildren();
  aiProposalHistory.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'ai-proposal-history-row';
    const files = document.createElement('strong');
    files.textContent = entry.files.join(', ');
    const meta = document.createElement('span');
    meta.textContent = `${entry.provider} · ${new Date(entry.timestamp).toLocaleString()} · ${entry.status}`;
    row.append(files, meta);
    if (entry.status === 'applied' && entry.undoId && entry.undoExpiresAt * 1000 > Date.now()) {
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'ui-button';
      undo.textContent = t('ai.proposal_undo') || 'Undo apply';
      undo.addEventListener('click', async () => {
        const editorContext = captureProposalEditorContext();
        undo.disabled = true;
        const undone = await undoAiProposal({
          proposalId: entry.proposalId,
          undoId: entry.undoId,
          files: [...entry.files],
        }, editorContext);
        if (!undone) undo.disabled = false;
      });
      row.appendChild(undo);
    }
    list.appendChild(row);
  });
}

export async function undoAiProposal(request, editorContext = null) {
  const immutableRequest = {
    proposalId: String(request.proposalId || ''),
    undoId: String(request.undoId || ''),
    files: [...new Set((request.files || []).map(String))],
  };
  const operation = startAiOperation({
    label: t('ai_ops.undo_label'),
    icon: 'undo',
    message: t('ai_ops.undo_restoring'),
    scope: t('ai_ops.proposal_scope'),
    target: compactPathTarget(immutableRequest.files),
    retry: () => undoAiProposal(immutableRequest),
  });
  try {
    const result = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ai_undo_proposal', undo_id: immutableRequest.undoId }),
    });
    if (!result?.success) throw new Error(resultFailure(result, t('ai_ops.undo_rejected')));
    const restoredPaths = result.restored_paths || immutableRequest.files;
    operation.finish(tp('ai_ops.restored_files', restoredPaths.length), {
      detail: compactPathTarget(restoredPaths),
    });
    await reloadProposalPaths(restoredPaths);
    updateProposalHistory(immutableRequest.proposalId, 'undone', { undoId: null });
    setAiRequestState('applied', t('ai.proposal_undone') || 'Proposal apply undone.');
    restoreProposalEditorContext(editorContext);
    return true;
  } catch (error) {
    operation.fail(t('ai_ops.undo_failed'), error.message, {
      detail: t('ai_ops.undo_retry_detail'),
    });
    updateProposalHistory(immutableRequest.proposalId, 'conflicted');
    setAiRequestState('conflicted', error.message);
    return false;
  }
}

const AI_TASK_MODES = new Set(['ask', 'explain', 'generate', 'fix', 'refactor']);

function currentAiContextPayload(query = '') {
  const includeFile = state.aiIncludeFileContext !== false;
  return {
    query,
    current_file: includeFile && state.activeTab ? state.activeTab.path : null,
    file_content: includeFile && state.activeTab && state.editor ? state.editor.getValue() : null,
    selected_excerpt: includeFile && state.activeTab && state.editor ? state.editor.getSelection() : null,
    task_mode: AI_TASK_MODES.has(state.aiTaskMode) ? state.aiTaskMode : 'ask',
    include_file_context: includeFile,
    include_metadata: state.aiIncludeMetadata !== false,
  };
}

function setAiRequestState(status, message, { canCancel = false, canRetry = false } = {}) {
  const container = document.getElementById('ai-request-status');
  const text = document.getElementById('ai-request-status-text');
  const cancel = document.getElementById('btn-ai-cancel');
  const retry = document.getElementById('btn-ai-retry');
  const send = document.getElementById('btn-ai-send');
  const sidebar = document.getElementById('ai-sidebar');
  if (!container || !text) return;
  container.dataset.state = status;
  container.dataset.retryable = String(canRetry);
  text.textContent = message;
  cancel?.classList.toggle('hidden', !canCancel);
  retry?.classList.toggle('hidden', !canRetry);
  if (send) send.disabled = ['running', 'cancelling', 'validating'].includes(status);
  sidebar?.setAttribute('aria-busy', String(['running', 'cancelling', 'validating'].includes(status)));
}

async function cancelAiRequest(request = activeAiRequest) {
  if (!request || request.cancelRequested) return false;
  request.cancelRequested = true;
  setAiRequestState('cancelling', t('ai.state_cancelling') || 'Cancelling request...');
  request.operation?.update({
    status: 'cancelling',
    message: t('ai_ops.cancel_requesting'),
    actions: [],
  });
  try {
    const result = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ai_cancel', request_id: request.requestId }),
    });
    request.cancelDetail = result?.success
      ? t('ai_ops.cancel_confirmed')
      : t('ai_ops.cancel_unconfirmed', { error: resultFailure(result, t('ai_ops.unknown_response')) });
    return Boolean(result?.success);
  } catch (error) {
    request.cancelDetail = t('ai_ops.cancel_error', { error: error.message });
    return false;
  } finally {
    request.controller.abort();
  }
}

function setAiTaskMode(mode) {
  if (!AI_TASK_MODES.has(mode)) return;
  state.aiTaskMode = mode;
  document.getElementById('ai-sidebar')?.querySelectorAll('[data-ai-mode]').forEach((button) => {
    const selected = button.dataset.aiMode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  saveSettings();
  scheduleAiContextPreview();
}

function renderAiContextPreview(context) {
  const list = document.getElementById('ai-context-list');
  const preview = document.getElementById('ai-context-preview');
  const summary = document.getElementById('ai-context-summary');
  if (!list || !preview || !summary) return;
  list.replaceChildren();

  const entries = [
    [t('ai.context_active_file') || 'Active file', context.current_file || (t('ai.context_none') || 'Not included')],
    [t('ai.context_selection') || 'Selection', context.selection_used ? (t('ai.context_included') || 'Included') : (t('ai.context_not_selected') || 'No selection')],
    [t('ai.context_referenced_files') || 'Referenced files', t('ai.context_none') || 'None'],
    [t('ai.context_metadata') || 'HA metadata', context.metadata_included ? (context.metadata_authority || t('ai.context_included') || 'Included') : (t('ai.context_none') || 'Not included')],
  ];
  entries.forEach(([label, value]) => {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  });

  const redactions = Number(context.redaction_count || 0);
  const parts = Number(Boolean(context.current_file)) + Number(Boolean(context.metadata_included));
  summary.textContent = `${t('ai.context_title') || 'Request context'} · ${parts} ${t('ai.context_sources') || 'sources'}`;
  preview.replaceChildren();
  const notice = document.createElement('p');
  notice.textContent = redactions
    ? `${redactions} ${t('ai.context_redacted') || 'sensitive value(s) redacted before submission.'}`
    : (t('ai.context_no_redactions') || 'No sensitive values detected in the request context.');
  preview.appendChild(notice);
  if (context.file_excerpt) {
    const excerpt = document.createElement('pre');
    excerpt.textContent = context.file_excerpt;
    excerpt.setAttribute('aria-label', t('ai.context_excerpt') || 'Sanitized request excerpt');
    preview.appendChild(excerpt);
  }
}

async function refreshAiContextPreview() {
  const preview = document.getElementById('ai-context-preview');
  if (!preview) return;
  aiContextPreviewController?.abort();
  const controller = new AbortController();
  aiContextPreviewController = controller;
  preview.textContent = t('ai.context_loading') || 'Checking request context...';
  try {
    const payload = currentAiContextPayload(document.getElementById('ai-chat-input')?.value.trim() || '');
    const result = await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ action: 'ai_preview_context', ai_type: state.aiType, ...payload }),
    });
    if (!controller.signal.aborted) renderAiContextPreview(result.context || {});
  } catch (error) {
    if (error.name !== 'AbortError') preview.textContent = error.message;
  } finally {
    if (aiContextPreviewController === controller) aiContextPreviewController = null;
  }
}

function scheduleAiContextPreview() {
  window.clearTimeout(aiContextPreviewTimer);
  aiContextPreviewTimer = window.setTimeout(refreshAiContextPreview, 250);
}

function processingBoundaryText() {
  let boundary;
  if (state.aiType === 'cloud') boundary = t('ai.processing_cloud', { provider: state.cloudProvider || t('ai.configured_provider') });
  else if (state.aiType === 'local-ai') boundary = t('ai.processing_local', { provider: state.localAiProvider || t('ai.configured_provider') });
  else if (state.aiType === 'hass-agent') boundary = t('ai.processing_hass');
  else return t('ai.processing_rule_based');

  const sources = [];
  if (state.aiIncludeFileContext !== false) sources.push(t('ai.boundary_file_context') || 'document or selection');
  if (state.aiIncludeMetadata !== false) sources.push(t('ai.boundary_metadata') || 'relevant HA metadata');
  return `${boundary} · ${t('ai.boundary_sends') || 'Sends'}: ${sources.join(', ') || (t('ai.context_none') || 'nothing')}`;
}

export function updateAIProcessingBoundary() {
  const boundary = document.getElementById('ai-processing-boundary');
  if (boundary) boundary.textContent = processingBoundaryText();
}

function applyAiSidebarWidth(width = state.aiSidebarWidth) {
  const sidebar = document.getElementById('ai-sidebar');
  const handle = document.getElementById('ai-sidebar-resize-handle');
  if (!sidebar || !handle) return;

  if (isWorkspaceDrawerMode()) {
    sidebar.style.removeProperty('width');
    return;
  }

  const maxWidth = getAiSidebarMaxWidth();
  const nextWidth = constrainAiSidebarWidth(width);
  sidebar.style.width = `${nextWidth}px`;
  handle.setAttribute('aria-valuemin', String(AI_SIDEBAR_MIN_WIDTH));
  handle.setAttribute('aria-valuemax', String(maxWidth));
  handle.setAttribute('aria-valuenow', String(Math.round(nextWidth)));
}

function initAiSidebar() {
  if (aiSidebarInitialized) return;
  const sidebar = document.getElementById('ai-sidebar');
  const handle = document.getElementById('ai-sidebar-resize-handle');
  if (!sidebar || !handle) return;
  aiSidebarInitialized = true;

  let resizing = false;

  const setWidthFromPointer = (clientX) => {
    const workspaceRight = document.querySelector('.main-content')?.getBoundingClientRect().right || window.innerWidth;
    applyAiSidebarWidth(workspaceRight - clientX);
  };

  handle.addEventListener('pointerdown', (event) => {
    if (isWorkspaceDrawerMode()) return;
    resizing = true;
    handle.classList.add('active');
    document.body.classList.add('ai-sidebar-resizing');
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (resizing) setWidthFromPointer(event.clientX);
  });

  const finishResize = () => {
    if (!resizing) return;
    resizing = false;
    handle.classList.remove('active');
    document.body.classList.remove('ai-sidebar-resizing');
    state.aiSidebarWidth = Math.round(sidebar.getBoundingClientRect().width);
    saveSettings();
    state.editor?.refresh();
  };

  handle.addEventListener('pointerup', finishResize);
  handle.addEventListener('pointercancel', finishResize);
  handle.addEventListener('keydown', (event) => {
    const maxWidth = getAiSidebarMaxWidth();
    const currentWidth = sidebar.getBoundingClientRect().width;
    const step = event.shiftKey ? 40 : 10;
    let nextWidth = currentWidth;
    if (event.key === 'ArrowLeft') nextWidth += step;
    else if (event.key === 'ArrowRight') nextWidth -= step;
    else if (event.key === 'Home') nextWidth = AI_SIDEBAR_MIN_WIDTH;
    else if (event.key === 'End') nextWidth = maxWidth;
    else return;

    event.preventDefault();
    applyAiSidebarWidth(nextWidth);
    state.aiSidebarWidth = Math.round(sidebar.getBoundingClientRect().width);
    saveSettings();
    state.editor?.refresh();
  });

  document.getElementById('ai-sidebar')?.querySelectorAll('[data-ai-mode]').forEach((button) => {
    button.addEventListener('click', () => setAiTaskMode(button.dataset.aiMode));
  });
  const includeFile = document.getElementById('ai-include-file-context');
  const includeMetadata = document.getElementById('ai-include-metadata');
  includeFile.checked = state.aiIncludeFileContext !== false;
  includeMetadata.checked = state.aiIncludeMetadata !== false;
  includeFile.addEventListener('change', () => {
    state.aiIncludeFileContext = includeFile.checked;
    updateAIProcessingBoundary();
    saveSettings();
    scheduleAiContextPreview();
  });
  includeMetadata.addEventListener('change', () => {
    state.aiIncludeMetadata = includeMetadata.checked;
    updateAIProcessingBoundary();
    saveSettings();
    scheduleAiContextPreview();
  });
  document.getElementById('ai-chat-input')?.addEventListener('input', scheduleAiContextPreview);
  document.getElementById('ai-context-tray')?.addEventListener('toggle', (event) => {
    if (event.currentTarget.open) refreshAiContextPreview();
  });
  document.getElementById('btn-ai-cancel')?.addEventListener('click', () => {
    void cancelAiRequest();
  });
  document.getElementById('btn-ai-retry')?.addEventListener('click', () => {
    const input = document.getElementById('ai-chat-input');
    if (!input || !lastAiPrompt) return;
    input.value = lastAiPrompt;
    sendAIChatMessage();
  });
  setAiTaskMode(state.aiTaskMode || 'ask');
  renderProposalHistory();

  window.addEventListener('resize', () => applyAiSidebarWidth());
  applyAiSidebarWidth();
}

function setAiSidebarVisibility(visible, { restoreFocus = false } = {}) {
  const sidebar = document.getElementById('ai-sidebar');
  const button = document.getElementById('btn-ai-studio');
  if (!sidebar) return;
  const editorSnapshots = captureEditorViewports();

  const show = Boolean(visible && state.aiIntegrationEnabled);
  if (show && isWorkspaceDrawerMode() && state.sidebarVisible) {
    eventBus.emit('ui:hide-sidebar');
  }
  sidebar.classList.toggle('hidden', !show);
  sidebar.classList.toggle('visible', show);
  sidebar.setAttribute('aria-hidden', String(!show));
  button?.setAttribute('aria-expanded', String(show));
  state.aiSidebarVisible = show;
  const overlay = document.getElementById('sidebar-overlay');
  if (isWorkspaceDrawerMode()) {
    overlay?.classList.toggle('visible', show || state.sidebarVisible);
  }

  if (show) {
    applyAiSidebarWidth();
    updateAIProcessingBoundary();
    renderAiChatHistory();
    void ensureMarkdownDependencies().then(renderAiChatHistory).catch(error => {
      console.warn('[AI] Markdown renderer unavailable:', error);
    });
    scheduleAiContextPreview();
    document.getElementById('ai-chat-input')?.focus();
  } else if (restoreFocus && button && !button.classList.contains('hidden')) {
    button.focus();
  }
  scheduleEditorViewportRestore(editorSnapshots);
}

/**
 * Updates visibility of AI integration button based on settings
 */
export function updateAIVisibility() {
  initAiSidebar();
  updateAIProcessingBoundary();
  const btnAI = document.getElementById("btn-ai-studio");
  if (btnAI) {
    btnAI.classList.toggle("hidden", !state.aiIntegrationEnabled);
    btnAI.setAttribute('aria-controls', 'ai-sidebar');
  }
  setAiSidebarVisibility(state.aiSidebarVisible);
}

/**
 * Renders the saved AI chat history into the sidebar
 */
export function renderAiChatHistory() {
  const messagesContainer = document.getElementById("ai-chat-messages");
  if (!messagesContainer) {
    console.warn("[AI-UI] messagesContainer not found");
    return;
  }

  // Preserve the initial assistant message if history is empty
  const initialMessageHtml = `<div class="ai-message ai-message-assistant">${t("ai.initial_message") || "Hello! I'm your AI Copilot. I can help you generate automations, fix YAML errors, or explain Home Assistant configurations. How can I help you today?"}</div>`;
  
  if (!state.aiChatHistory || state.aiChatHistory.length === 0) {
    messagesContainer.innerHTML = initialMessageHtml;
    return;
  }

  let html = "";
  state.aiChatHistory.forEach(msg => {
    if (msg.role === 'user') {
      html += `<div class="ai-message ai-message-user">${escapeHtml(msg.text)}</div>`;
    } else {
      html += `<div class="ai-message ai-message-assistant">${formatAiResponse(msg.text)}</div>`;
    }
  });

  messagesContainer.innerHTML = html;
  
  // Add copy buttons to all assistant messages
  messagesContainer.querySelectorAll(".ai-message-assistant").forEach(msg => {
    addCodeCopyButtons(msg);
  });
  
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Helper to escape HTML for user messages
 */
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Toggles the AI sidebar open/closed
 */
export function toggleAISidebar(forceVisible) {
  initAiSidebar();
  const aiSidebar = document.getElementById("ai-sidebar");
  if (!aiSidebar) return;

  const visible = typeof forceVisible === 'boolean'
    ? forceVisible
    : !state.aiSidebarVisible;
  setAiSidebarVisibility(visible, { restoreFocus: !visible });
  saveSettings();
}

/**
 * Formats AI response text with markdown-style formatting
 * @param {string} text - Raw AI response text
 * @returns {string} HTML formatted response
 */
export function formatAiResponse(text) {
  if (!text) return "";
  return `<div class="markdown-body ai-response-markdown">${renderMarkdown(text)}</div>`;
}

function hasUnsavedProposalTargets(proposal, selectedPaths = null) {
  const paths = new Set(selectedPaths || (proposal?.edits || []).map(edit => edit.path));
  return state.openTabs.some(tab => paths.has(tab.path) && tab.modified);
}

function appendStructuredList(section, headingText, values, className) {
  if (!values.length) return;
  const group = document.createElement('div');
  group.className = className;
  const heading = document.createElement('strong');
  heading.textContent = headingText;
  const list = document.createElement('ul');
  values.forEach((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    list.appendChild(item);
  });
  group.append(heading, list);
  section.appendChild(group);
}

function renderGenerationValidation(container, result) {
  const validations = result.proposal_validation
    || result.proposal?.validation
    || result.generation_validation
    || [];
  const unresolvedReferences = result.generation_context?.unresolved_references || [];
  if ((!Array.isArray(validations) || validations.length === 0) && !unresolvedReferences.length) return;

  const section = document.createElement('section');
  section.className = 'ai-generation-validation';
  const heading = document.createElement('strong');
  heading.textContent = t('ai.validation_heading') || 'Generation validation';
  section.appendChild(heading);

  const authorities = new Set();
  const assumptions = new Set();
  const findings = [];
  validations.forEach((validation) => {
    (validation.authority || []).forEach(authority => authorities.add(authority));
    (validation.assumptions || []).forEach(assumption => assumptions.add(assumption));
    (validation.findings || []).forEach(finding => findings.push(finding));
  });

  const authority = document.createElement('p');
  authority.className = 'ai-validation-authority';
  authority.textContent = `${t('ai.validation_authority') || 'Authority'}: ${[...authorities].join(', ') || 'YAML parser'}`;
  section.appendChild(authority);

  appendStructuredList(
    section,
    t('ai.validation_findings') || 'Validation findings',
    findings.map(finding => `${finding.message}${finding.path ? ` (${finding.path})` : ''}`),
    'ai-validation-findings',
  );
  appendStructuredList(
    section,
    t('ai.assumptions') || 'Assumptions',
    [...assumptions],
    'ai-validation-assumptions',
  );
  appendStructuredList(
    section,
    t('ai.placeholders') || 'Placeholders to resolve',
    unresolvedReferences,
    'ai-validation-placeholders',
  );

  if (result.configuration_check?.available) {
    const status = document.createElement('div');
    status.className = 'ai-proposal-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-button';
    button.innerHTML = `<span class="ui-icon material-icons" aria-hidden="true">fact_check</span>${escapeHtml(t('ai.run_config_check'))}`;
    button.addEventListener('click', () => runAiConfigurationCheck({ statusElement: status, button }));
    section.append(button, status);
  }
  container.appendChild(section);
}

export async function runAiConfigurationCheck({ statusElement = null, button = null } = {}) {
  const operation = startOperationFeedback({
    label: t('ai_ops.check_label'),
    icon: 'fact_check',
    message: t('ai_ops.checking_configuration'),
    scope: t('ai_ops.ha_instance'),
    target: t('ai_ops.active_configuration'),
    retry: runAiConfigurationCheck,
    openLabel: t('ai_ops.developer_tools'),
    openIcon: 'construction',
    open: () => eventBus.emit('ha:dev-tools', { tab: 'config' }),
  });
  if (button) button.disabled = true;
  if (statusElement) statusElement.textContent = t('ai.config_check_running');
  try {
    const response = await fetchWithAuth(`${API_BASE}?action=run_config_check`);
    if (response?.success === false) throw new Error(resultFailure(response, t('ai_ops.check_rejected')));
    const check = response?.result || {};
    const message = check.output || (check.success
      ? t('ai.config_check_passed')
      : t('ai.config_check_unavailable'));
    if (!check.success) {
      operation.fail(t('ai_ops.check_failed'), message);
      if (statusElement) statusElement.textContent = message;
      return false;
    }
    operation.finish(t('ai_ops.check_passed'), { detail: message });
    if (statusElement) statusElement.textContent = message;
    return true;
  } catch (error) {
    operation.fail(t('ai_ops.check_failed'), error.message);
    if (statusElement) statusElement.textContent = error.message;
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function buildProposalDiff(edit) {
  const before = edit.old_content || '';
  if (!window.diff_match_patch) {
    return before === edit.new_content ? [] : [
      { type: 'removed', text: before, change: 0 },
      { type: 'added', text: edit.new_content, change: 1 },
    ];
  }
  const engine = new window.diff_match_patch();
  const encoded = engine.diff_linesToChars_(before, edit.new_content);
  const diffs = engine.diff_main(encoded.chars1, encoded.chars2, false);
  engine.diff_charsToLines_(diffs, encoded.lineArray);
  engine.diff_cleanupSemantic(diffs);
  let change = 0;
  const rows = [];
  diffs.forEach(([operation, content]) => {
    if (operation === 0) return;
    content.replace(/\n$/, '').split('\n').forEach((line) => {
      rows.push({ type: operation > 0 ? 'added' : 'removed', text: line, change });
    });
    change += 1;
  });
  return rows;
}

function renderProposalDiff(target, edit, rows, mode, { hideWhitespace = false, wrapLines = true } = {}) {
  target.replaceChildren();
  target.dataset.mode = mode;
  target.classList.toggle('diff-text-viewer--wrap', wrapLines);
  if (mode === 'side') {
    for (const [label, content] of [
      [t('ai.proposal_before') || 'Before', edit.old_content ?? (t('ai.proposal_new_file') || 'New file')],
      [t('ai.proposal_after') || 'After', edit.new_content],
    ]) {
      const pane = document.createElement('div');
      const heading = document.createElement('span');
      const code = document.createElement('pre');
      heading.textContent = label;
      code.textContent = content;
      pane.append(heading, code);
      target.appendChild(pane);
    }
    return;
  }
  const visibleRows = hideWhitespace ? rows.filter(row => !row.whitespaceOnly) : rows;
  if (!visibleRows.length) {
    renderTextDiff(target, visibleRows, {
      emptyMessage: t('ai.proposal_no_changes') || 'No content changes.',
      extraLineClass: 'ai-proposal-diff-line',
    });
    return;
  }
  renderTextDiff(target, visibleRows, { extraLineClass: 'ai-proposal-diff-line' });
}

async function renderProposalReview(container, proposal, editorContext = captureProposalEditorContext()) {
  if (!proposal?.id || !Array.isArray(proposal.edits) || proposal.edits.length === 0) return;
  ensureProposalHistory(proposal);
  try {
    await ensureDiffLibrariesLoaded();
  } catch (_error) {
    // The raw before/after fallback remains available if optional diff assets fail.
  }
  const selectedPaths = new Set(proposal.edits.map(edit => edit.path));
  const review = document.createElement('section');
  review.className = 'ai-proposal-review';
  review.setAttribute('aria-label', t('ai.proposal_review') || 'Review proposed changes');

  const heading = document.createElement('div');
  heading.className = 'ai-proposal-heading';
  const headingLabel = document.createElement('strong');
  headingLabel.textContent = `${t('ai.proposal_review') || 'Review proposed changes'} · ${proposal.edits.length} ${t('ai.proposal_files') || 'files'}`;
  const headingIcon = document.createElement('span');
  headingIcon.className = 'ui-icon material-icons';
  headingIcon.setAttribute('aria-hidden', 'true');
  headingIcon.textContent = 'difference';
  heading.append(headingIcon, headingLabel);
  review.appendChild(heading);

  proposal.edits.forEach((edit, fileIndex) => {
    const rows = markWhitespaceOnlyChanges(buildProposalDiff(edit));
    const changeCount = new Set(rows.map(row => row.change)).size;
    const details = document.createElement('details');
    details.className = 'ai-proposal-file';
    details.open = fileIndex === 0;
    const summary = document.createElement('summary');
    const selection = document.createElement('input');
    selection.type = 'checkbox';
    selection.checked = true;
    selection.setAttribute('aria-label', `${t('ai.proposal_select') || 'Include'} ${edit.path}`);
    selection.addEventListener('click', event => event.stopPropagation());
    selection.addEventListener('change', () => {
      if (selection.checked) selectedPaths.add(edit.path);
      else selectedPaths.delete(edit.path);
      updateApplySelected();
    });
    const path = document.createElement('span');
    path.textContent = edit.path;
    const fileStatus = document.createElement('span');
    fileStatus.className = 'ai-proposal-operation';
    fileStatus.textContent = `${edit.operation} · ${changeCount} ${t('ai.proposal_changes') || 'changes'}`;
    summary.append(selection, path, fileStatus);
    details.appendChild(summary);

    const previous = document.createElement('button');
    const next = document.createElement('button');
    for (const [button, icon, label] of [
      [previous, 'keyboard_arrow_up', t('ai.proposal_previous_change') || 'Previous change'],
      [next, 'keyboard_arrow_down', t('ai.proposal_next_change') || 'Next change'],
    ]) {
      button.type = 'button';
      button.className = 'ui-icon-button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = `<span class="ui-icon material-icons" aria-hidden="true">${icon}</span>`;
      button.disabled = changeCount === 0;
    }
    const modeControl = document.createElement('div');
    modeControl.className = 'ui-segmented-control ai-proposal-diff-mode';
    const inline = document.createElement('button');
    const side = document.createElement('button');
    inline.type = side.type = 'button';
    inline.className = 'ui-segmented-control-item active';
    side.className = 'ui-segmented-control-item';
    inline.textContent = t('ai.proposal_inline') || 'Inline';
    side.textContent = t('ai.proposal_side') || 'Side by side';
    modeControl.append(inline, side);
    const whitespace = createDiffToggle('space_bar', 'Hide whitespace-only changes');
    const wrap = createDiffToggle('wrap_text', 'Wrap long lines', true);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ui-icon-button';
    copy.title = t('ai.proposal_copy') || 'Copy proposed file';
    copy.setAttribute('aria-label', copy.title);
    copy.innerHTML = '<span class="ui-icon material-icons" aria-hidden="true">content_copy</span>';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'ui-button';
    editButton.textContent = t('ai.proposal_edit') || 'Edit proposal';
    const toolbar = createDiffReviewToolbar({
      summary: `${changeCount} ${t('ai.proposal_changes') || 'changes'}`,
      controls: [previous, next, whitespace, wrap, modeControl, copy, editButton],
      label: t('ai.proposal_review_controls') || 'Proposal diff controls',
      className: 'ai-proposal-diff-toolbar',
    });
    details.appendChild(toolbar);

    const diff = document.createElement('div');
    diff.className = 'ai-proposal-comparison';
    let diffMode = 'inline';
    let hideWhitespace = false;
    let wrapLines = true;
    const renderDiff = () => renderProposalDiff(diff, edit, rows, diffMode, { hideWhitespace, wrapLines });
    renderDiff();
    details.appendChild(diff);
    let changeIndex = 0;
    const jump = (direction) => {
      if (!changeCount) return;
      if (diffMode === 'side') {
        diffMode = 'inline';
        inline.classList.add('active');
        side.classList.remove('active');
        renderDiff();
      }
      const availableChanges = [...new Set((hideWhitespace ? rows.filter(row => !row.whitespaceOnly) : rows).map(row => row.change))];
      if (!availableChanges.length) return;
      changeIndex = (changeIndex + direction + availableChanges.length) % availableChanges.length;
      diff.querySelector(`[data-change-index="${availableChanges[changeIndex]}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    previous.addEventListener('click', () => jump(-1));
    next.addEventListener('click', () => jump(1));
    inline.addEventListener('click', () => {
      inline.classList.add('active');
      side.classList.remove('active');
      diffMode = 'inline';
      renderDiff();
    });
    side.addEventListener('click', () => {
      side.classList.add('active');
      inline.classList.remove('active');
      diffMode = 'side';
      hideWhitespace = false;
      whitespace.setAttribute('aria-pressed', 'false');
      renderDiff();
    });
    whitespace.addEventListener('click', () => {
      hideWhitespace = !hideWhitespace;
      diffMode = 'inline';
      inline.classList.add('active');
      side.classList.remove('active');
      whitespace.setAttribute('aria-pressed', String(hideWhitespace));
      whitespace.title = hideWhitespace ? 'Show whitespace-only changes' : 'Hide whitespace-only changes';
      whitespace.setAttribute('aria-label', whitespace.title);
      changeIndex = 0;
      renderDiff();
    });
    wrap.addEventListener('click', () => {
      wrapLines = !wrapLines;
      wrap.setAttribute('aria-pressed', String(wrapLines));
      renderDiff();
    });
    copy.addEventListener('click', async () => {
      await copyToClipboard(edit.new_content);
      status.textContent = t('ai.proposal_copied') || 'Proposal text copied. No files were changed.';
    });
    editButton.addEventListener('click', () => {
      const editor = document.createElement('textarea');
      editor.className = 'ai-proposal-editor';
      editor.value = edit.new_content;
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'ui-button';
      save.dataset.variant = 'primary';
      save.textContent = t('ai.proposal_save_review') || 'Save for review';
      diff.replaceChildren(editor, save);
      editor.focus();
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const result = await fetchWithAuth(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'ai_revise_proposal',
              proposal_id: proposal.id,
              path: edit.path,
              new_content: editor.value,
            }),
          });
          updateProposalHistory(proposal.id, 'rejected');
          review.remove();
          await renderProposalReview(container, result.proposal, editorContext);
          setAiRequestState('proposed', t('ai.proposal_revised') || 'Edited proposal ready for review.');
        } catch (error) {
          status.textContent = error.message;
          save.disabled = false;
        }
      });
    });
    review.appendChild(details);
  });

  const status = document.createElement('div');
  status.className = 'ai-proposal-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'ai-proposal-actions';
  const rejectButton = document.createElement('button');
  rejectButton.type = 'button';
  rejectButton.className = 'ui-button';
  rejectButton.textContent = t('ai.proposal_reject') || 'Reject';
  const copyAllButton = document.createElement('button');
  copyAllButton.type = 'button';
  copyAllButton.className = 'ui-button';
  copyAllButton.textContent = t('ai.proposal_copy_selected') || 'Copy selected';
  const applySelectedButton = document.createElement('button');
  applySelectedButton.type = 'button';
  applySelectedButton.className = 'ui-button';
  const applyAllButton = document.createElement('button');
  applyAllButton.type = 'button';
  applyAllButton.className = 'ui-button';
  applyAllButton.dataset.variant = 'primary';
  applyAllButton.textContent = t('ai.proposal_apply_all') || 'Apply all';
  const updateApplySelected = () => {
    applySelectedButton.textContent = `${t('ai.proposal_apply_selected') || 'Apply selected'} (${selectedPaths.size})`;
    applySelectedButton.disabled = selectedPaths.size === 0 || selectedPaths.size === proposal.edits.length;
    copyAllButton.disabled = selectedPaths.size === 0;
  };
  updateApplySelected();
  actions.append(rejectButton, copyAllButton, applySelectedButton, applyAllButton);
  review.append(status, actions);
  container.appendChild(review);

  const setBusy = (busy) => {
    actions.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    review.setAttribute('aria-busy', String(busy));
  };
  const reject = async (proposalId = proposal.id, { restoreEditor = true } = {}) => {
    await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ai_reject_proposal', proposal_id: proposalId }),
    });
    status.textContent = t('ai.proposal_rejected') || 'Proposal rejected. No files were changed.';
    updateProposalHistory(proposalId, 'rejected');
    setAiRequestState('rejected', status.textContent);
    actions.remove();
    if (restoreEditor) restoreProposalEditorContext(editorContext);
  };
  rejectButton.addEventListener('click', async () => {
    setBusy(true);
    try { await reject(); } catch (error) { status.textContent = error.message; setBusy(false); }
  });
  copyAllButton.addEventListener('click', async () => {
    const text = proposal.edits
      .filter(edit => selectedPaths.has(edit.path))
      .map(edit => `# ${edit.path}\n${edit.new_content}`)
      .join('\n\n');
    await copyToClipboard(text);
    status.textContent = t('ai.proposal_copied') || 'Proposal text copied. No files were changed.';
  });

  const showConflict = (result) => {
    updateProposalHistory(proposal.id, 'conflicted');
    setAiRequestState('conflicted', result.message || (t('ai.proposal_conflict') || 'Files changed after this proposal was created.'));
    status.textContent = result.message || (t('ai.proposal_conflict') || 'Files changed after this proposal was created.');
    actions.replaceChildren();
    const compare = document.createElement('button');
    const regenerate = document.createElement('button');
    const discard = document.createElement('button');
    for (const [button, label] of [
      [compare, t('ai.proposal_compare_current') || 'Compare with current'],
      [regenerate, t('ai.proposal_regenerate') || 'Regenerate'],
      [discard, t('ai.proposal_discard') || 'Discard'],
    ]) { button.type = 'button'; button.className = 'ui-button'; button.textContent = label; }
    compare.disabled = !result.proposal;
    compare.addEventListener('click', async () => {
      review.remove();
      await renderProposalReview(container, result.proposal, editorContext);
      setAiRequestState('proposed', t('ai.state_proposed') || 'Proposal ready for review.');
    });
    regenerate.addEventListener('click', async () => {
      if (result.proposal) await reject(result.proposal.id, { restoreEditor: false });
      updateProposalHistory(proposal.id, 'rejected');
      const input = document.getElementById('ai-chat-input');
      if (input) { input.value = lastAiPrompt; input.focus(); }
      review.remove();
    });
    discard.addEventListener('click', async () => {
      if (result.proposal) await reject(result.proposal.id);
      updateProposalHistory(proposal.id, 'rejected');
      review.remove();
      setAiRequestState('rejected', t('ai.proposal_rejected') || 'Proposal rejected. No files were changed.');
      restoreProposalEditorContext(editorContext);
    });
    actions.append(compare, regenerate, discard);
  };

  const apply = async (selectedOnly, retryPaths = null) => {
    const paths = retryPaths
      ? [...retryPaths]
      : selectedOnly ? [...selectedPaths] : proposal.edits.map(edit => edit.path);
    if (hasUnsavedProposalTargets(proposal, paths)) {
      status.textContent = t('ai.proposal_unsaved') || 'Save or discard open changes before applying this proposal.';
      return;
    }
    const immutablePaths = [...paths];
    const operation = startAiOperation({
      label: t('ai_ops.apply_label'),
      icon: 'published_with_changes',
      message: tp('ai_ops.applying_files', immutablePaths.length),
      scope: t('ai_ops.proposal_scope'),
      target: compactPathTarget(immutablePaths),
      retry: () => apply(selectedOnly, immutablePaths),
    });
    setBusy(true);
    try {
      const body = { action: 'ai_apply_proposal', proposal_id: proposal.id };
      if (selectedOnly) body.selected_paths = immutablePaths;
      const result = await fetchWithAuth(API_BASE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (result.status === 409) {
        const message = resultFailure(result, t('ai_ops.conflict_fallback'));
        operation.fail(t('ai_ops.conflict_title'), message, {
          detail: t('ai_ops.conflict_detail'),
          actions: [{ label: t('ai_ops.ai_studio'), icon: 'smart_toy', callback: revealAiStudio }],
        });
        setBusy(false);
        showConflict(result);
        return false;
      }
      if (!result.success) throw new Error(result.message || t('ai_ops.apply_rejected'));
      status.textContent = t('ai.proposal_applied') || 'Proposal applied.';
      const appliedPaths = result.applied_paths || immutablePaths;
      operation.finish(tp('ai_ops.applied_files', appliedPaths.length), {
        detail: compactPathTarget(appliedPaths),
      });
      updateProposalHistory(proposal.id, 'applied', {
        files: appliedPaths,
        undoId: result.undo_id,
        undoExpiresAt: result.undo_expires_at,
      });
      setAiRequestState('applied', status.textContent);
      actions.remove();
      await reloadProposalPaths(appliedPaths);
      restoreProposalEditorContext(editorContext);
      return true;
    } catch (error) {
      operation.fail(t('ai_ops.apply_failed'), error.message);
      updateProposalHistory(proposal.id, 'failed');
      status.textContent = error.message;
      setAiRequestState('failed', error.message, { canRetry: true });
      setBusy(false);
      updateApplySelected();
      return false;
    }
  };
  applySelectedButton.addEventListener('click', () => apply(true));
  applyAllButton.addEventListener('click', () => apply(false));
}

/**
 * Copies text to clipboard
 */
export async function copyCode(text) {
  const success = await copyToClipboard(text);
  if (success) {
      eventBus.emit('ui:show-toast', { message: t("toast.code_copied_to_clipboard"), type: "success" });
  } else {
      eventBus.emit('ui:show-toast', { message: t("toast.failed_to_copy_code"), type: "error" });
  }
}

/**
 * Sends a chat message to the AI provider and displays the response
 */
export async function sendAIChatMessage(requestOverride = null) {
  const input = document.getElementById("ai-chat-input");
  const messagesContainer = document.getElementById("ai-chat-messages");
  const query = String(requestOverride?.query ?? input?.value ?? '').trim();

  if (!query || !messagesContainer || activeAiRequest) return;
  lastAiPrompt = query;
  const context = requestOverride || currentAiContextPayload(query);
  const requestPayload = {
    query,
    current_file: context.current_file || null,
    file_content: context.file_content || null,
    selected_excerpt: context.selected_excerpt || null,
    task_mode: AI_TASK_MODES.has(context.task_mode) ? context.task_mode : 'ask',
    include_file_context: context.include_file_context !== false,
    include_metadata: context.include_metadata !== false,
    ai_type: context.ai_type || state.aiType,
    cloud_provider: context.cloud_provider || state.cloudProvider,
    ai_model: context.ai_model || state.aiModel,
    providerLabel: context.providerLabel || currentProviderLabel(),
    history: Array.isArray(context.history)
      ? context.history.map(item => ({ role: item.role, text: item.text }))
      : (state.aiChatHistory || []).map(item => ({ role: item.role, text: item.text })),
  };
  const controller = new AbortController();
  const requestId = newRequestId();
  const editorContext = captureProposalEditorContext();
  const request = { controller, editorContext, requestId, requestPayload };
  request.operation = startAiOperation({
    label: t('ai_ops.generate_label'),
    icon: 'auto_awesome',
    message: t('ai_ops.waiting_provider'),
    scope: t('ai_ops.generation_scope'),
    target: aiRequestTarget(requestPayload),
    retry: () => sendAIChatMessage(requestPayload),
    runningActions: [{ label: t('modal.cancel'), icon: 'stop_circle', callback: () => cancelAiRequest(request) }],
  });
  activeAiRequest = request;
  updateAIProcessingBoundary();
  setAiRequestState('running', t('ai.state_running') || 'Request running...', { canCancel: true });

  // Add user message to history
  state.aiChatHistory = appendBoundedHistory(
    state.aiChatHistory,
    { role: 'user', text: query },
    MAX_AI_CHAT_HISTORY,
  );
  saveSettings();

  // Add user message to UI
  const userMsg = document.createElement("div");
  userMsg.className = "ai-message ai-message-user";
  userMsg.textContent = query;
  messagesContainer.appendChild(userMsg);

  input.value = "";
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Add assistant loading message
  const loadingMsg = document.createElement("div");
  loadingMsg.className = "ai-message ai-message-assistant";
  loadingMsg.innerHTML = '<span class="ai-loading">Thinking...</span>';
  messagesContainer.appendChild(loadingMsg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  try {
    const result = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        action: "ai_query",
        request_id: requestId,
        query: requestPayload.query,
        current_file: requestPayload.current_file,
        file_content: requestPayload.file_content,
        selected_excerpt: requestPayload.selected_excerpt,
        task_mode: requestPayload.task_mode,
        include_file_context: requestPayload.include_file_context,
        include_metadata: requestPayload.include_metadata,
        ai_type: requestPayload.ai_type,
        cloud_provider: requestPayload.cloud_provider,
        ai_model: requestPayload.ai_model,
        history: requestPayload.history,
      })
    });

    if (result.success) {
      await ensureMarkdownDependencies();
      request.operation.update({ message: t('ai_ops.response_validating'), percent: 80 });
      setAiRequestState('validating', t('ai.state_validating') || 'Validating response...');
      // Save response to history
      appendBoundedHistory(state.aiChatHistory, { role: 'assistant', text: result.response }, MAX_AI_CHAT_HISTORY);
      saveSettings();

      // Parse markdown code blocks and format them
      const formattedResponse = formatAiResponse(result.response);
      loadingMsg.innerHTML = formattedResponse;

      renderGenerationValidation(loadingMsg, result);
      if (result.proposal) await renderProposalReview(loadingMsg, result.proposal, editorContext);
      if (result.proposal_error) {
        const warning = document.createElement('div');
        warning.className = 'ai-proposal-error';
        warning.setAttribute('role', 'alert');
        warning.textContent = result.proposal_error;
        loadingMsg.appendChild(warning);
      }

      // Add copy buttons to code blocks
      addCodeCopyButtons(loadingMsg);
      setAiRequestState(
        result.proposal ? 'proposed' : 'completed',
        result.proposal ? (t('ai.state_proposed') || 'Proposal ready for review.') : (t('ai.state_completed') || 'Response complete.'),
      );
      request.operation.finish(result.proposal ? t('ai_ops.proposal_ready') : t('ai_ops.response_complete'), {
        detail: result.proposal_error || (result.proposal
          ? compactPathTarget(result.proposal.edits?.map(edit => edit.path))
          : t('ai_ops.provider_response', { provider: requestProviderLabel(requestPayload) })),
      });
    } else {
      const errorMsg = "Error: " + (result.message || "Failed to get response from AI");
      request.operation.fail(t('ai_ops.generation_failed'), resultFailure(result, errorMsg));
      loadingMsg.textContent = errorMsg;
      loadingMsg.classList.add("ai-message-error");
      appendBoundedHistory(state.aiChatHistory, { role: 'assistant', text: errorMsg }, MAX_AI_CHAT_HISTORY);
      saveSettings();
      input.value = query;
      setAiRequestState('failed', errorMsg, { canRetry: true });
    }
  } catch (e) {
    if (e.name === 'AbortError' || request.cancelRequested) {
      loadingMsg.textContent = t('ai.state_cancelled') || 'Request cancelled. Your prompt is ready to edit or retry.';
      input.value = query;
      setAiRequestState('cancelled', loadingMsg.textContent, { canRetry: true });
      request.operation.cancel(t('ai_ops.generation_cancelled'), {
        failureDetail: request.cancelDetail || t('ai_ops.browser_stopped_waiting'),
      });
      input.focus();
      return;
    }
    console.error("AI Copilot Error:", e);
    const errorMsg = "Error connecting to AI service: " + e.message;
    request.operation.fail(t('ai_ops.generation_failed'), e.message);
    loadingMsg.textContent = errorMsg;
    loadingMsg.classList.add("ai-message-error");
    appendBoundedHistory(state.aiChatHistory, { role: 'assistant', text: errorMsg }, MAX_AI_CHAT_HISTORY);
    saveSettings();
    input.value = query;
    setAiRequestState('failed', errorMsg, { canRetry: true });
  } finally {
    if (activeAiRequest === request) activeAiRequest = null;
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
