import { renderMarkdown, addCodeCopyButtons } from './asset-preview.js';
/** AI-UI.JS | Purpose: * Handles AI sidebar, chat interface, code formatting, and AI provider */
import { state } from './state.js';
import { copyToClipboard } from './utils.js';
import { eventBus } from './event-bus.js';
import { fetchWithAuth } from './api.js';
import { API_BASE } from './constants.js';
import { t } from './translations.js';
import { saveSettings } from './settings.js?v=2.5.75';
import {
  AI_SIDEBAR_MIN_WIDTH,
  constrainAiSidebarWidth,
  getAiSidebarMaxWidth,
} from './workspace-layout.js';

const AI_SIDEBAR_DESKTOP_QUERY = '(min-width: 769px)';
let aiSidebarInitialized = false;

function applyAiSidebarWidth(width = state.aiSidebarWidth) {
  const sidebar = document.getElementById('ai-sidebar');
  const handle = document.getElementById('ai-sidebar-resize-handle');
  if (!sidebar || !handle) return;

  if (!window.matchMedia(AI_SIDEBAR_DESKTOP_QUERY).matches) {
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
    if (!window.matchMedia(AI_SIDEBAR_DESKTOP_QUERY).matches) return;
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

  window.addEventListener('resize', () => applyAiSidebarWidth());
  applyAiSidebarWidth();
}

function setAiSidebarVisibility(visible, { restoreFocus = false } = {}) {
  const sidebar = document.getElementById('ai-sidebar');
  const button = document.getElementById('btn-ai-studio');
  if (!sidebar) return;

  const show = Boolean(visible && state.aiIntegrationEnabled);
  sidebar.classList.toggle('hidden', !show);
  sidebar.classList.toggle('visible', show);
  sidebar.setAttribute('aria-hidden', String(!show));
  button?.setAttribute('aria-expanded', String(show));
  state.aiSidebarVisible = show;

  if (show) {
    applyAiSidebarWidth();
    renderAiChatHistory();
    document.getElementById('ai-chat-input')?.focus();
  } else if (restoreFocus && button && !button.classList.contains('hidden')) {
    button.focus();
  }
}

/**
 * Updates visibility of AI integration button based on settings
 */
export function updateAIVisibility() {
  initAiSidebar();
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
export async function sendAIChatMessage() {
  const input = document.getElementById("ai-chat-input");
  const messagesContainer = document.getElementById("ai-chat-messages");
  const query = input.value.trim();

  if (!query) return;

  // Add user message to history
  if (!state.aiChatHistory) state.aiChatHistory = [];
  state.aiChatHistory.push({ role: 'user', text: query });
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
      body: JSON.stringify({
        action: "ai_query",
        query: query,
        current_file: state.activeTab ? state.activeTab.path : null,
        file_content: (state.activeTab && state.editor) ? state.editor.getValue() : null,
        ai_type: state.aiType,
        cloud_provider: state.cloudProvider,
        ai_model: state.aiModel,
        history: state.aiChatHistory.slice(0, -1) // Send previous history
      })
    });

    if (result.success) {
      // Save response to history
      state.aiChatHistory.push({ role: 'assistant', text: result.response });
      saveSettings();

      // Parse markdown code blocks and format them
      const formattedResponse = formatAiResponse(result.response);
      loadingMsg.innerHTML = formattedResponse;

      // Add copy buttons to code blocks
      addCodeCopyButtons(loadingMsg);
    } else {
      const errorMsg = "Error: " + (result.message || "Failed to get response from AI");
      loadingMsg.textContent = errorMsg;
      loadingMsg.classList.add("ai-message-error");
      state.aiChatHistory.push({ role: 'assistant', text: errorMsg });
      saveSettings();
    }
  } catch (e) {
    console.error("AI Copilot Error:", e);
    const errorMsg = "Error connecting to AI service: " + e.message;
    loadingMsg.textContent = errorMsg;
    loadingMsg.classList.add("ai-message-error");
    state.aiChatHistory.push({ role: 'assistant', text: errorMsg });
    saveSettings();
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
