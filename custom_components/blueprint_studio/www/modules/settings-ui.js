/** SETTINGS-UI.JS | Purpose: * Provides the settings panel UI for configuring all Blueprint Studio options. */
import { state, elements } from './state.js';
import { saveSettings } from './settings.js?v=2.5.270';
import { fetchWithAuth } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE, THEME_PRESETS, ACCENT_COLORS, SYNTAX_THEMES } from './constants.js?v=2.5.270';
import {
  activateSharedModal,
  deactivateSharedModal,
  showToast,
  showConfirmDialog,
  setButtonLoading
} from './ui.js';
import { updateStatusBar } from './status-bar.js';
import { t, tp, initTranslations } from './translations.js?v=2.5.270';
import { showAddConnectionDialog, showEditConnectionDialog, deleteConnection } from './sftp.js?v=2.5.270';
import { startOperationFeedback, syncOperationCenterVisibility } from './feedback-service.js?v=2.5.270';

const CUSTOM_MODEL_OPTION_VALUE = "__custom__";

const SETTINGS_SECTIONS = Object.freeze([
  { id: 'workspace', labelKey: 'settings.sections.workspace', icon: 'workspaces', panel: 'general', target: '#language-select', keywords: 'files folders recent hidden language notifications pwa' },
  { id: 'editor', labelKey: 'settings.sections.editor', icon: 'edit_note', panel: 'editor', target: '#font-size-slider', keywords: 'font indentation tabs wrap line numbers whitespace minimap autocomplete syntax' },
  { id: 'appearance', labelKey: 'settings.sections.appearance', icon: 'palette', panel: 'appearance', target: '#theme-preset-select', keywords: 'theme color accent file tree icons compact' },
  { id: 'features', labelKey: 'settings.sections.features', icon: 'tune', panel: 'editor', target: '#split-view-toggle', keywords: 'split view autosave one tab experimental workflow' },
  { id: 'connections', labelKey: 'settings.sections.connections', icon: 'lan', panel: 'integrations', target: '#sftp-integration-toggle', keywords: 'sftp ssh terminal hosts remote server connection' },
  { id: 'source-control', labelKey: 'settings.sections.source_control', icon: 'account_tree', panel: 'integrations', target: '#git-integration-toggle', keywords: 'git github gitea repository version control exclusions ignore' },
  { id: 'ai-privacy', labelKey: 'settings.sections.ai_privacy', icon: 'psychology', panel: 'integrations', target: '#ai-integration-toggle', keywords: 'ai privacy model provider api key gemini openai claude ollama agent credentials' },
  { id: 'advanced', labelKey: 'settings.sections.advanced', icon: 'settings_suggest', panel: 'advanced', target: '#advanced-git-polling-section', keywords: 'performance polling cache reset pwa experimental reload' },
]);

const SETTINGS_CONTROL_METADATA = Object.freeze({
  'language-select': { defaultValue: 'en' },
  'remember-workspace-toggle': { defaultValue: true, apply: 'reload' },
  'auto-hide-sidebar-toggle': { defaultValue: true, apply: 'reload' },
  'recent-files-toggle': { defaultValue: true },
  'recent-files-limit': { defaultValue: '10' },
  'show-hidden-toggle': { defaultValue: false },
  'show-toasts-toggle': { defaultValue: true },
  'show-operation-center-toggle': { defaultValue: true },
  'theme-preset-select': { defaultValue: 'native' },
  'file-tree-compact-toggle': { defaultValue: false },
  'file-tree-icons-toggle': { defaultValue: true },
  'tree-collapsable-mode-toggle': { defaultValue: false },
  'font-size-slider': { defaultValue: '13', suffix: 'px' },
  'font-family-select': { defaultValue: "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace" },
  'tab-size-select': { defaultValue: '2' },
  'indent-with-tabs-toggle': { defaultValue: false },
  'word-wrap-toggle': { defaultValue: true },
  'line-numbers-toggle': { defaultValue: true },
  'whitespace-toggle': { defaultValue: false },
  'minimap-toggle': { defaultValue: false },
  'autocomplete-toggle': { defaultValue: true },
  'split-view-toggle': { defaultValue: false },
  'auto-save-toggle': { defaultValue: false },
  'auto-save-delay-input': { defaultValue: '1000', suffix: ' ms', dependsOn: ['auto-save-toggle'], reasonKey: 'settings.dependencies.autosave' },
  'one-tab-mode-toggle': { defaultValue: false },
  'git-integration-toggle': { defaultValue: true },
  'gitea-integration-toggle': { defaultValue: false },
  'sftp-integration-toggle': { defaultValue: true },
  'terminal-integration-toggle': { defaultValue: true },
  'default-ssh-host-select': { defaultValue: 'local', dependsOn: ['terminal-integration-toggle'], reasonKey: 'settings.dependencies.terminal' },
  'ai-integration-toggle': { defaultValue: false },
  'polling-interval-slider': { defaultValue: '10000', suffix: ' ms', dependsOn: ['git-integration-toggle', 'gitea-integration-toggle'], dependencyMode: 'any', reasonKey: 'settings.dependencies.source_control' },
  'remote-fetch-interval-slider': { defaultValue: '30000', suffix: ' ms', dependsOn: ['git-integration-toggle', 'gitea-integration-toggle'], dependencyMode: 'any', reasonKey: 'settings.dependencies.source_control' },
  'file-cache-size-slider': { defaultValue: '10' },
  'virtual-scroll-toggle': { defaultValue: false },
});

const SETTINGS_DEPENDENCY_GROUPS = Object.freeze([
  { selector: '#terminal-config-section', dependsOn: ['terminal-integration-toggle'], reasonKey: 'settings.dependencies.terminal' },
  { selector: '#ai-config-section', dependsOn: ['ai-integration-toggle'], reasonKey: 'settings.dependencies.ai' },
]);

function normalizeSettingsSection(section = 'workspace') {
  const aliases = { general: 'workspace', integrations: 'connections' };
  const normalized = aliases[section] || section;
  return SETTINGS_SECTIONS.some((item) => item.id === normalized) ? normalized : 'workspace';
}

export async function resetApplicationData(options = {}, startStep = 0, skipConfirm = false) {
  const request = Object.freeze({
    clearCredentials: Boolean(options.clearCredentials),
    deleteRepository: Boolean(options.deleteRepository),
  });
  const selected = [
    t('settings_ops.browser_preferences'),
    request.clearCredentials ? t('settings_ops.provider_credentials') : '',
    request.deleteRepository ? t('settings_ops.local_git_metadata') : '',
  ].filter(Boolean);

  if (!skipConfirm) {
    const confirmed = await showConfirmDialog({
      title: t(startStep > 0 ? 'settings_ops.reset_resume_title' : 'settings_ops.reset_title'),
      message: `<p>${t('settings_ops.reset_selection', { selection: selected.join(', ') })}</p><p>${t('settings_ops.reset_consequence')}</p>`,
      confirmText: t(startStep > 0 ? 'settings_ops.reset_resume' : 'settings_ops.reset_confirm'),
      cancelText: t('common.cancel'),
      isDanger: true,
    });
    if (!confirmed) return false;
  }

  const steps = [
    ...(request.clearCredentials ? [
      { action: 'git_clear_credentials', running: t('settings_ops.github_credentials_removing'), complete: t('settings_ops.github_credentials_removed') },
      { action: 'gitea_clear_credentials', running: t('settings_ops.gitea_credentials_removing'), complete: t('settings_ops.gitea_credentials_removed') },
    ] : []),
    ...(request.deleteRepository ? [
      { action: 'git_delete_repo', running: t('settings_ops.git_metadata_deleting'), complete: t('settings_ops.git_metadata_deleted') },
    ] : []),
    {
      action: 'save_settings',
      request: { settings: { onboardingCompleted: false } },
      running: t('settings_ops.server_settings_resetting'),
      complete: t('settings_ops.server_settings_reset'),
    },
  ];
  let resumeStep = Math.min(Math.max(0, startStep), steps.length - 1);
  const completedSteps = [];
  const operation = startOperationFeedback({
    label: t('settings_ops.reset_label'),
    icon: 'restart_alt',
    message: steps[resumeStep]?.running || t('settings_ops.reset_preparing'),
    scope: t('settings_ops.application_data'),
    target: selected.join('; '),
    retry: () => resetApplicationData(request, resumeStep),
    openLabel: t('settings_ops.application_settings'),
    openIcon: 'settings',
    open: () => eventBus.emit('ui:show-settings', { tab: 'general' }),
  });

  try {
    for (let index = resumeStep; index < steps.length; index += 1) {
      const step = steps[index];
      resumeStep = index;
      operation.update({
        message: step.running,
        detail: t('settings_ops.step_progress', { current: index + 1, count: steps.length }),
        percent: Math.round((index / steps.length) * 100),
      });
      const data = await fetchWithAuth(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: step.action, ...(step.request || {}) }),
      });
      if (!data.success) throw new Error(data.message || data.error || t('settings_ops.step_rejected', { step: step.complete }));
      completedSteps.push(step.complete);
      resumeStep = index + 1;
    }

    operation.finish(t('settings_ops.reset_complete'), {
      detail: t('settings_ops.configuration_unchanged'),
      percent: 100,
    });
    localStorage.clear();
    setTimeout(() => window.location.reload(), 800);
    return true;
  } catch (error) {
    const failedStep = steps[resumeStep];
    const completed = completedSteps.length
      ? `${t('settings_ops.completed_this_attempt')}\n- ${completedSteps.join('\n- ')}\n\n${t('settings_ops.completed_remain_applied')}`
      : startStep > 0
        ? t('settings_ops.previous_steps_remain_applied')
        : t('settings_ops.no_steps_completed');
    operation.fail(
      failedStep ? t('settings_ops.reset_stopped', { current: resumeStep + 1, count: steps.length }) : t('settings_ops.reset_incomplete'),
      `${error.message}\n\n${completed}`,
      { detail: t('settings_ops.browser_not_cleared') },
    );
    showToast(t('toast.application_reset_failed', { error: error.message }), 'error');
    return false;
  }
}

const AI_MODEL_PRESETS = {
  "cloud:gemini": [],
  "cloud:openai": [],
  "cloud:claude": [],
  "local:ollama": [],
  "local:lm-studio": [],
  "local:custom": [],
};

const AI_MODEL_PICKERS = {
  "cloud:gemini": {
    sourceKey: "cloud:gemini",
    stateKey: "aiModel",
    selectId: "gemini-model-select",
    inputId: "gemini-model-custom",
    buttonId: "btn-fetch-gemini-models",
    statusId: "gemini-model-fetch-status",
    fetchSupported: true,
    inputLabelKey: 'settings.ai.custom_model_name',
    inputPlaceholder: "gemini-2.5-pro",
    helpTextKey: 'settings.ai.gemini_model_hint',
  },
  "cloud:openai": {
    sourceKey: "cloud:openai",
    stateKey: "aiModel",
    selectId: "openai-model-select",
    inputId: "openai-model-custom",
    buttonId: "btn-fetch-openai-models",
    statusId: "openai-model-fetch-status",
    fetchSupported: true,
    inputLabelKey: 'settings.ai.custom_model_name',
    inputPlaceholder: "gpt-4.1 or deepseek-chat",
    helpTextKey: 'settings.ai.openai_model_hint',
  },
  "cloud:claude": {
    sourceKey: "cloud:claude",
    stateKey: "aiModel",
    selectId: "claude-model-select",
    inputId: "claude-model-custom",
    buttonId: "btn-fetch-claude-models",
    statusId: "claude-model-fetch-status",
    fetchSupported: true,
    inputLabelKey: 'settings.ai.custom_model_name',
    inputPlaceholder: "claude-sonnet-4-5-20250929",
    helpTextKey: 'settings.ai.claude_model_hint',
  },
  "local:ollama": {
    sourceKey: "local:ollama",
    stateKey: "ollamaModel",
    selectId: "ollama-model-select",
    inputId: "ollama-model",
    buttonId: "btn-fetch-ollama-models",
    statusId: "ollama-model-fetch-status",
    fetchSupported: true,
    inputLabelKey: 'settings.ai.model_name',
    inputPlaceholder: "Choose an installed model",
    helpTextKey: 'settings.ai.ollama_model_hint',
  },
  "local:lm-studio": {
    sourceKey: "local:lm-studio",
    stateKey: "lmStudioModel",
    selectId: "lm-studio-model-select",
    inputId: "lm-studio-model",
    buttonId: "btn-fetch-lm-studio-models",
    statusId: "lm-studio-model-fetch-status",
    fetchSupported: true,
    inputLabelKey: 'settings.ai.model_name_optional',
    inputPlaceholder: "Leave blank to use loaded model",
    helpTextKey: 'settings.ai.lm_studio_model_hint',
  },
  "local:custom": {
    sourceKey: "local:custom",
    stateKey: "customAiModel",
    selectId: "custom-ai-model-select",
    inputId: "custom-ai-model",
    buttonId: "btn-fetch-custom-models",
    statusId: "custom-ai-model-fetch-status",
    fetchSupported: true,
    inputLabelKey: 'settings.ai.model_name',
    inputPlaceholder: "model-name",
    helpTextKey: 'settings.ai.custom_model_hint',
  },
};

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCredentialField({ id, stateKey, label, keyUrl }) {
  const saved = Boolean(state[stateKey]);
  return `
    <div class="settings-credential-field" data-credential-field="${stateKey}">
      <div class="settings-credential-header">
        <label for="${id}">${label}</label>
        <a href="${keyUrl}" target="_blank" rel="noopener noreferrer">
          ${t('settings.credentials.get_key')} <span class="ui-icon material-icons settings-external-link-icon" aria-hidden="true">open_in_new</span>
        </a>
      </div>
      <div class="settings-credential-input-row">
        <input type="password" id="${id}" class="git-settings-input" value="" autocomplete="new-password" data-secret-key="${stateKey}" placeholder="${t(saved ? 'settings.credentials.replace_placeholder' : 'settings.credentials.enter_placeholder')}">
        <button type="button" class="ui-button ui-icon-button settings-credential-clear" data-clear-secret="${stateKey}" title="${t('settings.credentials.clear')}" aria-label="${t('settings.credentials.clear')}" ${saved ? '' : 'disabled'}>
          <span class="ui-icon material-icons" aria-hidden="true">delete</span>
        </button>
      </div>
      <div class="settings-credential-status ${saved ? 'is-saved' : ''}" data-secret-status="${stateKey}">
        <span class="ui-icon material-icons" aria-hidden="true">${saved ? 'lock' : 'lock_open'}</span>
        <span>${t(saved ? 'settings.credentials.saved_hidden' : 'settings.credentials.not_saved')}</span>
      </div>
    </div>
  `;
}

function uniqueModels(values = []) {
  const toModelName = (value) => {
    if (value && typeof value === "object") {
      return String(value.id || value.label || value.name || value.model || "").trim();
    }
    return String(value || "").trim();
  };

  return [...new Set(
    values
      .map((value) => toModelName(value))
      .filter(Boolean)
  )];
}

function ensureAiModelFetchState() {
  if (!state.aiDiscoveredModels) {
    state.aiDiscoveredModels = {};
  }
  if (!state.aiModelFetchMeta) {
    state.aiModelFetchMeta = {};
  }

  Object.keys(AI_MODEL_PRESETS).forEach((sourceKey) => {
    if (!Array.isArray(state.aiDiscoveredModels[sourceKey])) {
      state.aiDiscoveredModels[sourceKey] = [];
    }
    if (!state.aiModelFetchMeta[sourceKey]) {
      state.aiModelFetchMeta[sourceKey] = {
        loading: false,
        error: "",
        fetchedAt: null,
        count: 0,
      };
    }
  });
}

function getModelPickerConfig(sourceKey) {
  ensureAiModelFetchState();
  return AI_MODEL_PICKERS[sourceKey];
}

function getModelValue(sourceKey) {
  const config = getModelPickerConfig(sourceKey);
  return String(state[config.stateKey] || "").trim();
}

function setModelValue(sourceKey, value) {
  const config = getModelPickerConfig(sourceKey);
  state[config.stateKey] = String(value || "").trim();
}

function getCombinedModelOptions(sourceKey, currentValue = "") {
  ensureAiModelFetchState();
  return uniqueModels([
    ...(AI_MODEL_PRESETS[sourceKey] || []),
    ...(state.aiDiscoveredModels[sourceKey] || []),
    currentValue,
  ]);
}

function getModelSelectMarkup(sourceKey, currentValue = "") {
  const options = getCombinedModelOptions(sourceKey, currentValue);
  const hasMatchingOption = currentValue && options.includes(currentValue);
  const customSelected = !hasMatchingOption;

  return [
    `<option value="${CUSTOM_MODEL_OPTION_VALUE}" ${customSelected ? 'selected' : ''}>Custom model (type below)</option>`,
    ...options.map((modelName) => `<option value="${escapeHtml(modelName)}" ${currentValue === modelName ? 'selected' : ''}>${escapeHtml(modelName)}</option>`),
  ].join('');
}

function getFetchStatusText(sourceKey) {
  ensureAiModelFetchState();
  const meta = state.aiModelFetchMeta[sourceKey] || {};
  if (meta.loading) {
    return "Fetching model list...";
  }
  if (meta.error) {
    return meta.error;
  }
  if (meta.fetchedAt) {
    return `Fetched ${meta.count || 0} model${meta.count === 1 ? "" : "s"}.`;
  }
  return "Pick from the list or fetch models from the endpoint.";
}

function renderModelPicker(sourceKey, currentValue = "") {
  const config = getModelPickerConfig(sourceKey);

  return `
    <div style="display: flex; gap: 8px; align-items: flex-end; margin-bottom: 8px;">
      <div style="flex: 1;">
        <div style="font-size: 12px; margin-bottom: 4px;">Available Models</div>
        <select id="${config.selectId}" class="git-settings-input" style="width: 100%;">
          ${getModelSelectMarkup(sourceKey, currentValue)}
        </select>
      </div>
      <button
        id="${config.buttonId}"
        type="button"
        ${config.fetchSupported ? "" : "disabled"}
        style="height: 34px; padding: 0 12px; border-radius: 4px; border: 1px solid var(--border-color); background: ${config.fetchSupported ? 'var(--bg-secondary)' : 'var(--bg-tertiary)'}; color: ${config.fetchSupported ? 'var(--text-primary)' : 'var(--text-secondary)'}; cursor: ${config.fetchSupported ? 'pointer' : 'not-allowed'}; white-space: nowrap;"
      >
        Fetch Models
      </button>
    </div>
    <div id="${config.statusId}" style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">${escapeHtml(getFetchStatusText(sourceKey))}</div>
    <div style="font-size: 12px; margin-bottom: 4px;">${t(config.inputLabelKey)}</div>
    <input
      type="text"
      id="${config.inputId}"
      class="git-settings-input"
      style="width: 100%; margin-bottom: 8px;"
      value="${escapeHtml(currentValue)}"
      placeholder="${escapeHtml(config.inputPlaceholder)}"
    >
    <div style="font-size: 11px; color: var(--text-secondary); padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
      ${t(config.helpTextKey)}
    </div>
  `;
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl, fallbackUrl = "") {
  let normalized = String(baseUrl || fallbackUrl || "").trim();
  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/\/+$/g, "");
  normalized = normalized.replace(/\/chat\/completions$/i, "");
  normalized = normalized.replace(/\/responses$/i, "");
  normalized = normalized.replace(/\/models$/i, "");

  if (!/\/v1$/i.test(normalized)) {
    normalized = `${normalized}/v1`;
  }

  return normalized;
}

function buildOllamaTagsUrl(baseUrl) {
  let normalized = String(baseUrl || "http://localhost:11434").trim();
  normalized = normalized.replace(/\/+$/g, "");
  normalized = normalized.replace(/\/api\/tags$/i, "");
  normalized = normalized.replace(/\/api$/i, "");
  return `${normalized}/api/tags`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const errorJson = await response.json();
      message = errorJson.error?.message || errorJson.message || message;
    } catch (error) {
      try {
        const errorText = await response.text();
        if (errorText) {
          message = errorText;
        }
      } catch (_ignored) {}
    }
    throw new Error(message);
  }
  return response.json();
}

async function fetchModelsViaBackend(sourceKey, payload) {
  try {
    const result = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "ai_get_models",
        ...payload,
      }),
    });
    if (Array.isArray(result?.models)) {
      return uniqueModels(result.models);
    }
    if (result?.success === false) {
      throw new Error(result.message || result.error || 'Model discovery was rejected');
    }
    return null;
  } catch (error) {
    if (/unknown action/i.test(error.message || "")) {
      return null;
    }
    throw error;
  }
}

async function fetchModelsDirectly(sourceKey, payload) {
  if (sourceKey === "local:ollama") {
    const data = await fetchJson(buildOllamaTagsUrl(payload.baseUrl));
    return (data.models || []).map((model) => model.name).filter(Boolean);
  }

  if (sourceKey === "cloud:gemini") {
    if (!payload.apiKey) {
      throw new Error("Enter a Gemini API key first.");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(payload.apiKey)}`;
    const data = await fetchJson(url);
    return (data.models || [])
      .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
      .map((model) => String(model.name || "").replace(/^models\//, ""))
      .filter(Boolean);
  }

  if (sourceKey === "cloud:claude") {
    if (!payload.apiKey) {
      throw new Error("Enter a Claude API key first.");
    }
    const data = await fetchJson("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": payload.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    return (data?.models || data?.data || [])
      .map((m) => m.id || m.name)
      .filter(Boolean);
  }

  const baseUrl = normalizeOpenAiCompatibleBaseUrl(payload.baseUrl, payload.fallbackBaseUrl);
  if (!baseUrl) {
    throw new Error("Enter an endpoint URL first.");
  }

  const headers = {};
  if (payload.apiKey) {
    headers.Authorization = `Bearer ${payload.apiKey}`;
  }

  const data = await fetchJson(`${baseUrl}/models`, { headers });
  return (data.data || []).map((model) => model.id).filter(Boolean);
}

function getDirectFetchPayload(sourceKey) {
  const getInputValue = (id, fallback = "") => String(document.getElementById(id)?.value || fallback).trim();

  switch (sourceKey) {
    case "cloud:claude":
      return {
        apiKey: getInputValue("claude-api-key", state.claudeApiKey),
      };
    case "cloud:gemini":
      return {
        apiKey: getInputValue("gemini-api-key", state.geminiApiKey),
      };
    case "cloud:openai":
      return {
        baseUrl: getInputValue("openai-base-url", state.openaiBaseUrl),
        fallbackBaseUrl: "https://api.openai.com/v1",
        apiKey: getInputValue("openai-api-key", state.openaiApiKey),
      };
    case "local:ollama":
      return {
        baseUrl: getInputValue("ollama-url", state.ollamaUrl),
      };
    case "local:lm-studio":
      return {
        baseUrl: getInputValue("lm-studio-url", state.lmStudioUrl),
        fallbackBaseUrl: "http://localhost:1234/v1",
      };
    case "local:custom":
      return {
        baseUrl: getInputValue("custom-ai-url", state.customAiUrl),
        apiKey: getInputValue("openai-api-key", state.openaiApiKey),
      };
    default:
      return {};
  }
}

function getBackendFetchPayload(sourceKey) {
  const getInputValue = (id, fallback = "") => String(document.getElementById(id)?.value || fallback).trim();
  const aiType = sourceKey.startsWith("cloud:") ? "cloud" : "local-ai";
  const cloudProvider = sourceKey.startsWith("cloud:") ? sourceKey.split(":")[1] : undefined;
  const localAiProvider = sourceKey.startsWith("local:") ? sourceKey.split(":")[1] : getInputValue("local-ai-provider-select", state.localAiProvider);
  const cloudProviderValue = getInputValue("cloud-provider-select", state.cloudProvider);

  const cloudModelValue = (() => {
    if (cloudProviderValue === "gemini") return getInputValue("gemini-model-custom", state.aiModel);
    if (cloudProviderValue === "openai") return getInputValue("openai-model-custom", state.aiModel);
    if (cloudProviderValue === "claude") return getInputValue("claude-model-custom", state.aiModel);
    return state.aiModel;
  })();

  return {
    ai_type: aiType,
    cloud_provider: cloudProvider,
    ai_model: getModelValue(sourceKey),
    settings: {
      aiType,
      cloudProvider: cloudProviderValue,
      aiModel: cloudModelValue,
      localAiProvider,
      geminiApiKey: getInputValue("gemini-api-key", state.geminiApiKey),
      openaiApiKey: getInputValue("openai-api-key", state.openaiApiKey),
      openaiBaseUrl: getInputValue("openai-base-url", state.openaiBaseUrl),
      claudeApiKey: getInputValue("claude-api-key", state.claudeApiKey),
      ollamaUrl: getInputValue("ollama-url", state.ollamaUrl),
      ollamaModel: getInputValue("ollama-model", state.ollamaModel),
      lmStudioUrl: getInputValue("lm-studio-url", state.lmStudioUrl),
      lmStudioModel: getInputValue("lm-studio-model", state.lmStudioModel),
      customAiUrl: getInputValue("custom-ai-url", state.customAiUrl),
      customAiModel: getInputValue("custom-ai-model", state.customAiModel),
    },
  };
}

function updateModelPickerUi(sourceKey) {
  const config = getModelPickerConfig(sourceKey);
  const currentValue = getModelValue(sourceKey);
  const select = document.getElementById(config.selectId);
  const input = document.getElementById(config.inputId);
  const button = document.getElementById(config.buttonId);
  const status = document.getElementById(config.statusId);
  const meta = state.aiModelFetchMeta[sourceKey] || {};

  if (select) {
    select.innerHTML = getModelSelectMarkup(sourceKey, currentValue);
  }

  if (input && input.value !== currentValue) {
    input.value = currentValue;
  }

  if (button) {
    setButtonLoading(button, !!meta.loading);
    button.disabled = !config.fetchSupported || !!meta.loading;
    button.textContent = meta.loading ? t('settings.ai.fetching_models') : t('settings.ai.fetch_models');
    button.style.cursor = button.disabled ? "not-allowed" : "pointer";
    button.style.opacity = button.disabled ? "0.7" : "1";
  }

  if (status) {
    status.textContent = getFetchStatusText(sourceKey);
    status.style.color = meta.error ? "var(--error-color)" : "var(--text-secondary)";
  }
}

function syncAllModelPickers() {
  Object.keys(AI_MODEL_PICKERS).forEach((sourceKey) => updateModelPickerUi(sourceKey));
}

function aiDiscoveryTarget(sourceKey) {
  const labels = {
    'cloud:gemini': 'Gemini',
    'cloud:openai': 'OpenAI',
    'cloud:claude': 'Claude',
    'local:ollama': 'Ollama',
    'local:lm-studio': 'LM Studio',
    'local:custom': 'Custom AI',
  };
  const direct = getDirectFetchPayload(sourceKey);
  const rawUrl = direct.baseUrl || direct.fallbackBaseUrl || '';
  if (!rawUrl) return labels[sourceKey] || sourceKey;
  try {
    const parsed = new URL(rawUrl);
    const endpoint = `${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
    return `${labels[sourceKey] || sourceKey} -> ${endpoint}`;
  } catch (_error) {
    return labels[sourceKey] || sourceKey;
  }
}

export async function refreshModelList(sourceKey, { silent = false } = {}) {
  const config = getModelPickerConfig(sourceKey);
  if (!config.fetchSupported) {
    updateModelPickerUi(sourceKey);
    return;
  }

  ensureAiModelFetchState();
  state.aiModelFetchMeta[sourceKey] = {
    ...state.aiModelFetchMeta[sourceKey],
    loading: true,
    error: "",
  };
  updateModelPickerUi(sourceKey);
  const operation = silent ? null : startOperationFeedback({
    label: t('settings_ops.discover_models', { provider: aiDiscoveryTarget(sourceKey).split(' -> ')[0] }),
    icon: 'travel_explore',
    message: t('settings_ops.models_fetching'),
    scope: t('settings_ops.model_discovery'),
    target: aiDiscoveryTarget(sourceKey),
    retry: () => refreshModelList(sourceKey),
    openLabel: t('settings_ops.ai_settings'),
    openIcon: 'settings',
    open: () => eventBus.emit('ui:show-settings', { tab: 'ai-privacy' }),
  });

  try {
    const backendPayload = getBackendFetchPayload(sourceKey);
    let models = await fetchModelsViaBackend(sourceKey, backendPayload);
    if (!models) {
      models = await fetchModelsDirectly(sourceKey, getDirectFetchPayload(sourceKey));
    }

    const unique = uniqueModels(models);
    state.aiDiscoveredModels[sourceKey] = unique;
    state.aiModelFetchMeta[sourceKey] = {
      loading: false,
      error: "",
      fetchedAt: Date.now(),
      count: unique.length,
    };
    updateModelPickerUi(sourceKey);
    operation?.finish(tp('settings_ops.models_discovered', unique.length), {
      detail: unique.length ? unique.join('\n') : t('settings_ops.no_models'),
    });
    if (!silent) {
      showToast(t('toast.models_fetched', { count: unique.length }), "success");
    }
  } catch (error) {
    state.aiModelFetchMeta[sourceKey] = {
      ...state.aiModelFetchMeta[sourceKey],
      loading: false,
      error: error.message || t('settings_ops.models_fetch_failed_detail'),
    };
    updateModelPickerUi(sourceKey);
    operation?.fail(t('settings_ops.model_discovery_failed'), error.message || t('settings_ops.models_fetch_failed_detail'));
    if (!silent) {
      showToast(t('toast.models_fetch_failed', { error: error.message || t('common.unknown') }), "error");
    }
  }
}

export async function refreshHassAgents({ silent = false } = {}) {
  const operation = silent ? null : startOperationFeedback({
    label: t('settings_ops.discover_agents'),
    icon: 'forum',
    message: t('settings_ops.agents_loading'),
    scope: t('settings_ops.local_ha_instance'),
    target: t('settings_ops.conversation_agents'),
    retry: refreshHassAgents,
    openLabel: t('settings_ops.ai_settings'),
    openIcon: 'settings',
    open: () => eventBus.emit('ui:show-settings', { tab: 'ai-privacy' }),
  });
  try {
    const data = await fetchWithAuth(`${API_BASE}?action=list_hass_agents`);
    if (!Array.isArray(data?.agents)) {
      throw new Error(data?.message || data?.error || t('settings_ops.agent_discovery_rejected'));
    }
    state.hassAgents = data.agents;
    const select = document.getElementById('hass-agent-select');
    if (select) {
      select.innerHTML = `<option value="">${t('settings.ai.auto_detect')}</option>` + data.agents.map(agent =>
        `<option value="${escapeHtml(agent.id)}" ${state.hassAgentId === agent.id ? 'selected' : ''}>${escapeHtml(agent.name)} (${escapeHtml(agent.platform)})</option>`
      ).join('');
    }
    operation?.finish(tp('settings_ops.agents_discovered', data.agents.length));
    if (!silent) showToast(t('toast.agents_found', { count: data.agents.length }), 'success');
    return data.agents;
  } catch (error) {
    operation?.fail(t('settings_ops.agent_discovery_failed'), error.message);
    if (!silent) showToast(t('toast.agents_fetch_failed', { error: error.message }), 'error');
    return [];
  }
}

/**
 * Show the application settings modal
 */
export async function showAppSettings({ section = 'workspace', returnFocus = null } = {}) {
    const modalOverlay = document.getElementById("modal-overlay");
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modal-title");
    const modalBody = document.getElementById("modal-body");
    const modalFooter = document.querySelector(".modal-footer");

    if (!modalOverlay || !modal) {
        console.error("[SettingsUI] Modal elements not found:", { modalOverlay: !!modalOverlay, modal: !!modal });
        return;
    }

    // Get current setting from localStorage
    const gitEnabled = localStorage.getItem("gitIntegrationEnabled") !== "false"; // Default to true;
    const showRecentFiles = state.showRecentFiles;
    const customColors = state.customColors || {};

    modalTitle.textContent = t("settings.title");

    const renderColorInput = (label, key) => {
        const hasValue = customColors.hasOwnProperty(key);
        const colorValue = hasValue ? customColors[key] : '#000000';
        const disabled = !hasValue;

        return `
        <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center;">
                <input type="checkbox" class="syntax-color-toggle" data-key="${key}" ${hasValue ? 'checked' : ''} style="margin-right: 8px;">
                <span style="font-size: 12px; opacity: ${disabled ? '0.5' : '1'}; transition: opacity 0.2s;">${label}</span>
            </div>
            <input type="color" class="syntax-color-input" data-key="${key}" value="${colorValue}" ${disabled ? 'disabled' : ''} style="cursor: ${disabled ? 'default' : 'pointer'}; height: 24px; width: 40px; border: none; padding: 0; background: transparent; opacity: ${disabled ? '0.2' : '1'}; transition: opacity 0.2s;">
        </div>
    `;
    };

    // Generate theme preset options
    const themePresetOptions = Object.entries(THEME_PRESETS).map(([key, preset]) =>
      `<option value="${key}" ${state.themePreset === key ? 'selected' : ''}>${preset.name}</option>`
    ).join('');

    ensureAiModelFetchState();
    const ollamaModelPicker = renderModelPicker("local:ollama", state.ollamaModel || "");
    const lmStudioModelPicker = renderModelPicker("local:lm-studio", state.lmStudioModel || "");
    const customModelPicker = renderModelPicker("local:custom", state.customAiModel || "");
    const geminiModelPicker = renderModelPicker("cloud:gemini", state.cloudProvider === 'gemini' ? state.aiModel || "" : "");
    const openaiModelPicker = renderModelPicker("cloud:openai", state.cloudProvider === 'openai' ? state.aiModel || "" : "");
    const claudeModelPicker = renderModelPicker("cloud:claude", state.cloudProvider === 'claude' ? state.aiModel || "" : "");

    modalBody.innerHTML = `
      <div class="settings-workbench">
        <nav class="settings-tabs" aria-label="${t('settings.navigation_label')}">
          <div class="settings-nav-header">
            <strong>${t('settings.navigation_label')}</strong>
            <button id="settings-nav-search" type="button" class="ui-button ui-icon-button" aria-label="${t('settings.search_placeholder')}" title="${t('settings.search_placeholder')}">
              <span class="ui-icon material-icons" aria-hidden="true">search</span>
            </button>
          </div>
          ${SETTINGS_SECTIONS.map((item) => `
            <button class="settings-tab" type="button" data-section="${item.id}" data-tab="${item.panel}">
              <span class="ui-icon material-icons" aria-hidden="true">${item.icon}</span>
              <span>${t(item.labelKey)}</span>
              <span class="settings-tab-chevron ui-icon material-icons" aria-hidden="true">chevron_right</span>
            </button>
          `).join('')}
        </nav>
        <main class="settings-main">
          <div class="settings-drilldown-header">
            <button id="settings-drilldown-back" type="button" class="ui-button ui-button--ghost">
              <span class="ui-icon material-icons" aria-hidden="true">arrow_back</span>
              <span>${t('settings.navigation_back')}</span>
            </button>
            <strong id="settings-drilldown-title"></strong>
          </div>
          <label class="settings-search" for="settings-search-input">
            <span class="ui-icon material-icons" aria-hidden="true">search</span>
            <input id="settings-search-input" type="search" autocomplete="off" placeholder="${t('settings.search_placeholder')}" aria-label="${t('settings.search_placeholder')}">
            <button id="settings-search-clear" type="button" class="ui-button ui-icon-button" aria-label="${t('settings.search_clear')}" title="${t('settings.search_clear')}" hidden>
              <span class="ui-icon material-icons" aria-hidden="true">close</span>
            </button>
          </label>
          <div id="settings-search-results" class="settings-search-results" role="status" aria-live="polite" hidden></div>
          <div class="settings-content">
        <!-- General Tab -->
        <div id="settings-tab-general" class="settings-panel active">
          <div class="git-settings-section">
            <div class="git-settings-label">${t("settings.general.language")}</div>
            <div style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="font-weight: 500; margin-bottom: 8px;">${t("settings.general.ui_language")}</div>
              <select id="language-select" class="git-settings-input" style="width: 100%;">
                <option value="en" ${state.language === 'en' ? 'selected' : ''}>English</option>
                <option value="es" ${state.language === 'es' ? 'selected' : ''}>Español</option>
                <option value="fr" ${state.language === 'fr' ? 'selected' : ''}>Français</option>
                <option value="de" ${state.language === 'de' ? 'selected' : ''}>Deutsch</option>
                <option value="it" ${state.language === 'it' ? 'selected' : ''}>Italiano</option>
                <option value="pt" ${state.language === 'pt' ? 'selected' : ''}>Português</option>
                <option value="nl" ${state.language === 'nl' ? 'selected' : ''}>Nederlands</option>
                <option value="ru" ${state.language === 'ru' ? 'selected' : ''}>Русский</option>
                <option value="pl" ${state.language === 'pl' ? 'selected' : ''}>Polski</option>
                <option value="zh-Hans" ${state.language === 'zh-Hans' ? 'selected' : ''}>简体中文</option>
              </select>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${t("settings.general.ui_language_hint")}</div>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">${t("settings.general.workspace")}</div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.general.remember_workspace")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.general.remember_workspace_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="remember-workspace-toggle" ${state.rememberWorkspace !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.general.auto_hide_sidebar")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.general.auto_hide_sidebar_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="auto-hide-sidebar-toggle" ${state.autoHideSidebar !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.general.show_recent")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.general.show_recent_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="recent-files-toggle" ${showRecentFiles ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.general.recent_limit")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.general.recent_limit_hint")}</div>
              </div>
              <input type="number" id="recent-files-limit" value="${state.recentFilesLimit}" min="5" max="30" style="width: 60px; padding: 6px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); text-align: center;">
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.general.show_hidden")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.general.show_hidden_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="show-hidden-toggle" ${state.showHidden ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">${t("settings.general.feedback")}</div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.general.show_toasts")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.general.show_toasts_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="show-toasts-toggle" ${state.showToasts ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.general.show_operation_center")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.general.show_operation_center_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="show-operation-center-toggle" ${state.showOperationCenter !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">PWA</div>

            <div style="display: flex; align-items: center; padding: 12px 0;">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t('settings.pwa.install')}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t('settings.pwa.hint')}</div>
              </div>
              <button id="btn-pwa-install" style="padding: 8px 16px; background: var(--accent-color); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; margin-left: 16px; display: flex; align-items: center; gap: 6px;" title="${t('settings.pwa.open_window')}" aria-label="${t('settings.pwa.open_window')}">
                <span class="ui-icon material-icons settings-pwa-icon">open_in_new</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Appearance Tab -->
        <div id="settings-tab-appearance" class="settings-panel" style="display: none;">
          <div class="git-settings-section">
            <div class="git-settings-label">${t("settings.appearance.theme")}</div>

            <div style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="font-weight: 500; margin-bottom: 8px;">${t("settings.appearance.preset")}</div>
              <select id="theme-preset-select" class="git-settings-input" style="width: 100%;">
                ${themePresetOptions}
              </select>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${t("settings.appearance.preset_hint")}</div>
            </div>

            <div style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="font-weight: 500; margin-bottom: 8px;">${t("settings.appearance.accent")}</div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${ACCENT_COLORS.map(color => `
                  <button class="accent-color-btn" data-color="${color.value}" style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid ${state.accentColor === color.value ? 'var(--text-primary)' : 'transparent'}; background: ${color.value}; cursor: pointer;" title="${color.name}"></button>
                `).join('')}
                <button class="accent-color-btn" data-color="" style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid ${!state.accentColor ? 'var(--text-primary)' : 'transparent'}; background: var(--bg-tertiary); cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary);" title="${t('settings.appearance.theme_default')}" aria-label="${t('settings.appearance.theme_default')}">✕</button>
              </div>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">${t("settings.appearance.file_tree")}</div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.appearance.compact")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.appearance.compact_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="file-tree-compact-toggle" ${state.fileTreeCompact ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.appearance.icons")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.appearance.icons_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="file-tree-icons-toggle" ${state.fileTreeShowIcons ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.appearance.collapsable")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.appearance.collapsable_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="tree-collapsable-mode-toggle" ${state.treeCollapsableMode ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Editor Tab -->
        <div id="settings-tab-editor" class="settings-panel" style="display: none;">
          <div class="git-settings-section">
            <div class="git-settings-label">${t("settings.editor.font")}</div>

            <div style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="font-weight: 500; margin-bottom: 8px;">${t("settings.editor.font_size")}</div>
              <div style="display: flex; align-items: center; gap: 12px;">
                <input type="range" id="font-size-slider" min="10" max="24" value="${state.fontSize}" style="flex: 1;">
                <span id="font-size-value" style="min-width: 40px; text-align: center; font-family: monospace;">${state.fontSize}px</span>
              </div>
            </div>

            <div style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="font-weight: 500; margin-bottom: 8px;">${t("settings.editor.font_family")}</div>
              <select id="font-family-select" class="git-settings-input" style="width: 100%; margin-bottom: 8px;">
                  <option value="'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace" ${state.fontFamily === "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace" ? 'selected' : ''}>SF Mono (Default)</option>
                  <option value="'Fira Code', monospace" ${state.fontFamily === "'Fira Code', monospace" ? 'selected' : ''}>Fira Code</option>
                  <option value="'JetBrains Mono', monospace" ${state.fontFamily === "'JetBrains Mono', monospace" ? 'selected' : ''}>JetBrains Mono</option>
                  <option value="'Source Code Pro', monospace" ${state.fontFamily === "'Source Code Pro', monospace" ? 'selected' : ''}>Source Code Pro</option>
                  <option value="'Roboto Mono', monospace" ${state.fontFamily === "'Roboto Mono', monospace" ? 'selected' : ''}>Roboto Mono</option>
                  <option value="'Ubuntu Mono', monospace" ${state.fontFamily === "'Ubuntu Mono', monospace" ? 'selected' : ''}>Ubuntu Mono</option>
                  <option value="'Monaco', 'Courier New', monospace" ${state.fontFamily === "'Monaco', 'Courier New', monospace" ? 'selected' : ''}>Monaco</option>
                  <option value="'Consolas', monospace" ${state.fontFamily === "'Consolas', monospace" ? 'selected' : ''}>Consolas</option>
                  <option value="'DM Mono', monospace" ${state.fontFamily === "'DM Mono', monospace" ? 'selected' : ''}>DM Mono</option>
                  <option value="'Reddit Mono', monospace" ${state.fontFamily === "'Reddit Mono', monospace" ? 'selected' : ''}>Reddit Mono</option>
                  <option value="'Libertinus Mono', monospace" ${state.fontFamily === "'Libertinus Mono', monospace" ? 'selected' : ''}>Libertinus Mono</option>
                  <option value="'Azeret Mono', monospace" ${state.fontFamily === "'Azeret Mono', monospace" ? 'selected' : ''}>Azeret Mono</option>
                  <option value="monospace" ${state.fontFamily === "monospace" ? 'selected' : ''}>System Monospace</option>
                </select>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${t("settings.editor.font_family_hint")}</div>
            </div>

            <div style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="font-weight: 500; margin-bottom: 8px;">${t("settings.editor.tab_size")}</div>
              <select id="tab-size-select" class="git-settings-input" style="width: 100%; margin-bottom: 8px;">
                <option value="2" ${state.tabSize === 2 ? 'selected' : ''}>2 spaces (Home Assistant Standard)</option>
                <option value="4" ${state.tabSize === 4 ? 'selected' : ''}>4 spaces</option>
                <option value="8" ${state.tabSize === 8 ? 'selected' : ''}>8 spaces</option>
              </select>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${t("settings.editor.tab_size_hint")}</div>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">Indent with Tabs</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Use tab characters instead of spaces for indentation</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="indent-with-tabs-toggle" ${state.indentWithTabs ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">${t("settings.editor.behavior")}</div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.editor.wrap")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.editor.wrap_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="word-wrap-toggle" ${state.wordWrap ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.editor.numbers")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.editor.numbers_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="line-numbers-toggle" ${state.showLineNumbers ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.editor.whitespace")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.editor.whitespace_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="whitespace-toggle" ${state.showWhitespace ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">Minimap</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Show a scaled-down overview of the file on the right side of the editor</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="minimap-toggle" ${state.showMinimap ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">Autocomplete</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Show YAML suggestions as you type</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="autocomplete-toggle" ${state.autocompleteEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.advanced.split_view")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.advanced.split_view_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="split-view-toggle" ${state.enableSplitView ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">${t("settings.editor.autosave")}</div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.editor.autosave_enable")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.editor.autosave_enable_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="auto-save-toggle" ${state.autoSave ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div id="auto-save-delay-container" style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.editor.autosave_delay")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.editor.autosave_delay_hint")}</div>
              </div>
              <input type="number" id="auto-save-delay-input" value="${state.autoSaveDelay}" min="500" max="10000" step="100" style="width: 80px; padding: 6px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); text-align: center;">
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.editor.one_tab")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.editor.one_tab_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="one-tab-mode-toggle" ${state.onTabMode ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">${t("settings.editor.syntax")}</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">${t("settings.editor.syntax_hint")}</div>

            <!-- Pre-defined Syntax Themes -->
            <div style="margin-bottom: 16px;">
              <div style="font-weight: 500; margin-bottom: 10px; font-size: 13px;">Pre-defined Themes</div>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;" id="syntax-theme-grid">
                ${Object.entries(SYNTAX_THEMES).map(([key, theme]) => {
                  const isActive = (state.syntaxTheme || 'custom') === key;
                  const swatches = theme.colors ? Object.values(theme.colors).slice(0, 5).map(c =>
                    `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:2px;"></span>`
                  ).join('') : '<span style="opacity:0.5;font-size:10px;">custom</span>';
                  return `
                    <button class="syntax-theme-btn ${isActive ? 'active' : ''}" data-theme="${key}"
                      style="padding:8px 6px;border-radius:6px;border:2px solid ${isActive ? 'var(--accent-color)' : 'var(--border-color)'};
                      background:${isActive ? 'var(--bg-hover)' : 'var(--bg-primary)'};cursor:pointer;text-align:left;
                      transition:border-color 0.15s,background 0.15s;">
                      <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${theme.name}</div>
                      <div style="margin-bottom:4px;">${swatches}</div>
                      <div style="font-size:10px;color:var(--text-secondary);">${theme.description}</div>
                    </button>`;
                }).join('')}
              </div>
            </div>

            <!-- Custom Colors (shown only when Custom theme selected) -->
            <div id="custom-colors-section" style="display:${(state.syntaxTheme || 'custom') === 'custom' ? 'block' : 'none'};">
              <div style="font-weight: 500; margin-bottom: 8px; font-size: 13px;">Custom Colors</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                ${renderColorInput("Comment", "comment")}
                ${renderColorInput("Keyword", "keyword")}
                ${renderColorInput("String", "string")}
                ${renderColorInput("Number", "number")}
                ${renderColorInput("Boolean", "boolean")}
                ${renderColorInput("Key / Property", "key")}
                ${renderColorInput("Tag", "tag")}
                ${renderColorInput("Line Numbers", "lineNumberColor")}
                ${renderColorInput("Fold Arrows", "foldColor")}
              </div>
              <button class="btn-secondary" id="btn-reset-colors" style="margin-top: 12px; width: 100%; font-size: 12px;">
                Reset to Default Colors
              </button>
            </div>

          </div>
        </div>

        <!-- Integrations Tab -->
        <div id="settings-tab-integrations" class="settings-panel" style="display: none;">
          <div class="git-settings-section">
            <div class="git-settings-label">${t("settings.integrations.vcs")}</div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.integrations.github")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.integrations.github_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="git-integration-toggle" ${gitEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.integrations.gitea")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.integrations.gitea_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="gitea-integration-toggle" ${state.giteaIntegrationEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.integrations.exclusions")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.integrations.exclusions_hint")}</div>
              </div>
              <button class="btn-secondary" id="btn-manage-exclusions" style="padding: 6px 12px; font-size: 12px;">
                ${t("settings.integrations.exclusions_btn")}
              </button>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.integrations.sftp")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.integrations.sftp_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="sftp-integration-toggle" ${state.sftpIntegrationEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.integrations.terminal")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.integrations.terminal_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="terminal-integration-toggle" ${state.terminalIntegrationEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div id="terminal-config-section" style="display: block; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="font-weight: 500; margin-bottom: 8px; font-size: 13px;">${t("settings.integrations.terminal_config")}</div>
              
              <div style="display: flex; align-items: center; margin-bottom: 8px;">
                <div style="flex: 1;">
                  <div style="font-size: 12px; font-weight: 500;">${t("settings.integrations.default_ssh")}</div>
                  <div style="font-size: 11px; color: var(--text-secondary);">${t("settings.integrations.default_ssh_hint")}</div>
                </div>
                <select id="default-ssh-host-select" class="git-settings-input" style="width: 200px; margin-left: 16px;">
                  <option value="local" ${state.defaultSshHost === 'local' ? 'selected' : ''}>${t("settings.integrations.ssh_local")}</option>
                  ${(state.sshHosts || []).map(host => `
                    <option value='${JSON.stringify(host)}' ${state.defaultSshHost === JSON.stringify(host) ? 'selected' : ''}>${host.name} (${host.host})</option>
                  `).join('')}
                </select>
              </div>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">Hosts</div>

            <div style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">Saved hosts are shared between SFTP and terminal SSH.</div>
              <div id="settings-hosts-list" style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                ${(state.sshHosts || []).length === 0
                  ? `<div style="padding: 12px; text-align: center; color: var(--text-secondary); border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px;">No hosts saved yet</div>`
                  : (state.sshHosts || []).map((host, i) => `
                  <div style="display: flex; align-items: center; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 4px; gap: 8px;">
                    <span class="ui-icon material-icons settings-host-icon">dns</span>
                    <div style="flex: 1; min-width: 0;">
                      <div style="font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${host.name || host.host}</div>
                      <div style="font-size: 11px; color: var(--text-secondary);">${host.username}@${host.host}:${host.port || 22} &nbsp;·&nbsp; ${host.authType === 'key' ? '🔑 Key' : '🔐 Password'}</div>
                    </div>
                    <button class="icon-btn settings-host-edit" data-id="${host.id}" style="color: var(--accent-color); padding: 4px;"><span class="ui-icon material-icons settings-host-action-icon">edit</span></button>
                    <button class="icon-btn settings-host-delete" data-id="${host.id}" style="color: var(--error-color); padding: 4px;"><span class="ui-icon material-icons settings-host-action-icon">delete</span></button>
                  </div>`).join('')}
              </div>
              <button id="btn-settings-add-host" class="btn-secondary" style="width: 100%; padding: 8px; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <span class="ui-icon material-icons settings-host-action-icon">add</span> Add Host
              </button>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">${t("settings.integrations.ai_title")}</div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.integrations.ai_enable")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.integrations.ai_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="ai-integration-toggle" ${state.aiIntegrationEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div id="ai-config-section" style="display: block; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <fieldset class="settings-mode-fieldset">
                <legend>${t('settings.ai.type')}</legend>
                <div class="settings-segmented" role="radiogroup" aria-label="${t('settings.ai.type')}">
                  <label><input type="radio" name="ai-type" value="rule-based" ${state.aiType === 'rule-based' ? 'checked' : ''}><span>${t('settings.ai.rule_based')}</span></label>
                  <label><input type="radio" name="ai-type" value="local-ai" ${state.aiType === 'local-ai' ? 'checked' : ''}><span>${t('settings.ai.local')}</span></label>
                  <label><input type="radio" name="ai-type" value="cloud" ${state.aiType === 'cloud' ? 'checked' : ''}><span>${t('settings.ai.cloud')}</span></label>
                  <label><input type="radio" name="ai-type" value="hass-agent" ${state.aiType === 'hass-agent' ? 'checked' : ''}><span>${t('settings.ai.ha_agent')}</span></label>
                </div>
                <p id="ai-type-description" class="settings-mode-description">${t(`settings.ai.${state.aiType.replace('-', '_')}_hint`)}</p>
              </fieldset>

              <!-- Rule-based Info -->
              <div id="rule-based-info" style="display: ${state.aiType === 'rule-based' ? 'block' : 'none'}; padding: 12px; background: var(--bg-secondary); border-radius: 6px; font-size: 12px; color: var(--text-secondary);">
                <span class="ui-icon material-icons settings-info-icon">info</span>
                <span style="margin-left: 8px;">Rule-based AI uses built-in patterns and templates. No additional configuration needed.</span>
              </div>

              <!-- Local AI Configuration -->
              <div id="local-ai-config" style="display: ${state.aiType === 'local-ai' ? 'block' : 'none'};">
                <div style="font-weight: 500; margin-bottom: 8px; font-size: 13px;">Local AI Provider</div>
                <select id="local-ai-provider-select" class="git-settings-input" style="width: 100%; margin-bottom: 12px;">
                  <option value="ollama" ${state.localAiProvider === 'ollama' ? 'selected' : ''}>Ollama</option>
                  <option value="lm-studio" ${state.localAiProvider === 'lm-studio' ? 'selected' : ''}>LM Studio</option>
                  <option value="custom" ${state.localAiProvider === 'custom' ? 'selected' : ''}>Custom Local Endpoint</option>
                </select>

                <!-- Ollama Config -->
                <div id="ollama-config" style="display: ${state.localAiProvider === 'ollama' ? 'block' : 'none'};">
                  <div style="font-size: 12px; margin-bottom: 4px;">Ollama URL</div>
                  <input type="text" id="ollama-url" class="git-settings-input" style="width: 100%; margin-bottom: 8px;" value="${state.ollamaUrl || 'http://localhost:11434'}" placeholder="http://localhost:11434">

                  ${ollamaModelPicker}

                  <div style="font-size: 11px; color: var(--text-secondary); padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
                    Install Ollama, fetch the installed model list, then choose the model you want Blueprint Studio to use.
                  </div>
                </div>

                <!-- LM Studio Config -->
                <div id="lm-studio-config" style="display: ${state.localAiProvider === 'lm-studio' ? 'block' : 'none'};">
                  <div style="font-size: 12px; margin-bottom: 4px;">LM Studio URL</div>
                  <input type="text" id="lm-studio-url" class="git-settings-input" style="width: 100%; margin-bottom: 8px;" value="${state.lmStudioUrl || 'http://localhost:1234'}" placeholder="http://localhost:1234">

                  ${lmStudioModelPicker}

                  <div style="font-size: 11px; color: var(--text-secondary); padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
                    Download LM Studio from <a href="https://lmstudio.ai" target="_blank" style="color: var(--accent-color);">lmstudio.ai</a> and start the local server.
                  </div>
                </div>

                <!-- Custom AI Config -->
                <div id="custom-ai-config" style="display: ${state.localAiProvider === 'custom' ? 'block' : 'none'};">
                  <div style="font-size: 12px; margin-bottom: 4px;">Endpoint URL</div>
                  <input type="text" id="custom-ai-url" class="git-settings-input" style="width: 100%; margin-bottom: 8px;" value="${state.customAiUrl || ''}" placeholder="http://localhost:8000">

                  ${customModelPicker}

                  <div style="font-size: 11px; color: var(--text-secondary); padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
                    Use this for local or self-hosted servers that already expose an OpenAI-compatible <code style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px;">/v1/chat/completions</code> endpoint. If you want OpenAI or an OpenAI-compatible relay with an API key, use Cloud AI -> OpenAI below.
                  </div>
                </div>
              </div>

              <!-- Cloud AI Configuration -->
              <div id="cloud-ai-config" style="display: ${state.aiType === 'cloud' ? 'block' : 'none'};">
                <div style="font-weight: 500; margin-bottom: 8px; font-size: 13px;">Cloud Provider</div>
                <select id="cloud-provider-select" class="git-settings-input" style="width: 100%; margin-bottom: 12px;">
                  <option value="gemini" ${state.cloudProvider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                  <option value="openai" ${state.cloudProvider === 'openai' ? 'selected' : ''}>OpenAI / Compatible Endpoint</option>
                  <option value="claude" ${state.cloudProvider === 'claude' ? 'selected' : ''}>Anthropic Claude</option>
                </select>

                <div id="openai-provider-help" style="display: ${state.cloudProvider === 'openai' ? 'block' : 'none'}; margin-bottom: 12px; font-size: 11px; color: var(--text-secondary); padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
                  Leave Base URL empty to use the official OpenAI API. Set a Base URL if you want to route requests through a custom relay, proxy, or any OpenAI-compatible endpoint.
                </div>

                <!-- Cloud Model Selection -->
                <div style="font-size: 12px; margin-bottom: 4px;">AI Model</div>
                <div id="gemini-model-container" style="display: ${state.cloudProvider === 'gemini' ? 'block' : 'none'}; margin-bottom: 12px;">
                  ${geminiModelPicker}
                </div>
                <div id="openai-model-container" style="display: ${state.cloudProvider === 'openai' ? 'block' : 'none'}; margin-bottom: 12px;">
                  ${openaiModelPicker}
                </div>
                <div id="claude-model-container" style="display: ${state.cloudProvider === 'claude' ? 'block' : 'none'}; margin-bottom: 12px;">
                  ${claudeModelPicker}
                </div>

                <section class="settings-credentials" aria-labelledby="settings-credentials-title">
                  <div id="settings-credentials-title" class="settings-credentials-title">${t('settings.credentials.title')}</div>
                  <div class="settings-credentials-note">
                    <span class="ui-icon material-icons" aria-hidden="true">shield_lock</span>
                    <span>${t('settings.credentials.private_hint')}</span>
                  </div>
                <!-- Cloud API Keys -->
                <div id="gemini-api-section" style="display: ${state.cloudProvider === 'gemini' ? 'block' : 'none'};">
                  ${renderCredentialField({ id: 'gemini-api-key', stateKey: 'geminiApiKey', label: 'Gemini API Key', keyUrl: 'https://aistudio.google.com/app/apikey' })}
                </div>

                <div id="openai-api-section" style="display: ${state.cloudProvider === 'openai' ? 'block' : 'none'};">
                  <div style="font-size: 12px; margin-bottom: 4px;">Base URL (optional)</div>
                  <input type="text" id="openai-base-url" class="git-settings-input" style="width: 100%; margin-bottom: 8px;" value="${state.openaiBaseUrl || ''}" placeholder="Leave blank for https://api.openai.com/v1">

                  ${renderCredentialField({ id: 'openai-api-key', stateKey: 'openaiApiKey', label: 'OpenAI API Key', keyUrl: 'https://platform.openai.com/api-keys' })}
                </div>

                <div id="claude-api-section" style="display: ${state.cloudProvider === 'claude' ? 'block' : 'none'};">
                  ${renderCredentialField({ id: 'claude-api-key', stateKey: 'claudeApiKey', label: 'Claude API Key', keyUrl: 'https://console.anthropic.com/settings/keys' })}
                </div>
                </section>
              </div>

              <!-- Home Assistant Agent Configuration -->
              <div id="hass-agent-config" style="display: ${state.aiType === 'hass-agent' ? 'block' : 'none'};">
                <div style="font-weight: 500; margin-bottom: 8px; font-size: 13px;">Conversation Agent</div>
                <select id="hass-agent-select" class="git-settings-input" style="width: 100%; margin-bottom: 8px;">
                  <option value="">Auto-detect (prefer Claw Assistant)</option>
                  ${(state.hassAgents || []).map(a => `<option value="${a.id}" ${state.hassAgentId === a.id ? 'selected' : ''}>${a.name} (${a.platform})</option>`).join('')}
                </select>
                <button id="btn-refresh-hass-agents" type="button" class="git-settings-input" style="width: 100%; margin-bottom: 8px; cursor: pointer; padding: 6px; text-align: center;">
                  <span class="ui-icon material-icons settings-refresh-icon">refresh</span> Refresh Agents
                </button>
                <div style="font-size: 11px; color: var(--text-secondary); padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
                  Route queries through a Home Assistant conversation agent (e.g. Claw Assistant). The agent can read and edit files directly — changes are shown as diffs for you to accept or reject.
                </div>
              </div>

              <button class="btn-primary" id="btn-save-ai-settings" style="margin-top: 12px; width: 100%; font-size: 12px; height: 32px;">
                  Apply AI Settings
              </button>
            </div>
          </div>
        </div>

        <!-- Advanced Tab -->
        <div id="settings-tab-advanced" class="settings-panel" style="display: none;">
          <div class="git-settings-section">
            <div class="git-settings-label">${t("settings.advanced.performance")}</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">
              ${t("settings.advanced.performance_hint")}
            </div>

            <div id="advanced-git-polling-section" style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-weight: 500;">${t("settings.advanced.git_polling")}</div>
                <span id="polling-interval-value" style="font-family: monospace; color: var(--text-secondary);">${t('settings.units.seconds_short', { count: (state.pollingInterval / 1000).toFixed(0) })}</span>
              </div>
              <input type="range" id="polling-interval-slider" min="10000" max="60000" step="5000" value="${state.pollingInterval}" style="width: 100%;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                ${t("settings.advanced.git_polling_hint")}
              </div>
            </div>

            <div id="advanced-remote-fetch-section" style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-weight: 500;">${t("settings.advanced.fetch_interval")}</div>
                <span id="remote-fetch-interval-value" style="font-family: monospace; color: var(--text-secondary);">${t('settings.units.seconds_short', { count: (state.remoteFetchInterval / 1000).toFixed(0) })}</span>
              </div>
              <input type="range" id="remote-fetch-interval-slider" min="15000" max="300000" step="15000" value="${state.remoteFetchInterval}" style="width: 100%;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                ${t("settings.advanced.fetch_interval_hint")}
              </div>
            </div>

            <div style="padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-weight: 500;">${t("settings.advanced.cache_size")}</div>
                <span id="file-cache-size-value" style="font-family: monospace; color: var(--text-secondary);">${t('settings.units.files', { count: state.fileCacheSize })}</span>
              </div>
              <input type="range" id="file-cache-size-slider" min="5" max="20" step="1" value="${state.fileCacheSize}" style="width: 100%;">
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                ${t("settings.advanced.cache_size_hint")}
              </div>
            </div>

            <div style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.advanced.virtual_scroll")}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.advanced.virtual_scroll_hint")}</div>
              </div>
              <label class="toggle-switch" style="margin-left: 16px;">
                <input type="checkbox" id="virtual-scroll-toggle" ${state.enableVirtualScroll ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="padding: 12px; background: var(--bg-secondary); border-radius: 6px; font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
              <span class="ui-icon material-icons settings-info-icon">info</span>
              <span style="margin-left: 8px;">${t("settings.info_applied")}</span>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">${t('settings.guidance.title')}</div>
            <div class="settings-guidance-intro">${t('settings.guidance.hint')}</div>
            <div class="settings-guidance-grid">
              ${[
                ['file', 'note_add'], ['git', 'account_tree'], ['sftp', 'lan'],
                ['validation', 'fact_check'], ['terminal', 'terminal'], ['ai', 'psychology'],
              ].map(([workflow, icon]) => `
                <button type="button" class="settings-guidance-action" data-guidance-workflow="${workflow}">
                  <span class="ui-icon material-icons" aria-hidden="true">${icon}</span>
                  <span><strong>${t(`settings.guidance.${workflow}`)}</strong><small>${t(`settings.guidance.${workflow}_hint`)}</small></span>
                  <span class="ui-icon material-icons" aria-hidden="true">chevron_right</span>
                </button>
              `).join('')}
            </div>
            <button type="button" class="ui-button ui-button--secondary settings-onboarding-resume" id="btn-resume-onboarding">
              <span class="ui-icon material-icons" aria-hidden="true">school</span>
              <span>${t('settings.guidance.resume')}</span>
            </button>

            <div class="git-settings-label" style="margin-top: 20px;">${t("settings.advanced.experimental")}</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
              ${t("settings.advanced.experimental_hint")}
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
                <div style="flex: 1;">
                    <div style="font-weight: 500; margin-bottom: 4px;">${t("settings.advanced.pwa_token")}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">${t("settings.advanced.pwa_token_hint")}</div>
                </div>
                <button class="btn-secondary" id="btn-clear-pwa-token" style="padding: 6px 12px; font-size: 12px;">
                    ${t("settings.advanced.pwa_token_btn")}
                </button>
            </div>

            <div class="git-settings-label" style="margin-top: 20px;">Frontend Cache</div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--divider-color);">
                <div style="flex: 1;">
                    <div style="font-weight: 500; margin-bottom: 4px;">Clear Frontend Cache</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">Unregister Service Worker, purge CacheStorage, and hard-reload. Fixes stale UI after updates.</div>
                </div>
                <button class="btn-secondary" id="btn-clear-frontend-cache" style="padding: 6px 12px; font-size: 12px; white-space: nowrap; margin-left: 12px;">
                    Clear &amp; Reload
                </button>
            </div>

            <div class="git-settings-label" style="margin-top: 20px; color: var(--error-color);">${t("settings.advanced.danger")}</div>

            <!-- Reset Application -->
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                <div style="font-size: 12px; color: var(--text-secondary); max-width: 70%;">
                    ${t("settings.advanced.reset_hint")}
                </div>
                <button class="btn-secondary" id="btn-reset-app" style="padding: 6px 12px; font-size: 12px; color: var(--error-color); border-color: var(--error-color);">
                    ${t("settings.advanced.reset_btn")}
                </button>
            </div>
          </div>
        </div>
          </div>
          <div class="settings-apply-note">
            <span class="ui-icon material-icons settings-info-icon">info</span>
            <span>${t("settings.info_applied")}</span>
          </div>
        </main>
      </div>
    `;

    activateSharedModal({
      returnFocus: returnFocus || document.getElementById('btn-app-settings'),
      initialFocus: () => modalBody.querySelector('.settings-tab.active')
        || modalBody.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), button:not([disabled])'),
    });
    modal.classList.add("modal--full-workflow", "modal--settings-workbench");
    modal.style.maxWidth = "880px";
    modal.style.maxHeight = "85vh";

    // Hide default modal buttons
    if (modalFooter) {
      modalFooter.style.display = "none";
    }

    // Function to clean up and close the Settings modal
    const closeSettings = () => {
      deactivateSharedModal();

      // Reset modal to default state
      eventBus.emit('ui:modal-reset');

      // Remove overlay click handler
      modalOverlay.removeEventListener("click", overlayClickHandler);
    };

    // Overlay click handler
    const overlayClickHandler = (e) => {
      if (e.target === modalOverlay) {
        closeSettings();
      }
    };

    modalOverlay.addEventListener("click", overlayClickHandler);

    // Function to update advanced settings state (grey out if not used)
    const updateAdvancedSettingsState = () => {
        const gitPollingSection = document.getElementById("advanced-git-polling-section");
        const remoteFetchSection = document.getElementById("advanced-remote-fetch-section");
        
        const anyGitEnabled = state.gitIntegrationEnabled || state.giteaIntegrationEnabled;
        
        if (gitPollingSection) {
            const slider = gitPollingSection.querySelector("input");
            if (slider) slider.disabled = !anyGitEnabled;
        }
        
        if (remoteFetchSection) {
            const slider = remoteFetchSection.querySelector("input");
            if (slider) slider.disabled = !anyGitEnabled;
        }
    };

    // Initial state check
    updateAdvancedSettingsState();

    // Handle settings navigation and purpose-based search.
    const tabButtons = modalBody.querySelectorAll('.settings-tab');
    const tabPanels = modalBody.querySelectorAll('.settings-panel');
    const searchInput = modalBody.querySelector('#settings-search-input');
    const searchClear = modalBody.querySelector('#settings-search-clear');
    const searchResults = modalBody.querySelector('#settings-search-results');
    const workbench = modalBody.querySelector('.settings-workbench');
    const drilldownBack = modalBody.querySelector('#settings-drilldown-back');
    const drilldownTitle = modalBody.querySelector('#settings-drilldown-title');
    const navSearch = modalBody.querySelector('#settings-nav-search');
    const narrowSettings = window.matchMedia('(max-width: 768px)');
    let activeSection = normalizeSettingsSection(section);

    const integrationGroups = modalBody.querySelector('#settings-tab-integrations .git-settings-section');
    let integrationGroup = 'source-control';
    [...(integrationGroups?.children || [])].forEach((child) => {
      if (child.nextElementSibling?.querySelector('#ai-integration-toggle')) integrationGroup = 'ai-privacy';
      if (child.querySelector('#sftp-integration-toggle')) integrationGroup = 'connections';
      if (child.querySelector('#ai-integration-toggle')) integrationGroup = 'ai-privacy';
      child.dataset.settingsGroup = integrationGroup;
    });

    const sectionForControl = (control, panelId) => {
      if (panelId === 'general') return 'workspace';
      if (panelId === 'appearance') return 'appearance';
      if (panelId === 'advanced') return 'advanced';
      if (panelId === 'editor') {
        return ['split-view-toggle', 'auto-save-toggle', 'auto-save-delay-input', 'one-tab-mode-toggle'].includes(control.id)
          ? 'features'
          : 'editor';
      }
      if (control.closest('#ai-config-section') || control.id === 'ai-integration-toggle') return 'ai-privacy';
      if (['git-integration-toggle', 'gitea-integration-toggle', 'btn-manage-exclusions'].includes(control.id)) return 'source-control';
      return 'connections';
    };

    const activateSettingsSection = (requestedSection, { focusTarget = false, openSection = true } = {}) => {
      activeSection = normalizeSettingsSection(requestedSection);
      const config = SETTINGS_SECTIONS.find((item) => item.id === activeSection);
      workbench.classList.toggle('is-section-open', !narrowSettings.matches || openSection);
      drilldownTitle.textContent = t(config.labelKey);
      tabButtons.forEach((button) => {
        const selected = button.dataset.section === activeSection;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-current', selected ? 'page' : 'false');
        if (selected && tabButtons[0]?.parentElement.scrollWidth > tabButtons[0]?.parentElement.clientWidth) {
          tabButtons[0].parentElement.scrollTo({ left: Math.max(0, button.offsetLeft - 8) });
        }
      });
      tabPanels.forEach((panel) => {
        panel.style.display = panel.id === `settings-tab-${config.panel}` ? 'block' : 'none';
      });
      integrationGroups?.querySelectorAll(':scope > [data-settings-group]').forEach((item) => {
        item.classList.toggle(
          'settings-group-filtered',
          config.panel === 'integrations' && item.dataset.settingsGroup !== activeSection,
        );
      });
      requestAnimationFrame(() => {
        const target = modalBody.querySelector(config.target);
        const scrollTarget = target?.closest('.git-settings-section > div') || target;
        scrollTarget?.scrollIntoView({ block: 'start' });
        if (focusTarget) target?.focus({ preventScroll: true });
      });
    };

    const searchableControls = [...modalBody.querySelectorAll('.settings-panel input, .settings-panel select, .settings-panel button')]
      .filter((control) => control.id || control.name)
      .map((control) => {
        const panel = control.closest('.settings-panel');
        const panelId = panel?.id.replace('settings-tab-', '') || 'general';
        const container = control.closest('#ai-config-section, #terminal-config-section, .git-settings-section > div') || control.parentElement;
        const labelSource = container?.querySelector('div[style*="font-weight: 500"], .git-settings-label, label')
          ?.textContent || control.getAttribute('aria-label') || control.id;
        const label = (container?.textContent || labelSource || control.id)
          .replace(/\s+/g, ' ')
          .trim();
        const resultLabel = labelSource.replace(/\s+/g, ' ').trim().slice(0, 110) || control.id;
        const itemSection = sectionForControl(control, panelId);
        const config = SETTINGS_SECTIONS.find((item) => item.id === itemSection);
        return {
          control,
          section: itemSection,
          label: resultLabel,
          haystack: `${label} ${control.id} ${control.name || ''} ${t(config.labelKey)} ${config.keywords}`.toLocaleLowerCase(state.language || 'en'),
        };
      });

    const renderSettingsSearch = () => {
      const query = searchInput.value.trim().toLocaleLowerCase(state.language || 'en');
      searchClear.hidden = !query;
      searchResults.hidden = !query;
      modalBody.querySelector('.settings-content').hidden = Boolean(query);
      if (!query) {
        searchResults.replaceChildren();
        activateSettingsSection(activeSection);
        return;
      }
      const terms = query.split(/\s+/).filter(Boolean);
      const matches = searchableControls
        .filter((item) => terms.every((term) => item.haystack.includes(term)))
        .filter((item, index, all) => all.findIndex((candidate) => candidate.label === item.label && candidate.section === item.section) === index)
        .slice(0, 40);
      searchResults.innerHTML = matches.length
        ? `<div class="settings-search-summary">${t('settings.search_count', { count: matches.length })}</div>${matches.map((item, index) => `
            <button type="button" class="settings-search-result" data-result-index="${index}">
              <span class="settings-search-result-copy"><strong>${escapeHtml(item.label)}</strong><small>${t(SETTINGS_SECTIONS.find((entry) => entry.id === item.section).labelKey)}</small></span>
              <span class="ui-icon material-icons" aria-hidden="true">chevron_right</span>
            </button>
          `).join('')}`
        : `<div class="settings-search-empty"><span class="ui-icon material-icons" aria-hidden="true">search_off</span><span>${t('settings.search_empty')}</span></div>`;
      searchResults.querySelectorAll('[data-result-index]').forEach((button) => {
        button.addEventListener('click', () => {
          const match = matches[Number(button.dataset.resultIndex)];
          searchInput.value = '';
          renderSettingsSearch();
          activateSettingsSection(match.section);
          requestAnimationFrame(() => {
            match.control.scrollIntoView({ block: 'center' });
            match.control.focus({ preventScroll: true });
          });
        });
      });
    };

    tabButtons.forEach((button) => button.addEventListener('click', () => {
      searchInput.value = '';
      renderSettingsSearch();
      activateSettingsSection(button.dataset.section, { focusTarget: narrowSettings.matches });
    }));
    drilldownBack.addEventListener('click', () => {
      searchInput.value = '';
      renderSettingsSearch();
      workbench.classList.remove('is-section-open');
      modalBody.querySelector(`.settings-tab[data-section="${activeSection}"]`)?.focus();
    });
    navSearch.addEventListener('click', () => {
      workbench.classList.add('is-section-open');
      drilldownTitle.textContent = t('settings.search_title');
      requestAnimationFrame(() => searchInput.focus());
    });
    searchInput.addEventListener('input', renderSettingsSearch);
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      renderSettingsSearch();
      searchInput.focus();
    });
    activateSettingsSection(activeSection, { openSection: !narrowSettings.matches });

    const guidanceActions = {
      file: () => document.getElementById('btn-new-file')?.click(),
      git: () => eventBus.emit('ui:switch-sidebar-view', 'source-control'),
      sftp: () => eventBus.emit('ui:switch-sidebar-view', 'sftp'),
      validation: () => document.getElementById('btn-validate')?.click(),
      terminal: () => eventBus.emit('terminal:toggle', true),
      ai: () => eventBus.emit('ui:toggle-ai-sidebar', true),
    };
    modalBody.querySelectorAll('[data-guidance-workflow]').forEach((button) => {
      button.addEventListener('click', () => {
        closeSettings();
        guidanceActions[button.dataset.guidanceWorkflow]?.();
      });
    });
    modalBody.querySelector('#btn-resume-onboarding')?.addEventListener('click', async () => {
      state.onboardingCompleted = false;
      state.onboardingPaused = false;
      localStorage.removeItem('onboardingCompleted');
      await saveSettingsImpl();
      closeSettings();
      eventBus.emit('onboarding:start', { force: true });
    });

    // Internal helper function for saving settings
    const saveSettingsImpl = async () => {
      await saveSettings();
    };

    // Handle Language selection
    const languageSelect = document.getElementById("language-select");
    if (languageSelect) {
      languageSelect.addEventListener("change", async (e) => {
        state.language = e.target.value;
        await saveSettingsImpl();
        
        // Load the new language strings
        await initTranslations(state.language);
        
        // Refresh UI
        eventBus.emit('ui:refresh-strings');
        
        // Re-render the current settings panel to update all labels
        const selectedSection = modalBody.querySelector('.settings-tab.active')?.dataset.section || 'workspace';
        showAppSettings({ section: selectedSection });

        showToast(t("toast.language_updated"), "success");
      });
    }

    // Handle Recent Files toggle
    const recentFilesToggle = document.getElementById("recent-files-toggle");
    if (recentFilesToggle) {
      recentFilesToggle.addEventListener("change", async (e) => {
        state.showRecentFiles = e.target.checked;
        await saveSettingsImpl();
        eventBus.emit('ui:refresh-recent-files');
        eventBus.emit('ui:refresh-tree');
        showToast(t(state.showRecentFiles ? "toast.recent_files_shown" : "toast.recent_files_hidden"), "success");
      });
    }

    // Handle Recent Files Limit
    const recentFilesLimitInput = document.getElementById("recent-files-limit");
    if (recentFilesLimitInput) {
      recentFilesLimitInput.addEventListener("change", async (e) => {
        state.recentFilesLimit = parseInt(e.target.value);
        await saveSettingsImpl();
        eventBus.emit('ui:refresh-recent-files');
        eventBus.emit('ui:refresh-tree');
        showToast(t("toast.recent_limit_set", { limit: state.recentFilesLimit }), "success");
      });
    }

    // Handle Remember Workspace toggle
    const rememberWorkspaceToggle = document.getElementById("remember-workspace-toggle");
    if (rememberWorkspaceToggle) {
      rememberWorkspaceToggle.addEventListener("change", async (e) => {
        state.rememberWorkspace = e.target.checked;
        await saveSettingsImpl();
        showToast(t(state.rememberWorkspace ? "toast.workspace_remembered" : "toast.workspace_not_remembered"), "success");
      });
    }

    const autoHideSidebarToggle = document.getElementById("auto-hide-sidebar-toggle");
    if (autoHideSidebarToggle) {
      autoHideSidebarToggle.addEventListener("change", async (e) => {
        state.autoHideSidebar = e.target.checked;
        await saveSettingsImpl();
        showToast(t(state.autoHideSidebar ? "toast.sidebar_auto_hide_enabled" : "toast.sidebar_auto_hide_disabled"), "success");
      });
    }

    // Handle Show Hidden toggle
    const showHiddenToggle = document.getElementById("show-hidden-toggle");
    if (showHiddenToggle) {
      showHiddenToggle.addEventListener("change", async (e) => {
        state.showHidden = e.target.checked;
        await saveSettingsImpl();
        eventBus.emit('ui:refresh-hidden-button');
        eventBus.emit('ui:reload-files');
        showToast(t(state.showHidden ? "toast.hidden_files_shown" : "toast.hidden_files_hidden"), "success");
      });
    }

    // Handle Git Integration toggle
    const gitToggle = document.getElementById("git-integration-toggle");
    if (gitToggle) {
      gitToggle.addEventListener("change", async (e) => {
        state.gitIntegrationEnabled = e.target.checked;
        localStorage.setItem("gitIntegrationEnabled", state.gitIntegrationEnabled);
        await saveSettingsImpl();

        showToast(t(state.gitIntegrationEnabled ? "toast.github_enabled" : "toast.github_disabled"), "success");

        if (!state.gitIntegrationEnabled) {
            const { gitState } = await import('./state.js');
            gitState.files = { modified: [], added: [], deleted: [], untracked: [], staged: [], unstaged: [] };
            gitState.totalChanges = 0;
            eventBus.emit('git:refresh');
        }

        // Update UI visibility immediately
        eventBus.emit('ui:refresh-visibility');

        updateAdvancedSettingsState();

        // Reload to update file tree
        eventBus.emit('ui:reload-files');
      });
    }

    // Handle Gitea Integration toggle
    const giteaToggle = document.getElementById("gitea-integration-toggle");
    if (giteaToggle) {
      giteaToggle.addEventListener("change", async (e) => {
        state.giteaIntegrationEnabled = e.target.checked;
        await saveSettingsImpl();

        showToast(t(state.giteaIntegrationEnabled ? "toast.gitea_enabled" : "toast.gitea_disabled"), "success");

        if (!state.giteaIntegrationEnabled) {
            const { giteaState } = await import('./state.js');
            giteaState.files = { modified: [], added: [], deleted: [], untracked: [], staged: [], unstaged: [] };
            giteaState.totalChanges = 0;
            eventBus.emit('git:refresh');
        }

        // Update UI visibility immediately
        eventBus.emit('ui:refresh-visibility');

        updateAdvancedSettingsState();

        // Reload to update file tree
        eventBus.emit('ui:reload-files');
      });
    }

    // Handle SFTP Integration toggle
    const sftpToggle = document.getElementById("sftp-integration-toggle");
    if (sftpToggle) {
      sftpToggle.addEventListener("change", async (e) => {
        state.sftpIntegrationEnabled = e.target.checked;
        await saveSettingsImpl();
        showToast(t(state.sftpIntegrationEnabled ? "toast.sftp_enabled" : "toast.sftp_disabled"), "success");
        eventBus.emit('ui:refresh-visibility');
        updateAdvancedSettingsState();
      });
    }

    const terminalToggle = document.getElementById("terminal-integration-toggle");
    if (terminalToggle) {
      terminalToggle.addEventListener("change", async (e) => {
        state.terminalIntegrationEnabled = e.target.checked;
        await saveSettingsImpl();
        eventBus.emit('ui:refresh-visibility');
        showToast(state.terminalIntegrationEnabled ? t("toast.terminal_enabled") : t("toast.terminal_disabled"), "success");
      });
    }

    const defaultSshHostSelect = document.getElementById("default-ssh-host-select");
    if (defaultSshHostSelect) {
      defaultSshHostSelect.addEventListener("change", async (e) => {
        state.defaultSshHost = e.target.value;
        await saveSettingsImpl();
        showToast(t("toast.saved_successfully"), "success");
      });
    }

    // Handle Theme Preset selection
    const themePresetSelect = document.getElementById("theme-preset-select");
    if (themePresetSelect) {
      themePresetSelect.addEventListener("change", async (e) => {
        state.themePreset = e.target.value;
        await saveSettingsImpl();
        eventBus.emit('ui:refresh-theme');
        showToast(t('toast.theme_changed', { theme: THEME_PRESETS[state.themePreset].name }), "success");
      });
    }

    // Handle Accent Color buttons
    const accentColorButtons = modalBody.querySelectorAll('.accent-color-btn');
    accentColorButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const color = btn.dataset.color || null;
        state.accentColor = color;

        // Update button borders
        accentColorButtons.forEach(b => {
          const isActive = (b.dataset.color || null) === color;
          b.style.borderColor = isActive ? 'var(--text-primary)' : 'transparent';
        });

        await saveSettingsImpl();
        eventBus.emit('ui:refresh-theme');
        showToast(t(color ? "toast.accent_updated" : "toast.accent_reset"), "success");
      });
    });

    // Handle Font Size
    const fontSizeSlider = document.getElementById("font-size-slider");
    const fontSizeValue = document.getElementById("font-size-value");
    if (fontSizeSlider && fontSizeValue) {
      fontSizeSlider.addEventListener("input", (e) => {
        fontSizeValue.textContent = `${e.target.value}px`;
      });

      fontSizeSlider.addEventListener("change", async (e) => {
        state.fontSize = parseInt(e.target.value);

        // Apply to all editors immediately
        eventBus.emit('ui:refresh-editor');

        // Refresh all editors
        if (state.primaryEditor) state.primaryEditor.refresh();
        if (state.secondaryEditor) state.secondaryEditor.refresh();

        await saveSettingsImpl();
        showToast(t("toast.font_size_set", { size: state.fontSize }), "success");
      });
    }

    // Handle Font Family
    const fontFamilySelect = document.getElementById("font-family-select");
    if (fontFamilySelect) {
      fontFamilySelect.addEventListener("change", async (e) => {
        state.fontFamily = e.target.value;

        // Apply to all editors immediately
        eventBus.emit('ui:refresh-editor');

        // Refresh all editors
        if (state.primaryEditor) state.primaryEditor.refresh();
        if (state.secondaryEditor) state.secondaryEditor.refresh();

        await saveSettingsImpl();
        showToast(t("toast.font_family_updated"), "success");
      });
    }

    // Handle Tab Size
    const tabSizeSelect = document.getElementById("tab-size-select");
    if (tabSizeSelect) {
      tabSizeSelect.addEventListener("change", async (e) => {
        state.tabSize = parseInt(e.target.value);

        // Apply to all editors immediately
        if (state.primaryEditor) {
          state.primaryEditor.setOption("tabSize", state.tabSize);
          state.primaryEditor.setOption("indentUnit", state.indentWithTabs ? 1 : state.tabSize);
        }
        if (state.secondaryEditor) {
          state.secondaryEditor.setOption("tabSize", state.tabSize);
          state.secondaryEditor.setOption("indentUnit", state.indentWithTabs ? 1 : state.tabSize);
        }

        await saveSettingsImpl();
        updateStatusBar();
        showToast(t("toast.tab_size_set", { size: state.tabSize }), "success");
      });
    }

    // Handle Indent with Tabs
    const indentWithTabsToggle = document.getElementById("indent-with-tabs-toggle");
    if (indentWithTabsToggle) {
      indentWithTabsToggle.addEventListener("change", async (e) => {
        state.indentWithTabs = e.target.checked;

        if (state.primaryEditor) {
          state.primaryEditor.setOption("indentWithTabs", state.indentWithTabs);
          state.primaryEditor.setOption("indentUnit", state.indentWithTabs ? 1 : state.tabSize);
        }
        if (state.secondaryEditor) {
          state.secondaryEditor.setOption("indentWithTabs", state.indentWithTabs);
          state.secondaryEditor.setOption("indentUnit", state.indentWithTabs ? 1 : state.tabSize);
        }

        await saveSettingsImpl();
        updateStatusBar();
        showToast(t(state.indentWithTabs ? 'toast.indent_tabs_enabled' : 'toast.indent_tabs_disabled'), "success");
      });
    }
    // Handle Word Wrap
    const wordWrapToggle = document.getElementById("word-wrap-toggle");
    if (wordWrapToggle) {
      wordWrapToggle.addEventListener("change", async (e) => {
        state.wordWrap = e.target.checked;

        // Apply to all editors immediately
        eventBus.emit('ui:refresh-editor');

        await saveSettingsImpl();
        showToast(t(state.wordWrap ? "toast.word_wrap_enabled" : "toast.word_wrap_disabled"), "success");
      });
    }

    // Handle Line Numbers
    const lineNumbersToggle = document.getElementById("line-numbers-toggle");
    if (lineNumbersToggle) {
      lineNumbersToggle.addEventListener("change", async (e) => {
        state.showLineNumbers = e.target.checked;

        // Apply to all editors immediately
        eventBus.emit('ui:refresh-editor');

        await saveSettingsImpl();
        showToast(t(state.showLineNumbers ? "toast.line_numbers_shown" : "toast.line_numbers_hidden"), "success");
      });
    }

    // Handle Whitespace
    const whitespaceToggle = document.getElementById("whitespace-toggle");
    if (whitespaceToggle) {
      whitespaceToggle.addEventListener("change", async (e) => {
        state.showWhitespace = e.target.checked;
        await saveSettingsImpl();

        // Apply editor settings immediately (toggles whitespace overlay)
        eventBus.emit('ui:refresh-editor');

        showToast(t(state.showWhitespace ? "toast.whitespace_shown" : "toast.whitespace_hidden"), "success");
      });
    }

    // Handle Minimap
    const minimapToggle = document.getElementById("minimap-toggle");
    if (minimapToggle) {
      minimapToggle.addEventListener("change", async (e) => {
        state.showMinimap = e.target.checked;
        eventBus.emit('ui:refresh-editor');
        await saveSettingsImpl();
        showToast(t(state.showMinimap ? 'toast.minimap_enabled' : 'toast.minimap_disabled'), "success");
      });
    }

    // Handle Autocomplete
    const autocompleteToggle = document.getElementById("autocomplete-toggle");
    if (autocompleteToggle) {
      autocompleteToggle.addEventListener("change", async (e) => {
        state.autocompleteEnabled = e.target.checked;
        await saveSettingsImpl();
        showToast(t(state.autocompleteEnabled ? 'toast.autocomplete_enabled' : 'toast.autocomplete_disabled'), "success");
      });
    }

    // Handle Auto-Save
    const autoSaveToggle = document.getElementById("auto-save-toggle");
    const autoSaveDelayContainer = document.getElementById("auto-save-delay-container");
    if (autoSaveToggle) {
      autoSaveToggle.addEventListener("change", async (e) => {
        state.autoSave = e.target.checked;
        await saveSettingsImpl();
        showToast(t(state.autoSave ? "toast.autosave_enabled" : "toast.autosave_disabled"), "success");
      });
    }

    const autoSaveDelayInput = document.getElementById("auto-save-delay-input");
    if (autoSaveDelayInput) {
      autoSaveDelayInput.addEventListener("change", async (e) => {
        state.autoSaveDelay = parseInt(e.target.value);
        await saveSettingsImpl();
        showToast(t("toast.autosave_delay_set", { delay: state.autoSaveDelay }), "success");
      });
    }

    const oneTabModeToggle = document.getElementById("one-tab-mode-toggle");
    if (oneTabModeToggle) {
      oneTabModeToggle.addEventListener("change", async (e) => {
        state.onTabMode = e.target.checked;
        // Sync toolbar button if present
        const btnOneTabMode = document.getElementById("btn-one-tab-mode");
        if (btnOneTabMode) {
          btnOneTabMode.classList.toggle("active", state.onTabMode);
        }
        await saveSettingsImpl();
        showToast(t(state.onTabMode ? "toast.onetab_enabled" : "toast.onetab_disabled"), "success");
      });
    }

    // Handle File Tree Compact
    const fileTreeCompactToggle = document.getElementById("file-tree-compact-toggle");
    if (fileTreeCompactToggle) {
      fileTreeCompactToggle.addEventListener("change", async (e) => {
        state.fileTreeCompact = e.target.checked;
        await saveSettingsImpl();

        // Apply layout changes immediately
        eventBus.emit('ui:refresh-layout');

        eventBus.emit('ui:refresh-tree');
        showToast(t(state.fileTreeCompact ? "toast.compact_enabled" : "toast.compact_disabled"), "success");
      });
    }

    // Handle File Tree Icons
    const fileTreeIconsToggle = document.getElementById("file-tree-icons-toggle");
    if (fileTreeIconsToggle) {
      fileTreeIconsToggle.addEventListener("change", async (e) => {
        state.fileTreeShowIcons = e.target.checked;
        await saveSettingsImpl();

        // Apply layout changes immediately
        eventBus.emit('ui:refresh-layout');

        eventBus.emit('ui:refresh-tree');
        showToast(t(state.fileTreeShowIcons ? "toast.file_icons_shown" : "toast.file_icons_hidden"), "success");
      });
    }

    // Handle Collapsable Tree Mode
    const treeCollapsableModeToggle = document.getElementById("tree-collapsable-mode-toggle");
    if (treeCollapsableModeToggle) {
      treeCollapsableModeToggle.addEventListener("change", async (e) => {
        state.treeCollapsableMode = e.target.checked;
      // Apply tree mode to lazyLoadingEnabled
      // state.lazyLoadingEnabled = !state.treeCollapsableMode;
        await saveSettingsImpl();

        // Reset navigation state when switching modes
        if (!state.treeCollapsableMode) {
          // Switching back to folder navigation: reset to root
          state.currentNavigationPath = "";
          state.navigationHistory = [];
        } else {
          // Switching to collapsable tree: clear expanded folders
          state.expandedFolders.clear();
        }

        // Reload file tree with new mode
        eventBus.emit('ui:reload-files', { force: true });

        // Show/hide nav elements based on mode
        const breadcrumb = document.getElementById("explorer-breadcrumb");
        const backBtn = document.getElementById("btn-nav-back");
        if (breadcrumb) breadcrumb.style.display = state.treeCollapsableMode ? "none" : "";
        if (backBtn) backBtn.style.display = state.treeCollapsableMode ? "none" : "";

        showToast(t(state.treeCollapsableMode ? "toast.collapsable_enabled" : "toast.navigation_enabled"), "success");
      });
    }
    const showToastsToggle = document.getElementById("show-toasts-toggle");
    if (showToastsToggle) {
      showToastsToggle.addEventListener("change", async (e) => {
        state.showToasts = e.target.checked;
        await saveSettingsImpl();
        showToast(t(state.showToasts ? "toast.toasts_enabled" : "toast.toasts_disabled"), "success");
      });
    }
    const showOperationCenterToggle = document.getElementById("show-operation-center-toggle");
    if (showOperationCenterToggle) {
      showOperationCenterToggle.addEventListener("change", async (e) => {
        state.showOperationCenter = e.target.checked;
        syncOperationCenterVisibility();
        await saveSettingsImpl();
        showToast(t(state.showOperationCenter ? "toast.operation_center_enabled" : "toast.operation_center_disabled"), "success");
      });
    }

    // Handle PWA Install button
    const btnPwaInstall = document.getElementById("btn-pwa-install");
    if (btnPwaInstall) {
      // Check if connection is HTTPS
      const isHttps = window.location.protocol === 'https:';

      if (!isHttps) {
        // Grey out the button for non-HTTPS connections
        btnPwaInstall.style.opacity = '0.5';
        btnPwaInstall.style.cursor = 'not-allowed';
        btnPwaInstall.disabled = true;
        btnPwaInstall.title = 'PWA installation requires HTTPS connection';
      } else {
        btnPwaInstall.addEventListener("click", () => {
          window.open('/blueprint_studio/', 'blueprint_studio_app', 'width=1400,height=900');
        });
      }
    }

    // Handle AI integration toggle
    const aiToggle = document.getElementById("ai-integration-toggle");
    const aiConfigSection = document.getElementById("ai-config-section");
    if (aiToggle) {
      aiToggle.addEventListener("change", (e) => {
        state.aiIntegrationEnabled = e.target.checked;
        saveSettingsImpl();
        showToast(t(state.aiIntegrationEnabled ? "toast.ai_enabled" : "toast.ai_disabled"), "success");
        eventBus.emit('ui:refresh-visibility');
      });
    }

    // Handle AI Type radio buttons
    const aiTypeRadios = modalBody.querySelectorAll('input[name="ai-type"]');
    const ruleBasedInfo = document.getElementById("rule-based-info");
    const localAiConfig = document.getElementById("local-ai-config");
    const cloudAiConfig = document.getElementById("cloud-ai-config");
    const hassAgentConfigSection = document.getElementById("hass-agent-config");
    const aiTypeDescription = document.getElementById("ai-type-description");

    aiTypeRadios.forEach(radio => {
      radio.addEventListener("change", async (e) => {
        const aiType = e.target.value;
        state.aiType = aiType;

        // Show/hide configuration sections
        if (ruleBasedInfo) ruleBasedInfo.style.display = aiType === 'rule-based' ? 'block' : 'none';
        if (localAiConfig) localAiConfig.style.display = aiType === 'local-ai' ? 'block' : 'none';
        if (cloudAiConfig) cloudAiConfig.style.display = aiType === 'cloud' ? 'block' : 'none';
        if (hassAgentConfigSection) hassAgentConfigSection.style.display = aiType === 'hass-agent' ? 'block' : 'none';
        if (aiType === 'hass-agent') void refreshHassAgents({ silent: true });

        if (aiTypeDescription) {
          aiTypeDescription.textContent = t(`settings.ai.${aiType.replace('-', '_')}_hint`);
        }

        await saveSettingsImpl();
        showToast(t('toast.ai_type_set', { type: aiType === 'rule-based' ? t('settings.ai_type_rule') : aiType === 'local-ai' ? t('settings.ai_type_local') : aiType === 'hass-agent' ? t('settings.ai_type_hass') : t('settings.ai_type_cloud') }), "success");
      });
    });

    const CLOUD_PROVIDER_DEFAULT_MODELS = {
      gemini: "",
      openai: "",
      claude: "",
    };

    const localAiProviderSelect = document.getElementById("local-ai-provider-select");
    const ollamaConfig = document.getElementById("ollama-config");
    const lmStudioConfig = document.getElementById("lm-studio-config");
    const customAiConfig = document.getElementById("custom-ai-config");
    const cloudProviderSelect = document.getElementById("cloud-provider-select");
    const geminiModelContainer = document.getElementById("gemini-model-container");
    const openaiModelContainer = document.getElementById("openai-model-container");
    const claudeModelContainer = document.getElementById("claude-model-container");
    const openaiProviderHelp = document.getElementById("openai-provider-help");
    const geminiSection = document.getElementById("gemini-api-section");
    const openaiSection = document.getElementById("openai-api-section");
    const claudeSection = document.getElementById("claude-api-section");

    const updateLocalProviderUi = (provider) => {
      if (ollamaConfig) ollamaConfig.style.display = provider === 'ollama' ? 'block' : 'none';
      if (lmStudioConfig) lmStudioConfig.style.display = provider === 'lm-studio' ? 'block' : 'none';
      if (customAiConfig) customAiConfig.style.display = provider === 'custom' ? 'block' : 'none';
    };

    const updateCloudProviderUi = (provider) => {
      if (geminiModelContainer) geminiModelContainer.style.display = provider === 'gemini' ? 'block' : 'none';
      if (openaiModelContainer) openaiModelContainer.style.display = provider === 'openai' ? 'block' : 'none';
      if (claudeModelContainer) claudeModelContainer.style.display = provider === 'claude' ? 'block' : 'none';
      if (geminiSection) geminiSection.style.display = provider === 'gemini' ? 'block' : 'none';
      if (openaiSection) openaiSection.style.display = provider === 'openai' ? 'block' : 'none';
      if (claudeSection) claudeSection.style.display = provider === 'claude' ? 'block' : 'none';
      if (openaiProviderHelp) openaiProviderHelp.style.display = provider === 'openai' ? 'block' : 'none';
    };

    const bindTextSetting = (inputId, stateKey, transform = (value) => value) => {
      const input = document.getElementById(inputId);
      if (!input) return;
      input.addEventListener("change", (e) => {
        state[stateKey] = transform(e.target.value);
        saveSettingsImpl();
      });
    };

    const bindModelPicker = (sourceKey) => {
      const config = getModelPickerConfig(sourceKey);
      const select = document.getElementById(config.selectId);
      const input = document.getElementById(config.inputId);
      const button = document.getElementById(config.buttonId);

      if (select) {
        select.addEventListener("change", async (e) => {
          if (e.target.value === CUSTOM_MODEL_OPTION_VALUE) {
            if (input) input.focus();
            updateModelPickerUi(sourceKey);
            return;
          }

          setModelValue(sourceKey, e.target.value);
          updateModelPickerUi(sourceKey);
          await saveSettingsImpl();
        });
      }

      if (input) {
        input.addEventListener("input", (e) => {
          setModelValue(sourceKey, e.target.value);
          updateModelPickerUi(sourceKey);
        });

        input.addEventListener("change", async (e) => {
          setModelValue(sourceKey, e.target.value);
          updateModelPickerUi(sourceKey);
          await saveSettingsImpl();
        });
      }

      if (button) {
        button.addEventListener("click", async () => {
          await refreshModelList(sourceKey);
        });
      }

      updateModelPickerUi(sourceKey);
    };

    if (localAiProviderSelect) {
      localAiProviderSelect.addEventListener("change", async (e) => {
        state.localAiProvider = e.target.value;
        updateLocalProviderUi(state.localAiProvider);
        updateModelPickerUi(`local:${state.localAiProvider}`);
        await saveSettingsImpl();
      });
    }

    const hassAgentSelect = document.getElementById("hass-agent-select");
    if (hassAgentSelect) {
      hassAgentSelect.addEventListener("change", async (e) => {
        state.hassAgentId = e.target.value;
        await saveSettingsImpl();
      });
    }
    const btnRefreshHassAgents = document.getElementById("btn-refresh-hass-agents");
    if (btnRefreshHassAgents) {
      btnRefreshHassAgents.addEventListener("click", () => refreshHassAgents());
    }
    if (state.aiType === 'hass-agent') void refreshHassAgents({ silent: true });

    bindTextSetting("ollama-url", "ollamaUrl");
    bindTextSetting("lm-studio-url", "lmStudioUrl");
    bindTextSetting("custom-ai-url", "customAiUrl");

    ["local:ollama", "local:lm-studio", "local:custom", "cloud:gemini", "cloud:openai", "cloud:claude"].forEach(bindModelPicker);
    updateLocalProviderUi(state.localAiProvider);
    updateCloudProviderUi(state.cloudProvider);
    syncAllModelPickers();
    if (state.aiType === "cloud") {
      void refreshModelList(`cloud:${state.cloudProvider}`, { silent: true });
    }

    if (cloudProviderSelect) {
      cloudProviderSelect.addEventListener("change", async (e) => {
        const provider = e.target.value;
        state.cloudProvider = provider;
        state.aiModel = CLOUD_PROVIDER_DEFAULT_MODELS[provider];
        updateCloudProviderUi(provider);
        syncAllModelPickers();
        await saveSettingsImpl();
        void refreshModelList(`cloud:${provider}`, { silent: true });
      });
    }

    const updateCredentialUi = (stateKey) => {
      const saved = Boolean(state[stateKey]);
      const status = modalBody.querySelector(`[data-secret-status="${stateKey}"]`);
      const clear = modalBody.querySelector(`[data-clear-secret="${stateKey}"]`);
      if (status) {
        status.classList.toggle('is-saved', saved);
        status.innerHTML = `<span class="ui-icon material-icons" aria-hidden="true">${saved ? 'lock' : 'lock_open'}</span><span>${t(saved ? 'settings.credentials.saved_hidden' : 'settings.credentials.not_saved')}</span>`;
      }
      if (clear) clear.disabled = !saved;
    };

    const bindCredentialInput = (inputId, stateKey) => {
      const input = document.getElementById(inputId);
      if (!input) return;
      input.addEventListener('change', async () => {
        const replacement = input.value.trim();
        if (!replacement) return;
        state[stateKey] = replacement;
        input.value = '';
        input.placeholder = t('settings.credentials.replace_placeholder');
        await saveSettingsImpl();
        updateCredentialUi(stateKey);
        showToast(t('settings.credentials.saved'), 'success');
      });
    };

    bindCredentialInput('gemini-api-key', 'geminiApiKey');
    bindCredentialInput('openai-api-key', 'openaiApiKey');
    bindCredentialInput('claude-api-key', 'claudeApiKey');

    modalBody.querySelectorAll('[data-clear-secret]').forEach((button) => {
      button.addEventListener('click', async () => {
        const stateKey = button.dataset.clearSecret;
        state[stateKey] = '';
        const input = modalBody.querySelector(`[data-secret-key="${stateKey}"]`);
        if (input) {
          input.value = '';
          input.placeholder = t('settings.credentials.enter_placeholder');
        }
        await saveSettingsImpl();
        updateCredentialUi(stateKey);
        showToast(t('settings.credentials.cleared'), 'success');
      });
    });

    const openaiBaseUrlInput = document.getElementById("openai-base-url");
    if (openaiBaseUrlInput) {
      openaiBaseUrlInput.addEventListener("change", (e) => {
        state.openaiBaseUrl = e.target.value.trim();
        saveSettingsImpl();
      });
    }

    // Handle Apply AI Settings button
    const btnSaveAI = document.getElementById("btn-save-ai-settings");
    if (btnSaveAI) {
      btnSaveAI.addEventListener("click", async () => {
        const readValue = (inputId, fallback = "") => String(document.getElementById(inputId)?.value || fallback).trim();

        // Save all AI settings from inputs
        state.aiType = document.querySelector('input[name="ai-type"]:checked')?.value || 'rule-based';

        // Local AI settings
        state.localAiProvider = document.getElementById("local-ai-provider-select")?.value || 'ollama';
        state.ollamaUrl = readValue("ollama-url", 'http://localhost:11434') || 'http://localhost:11434';
        state.ollamaModel = readValue("ollama-model", '');
        state.lmStudioUrl = readValue("lm-studio-url", 'http://localhost:1234') || 'http://localhost:1234';
        state.lmStudioModel = readValue("lm-studio-model", '');
        state.customAiUrl = readValue("custom-ai-url", '');
        state.customAiModel = readValue("custom-ai-model", '');
        state.hassAgentId = document.getElementById("hass-agent-select")?.value || '';

        // Cloud AI settings
        state.cloudProvider = document.getElementById("cloud-provider-select")?.value || 'gemini';
        if (state.cloudProvider === 'gemini') {
          state.aiModel = readValue("gemini-model-custom", CLOUD_PROVIDER_DEFAULT_MODELS.gemini) || CLOUD_PROVIDER_DEFAULT_MODELS.gemini;
        } else if (state.cloudProvider === 'openai') {
          state.aiModel = readValue("openai-model-custom", CLOUD_PROVIDER_DEFAULT_MODELS.openai) || CLOUD_PROVIDER_DEFAULT_MODELS.openai;
        } else if (state.cloudProvider === 'claude') {
          state.aiModel = readValue("claude-model-custom", CLOUD_PROVIDER_DEFAULT_MODELS.claude) || CLOUD_PROVIDER_DEFAULT_MODELS.claude;
        }

        state.geminiApiKey = readValue("gemini-api-key", state.geminiApiKey);
        state.openaiApiKey = readValue("openai-api-key", state.openaiApiKey);
        state.openaiBaseUrl = readValue("openai-base-url", '');
        state.claudeApiKey = readValue("claude-api-key", state.claudeApiKey);

        syncAllModelPickers();
        await saveSettingsImpl();
        [
          ['gemini-api-key', 'geminiApiKey'],
          ['openai-api-key', 'openaiApiKey'],
          ['claude-api-key', 'claudeApiKey'],
        ].forEach(([inputId, stateKey]) => {
          const input = document.getElementById(inputId);
          if (input) input.value = '';
          updateCredentialUi(stateKey);
        });
        showToast(t("toast.ai_settings_applied"), "success");
      });
    }

    // Handle Hosts section in integrations tab
    const btnAddHost = document.getElementById('btn-settings-add-host');
    if (btnAddHost) {
      btnAddHost.addEventListener('click', () => {
        closeSettings();
        showAddConnectionDialog();
      });
    }
    const hostsList = document.getElementById('settings-hosts-list');
    if (hostsList) {
      hostsList.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.settings-host-edit');
        if (editBtn) {
          closeSettings();
          showEditConnectionDialog(editBtn.dataset.id);
          return;
        }
        const delBtn = e.target.closest('.settings-host-delete');
        if (delBtn) {
          const confirmed = await showConfirmDialog({ title: 'Remove host', message: 'Remove this host?', isDanger: true });
          if (confirmed) {
            await deleteConnection(delBtn.dataset.id);
          }
        }
      });
    }

    // Handle Manage Exclusions button
    const btnManageExclusions = document.getElementById("btn-manage-exclusions");
    if (btnManageExclusions) {
      btnManageExclusions.addEventListener("click", () => {
        closeSettings();
        eventBus.emit('ui:show-git-exclusions');
      });
    }

    // Handle Syntax Color Toggles (Checkbox)
    const colorToggles = modalBody.querySelectorAll(".syntax-color-toggle");
    colorToggles.forEach(toggle => {
        toggle.addEventListener("change", async (e) => {
            const key = e.target.dataset.key;
            const checked = e.target.checked;
            const input = modalBody.querySelector(`.syntax-color-input[data-key="${key}"]`);
            const labelSpan = e.target.nextElementSibling;

            if (checked) {
                // Enable: add to customColors with current color value
                state.customColors[key] = input.value;
                input.disabled = false;
                input.style.opacity = "1";
                input.style.cursor = "pointer";
                if (labelSpan) labelSpan.style.opacity = "1";
            } else {
                // Disable: remove from customColors
                delete state.customColors[key];
                input.disabled = true;
                input.style.opacity = "0.2";
                input.style.cursor = "default";
                if (labelSpan) labelSpan.style.opacity = "0.5";
            }

            await saveSettingsImpl();
            eventBus.emit('ui:refresh-editor');
        });
    });

    // Handle Syntax Color Inputs (Color Picker)
    const colorInputs = modalBody.querySelectorAll(".syntax-color-input");
    colorInputs.forEach(input => {
        input.addEventListener("change", async (e) => {
            const key = e.target.dataset.key;
            const value = e.target.value;

            // Only update if checkbox is enabled
            const toggle = modalBody.querySelector(`.syntax-color-toggle[data-key="${key}"]`);
            if (toggle && toggle.checked) {
                state.customColors[key] = value;
                await saveSettingsImpl();
                eventBus.emit('ui:refresh-editor');
            }
        });
    });

    // Handle Reset Colors button
    // Handle Syntax Theme selection
    const syntaxThemeBtns = modalBody.querySelectorAll(".syntax-theme-btn");
    syntaxThemeBtns.forEach(btn => {
      btn.addEventListener("click", async () => {
        const themeKey = btn.dataset.theme;
        state.syntaxTheme = themeKey;
        await saveSettingsImpl();

        // Apply immediately
        eventBus.emit('ui:refresh-editor');

        // Update button styles
        syntaxThemeBtns.forEach(b => {
          const isActive = b.dataset.theme === themeKey;
          b.classList.toggle("active", isActive);
          b.style.borderColor = isActive ? "var(--accent-color)" : "var(--border-color)";
          b.style.background = isActive ? "var(--bg-hover)" : "var(--bg-primary)";
        });

        // Show/hide custom colors section
        const customSection = document.getElementById("custom-colors-section");
        if (customSection) {
          customSection.style.display = themeKey === "custom" ? "block" : "none";
        }

        showToast(t('toast.syntax_theme_changed', { theme: SYNTAX_THEMES[themeKey].name }), "success");
      });
    });

    const btnResetColors = document.getElementById("btn-reset-colors");
    if (btnResetColors) {
        btnResetColors.addEventListener("click", async () => {
            state.customColors = {};
            await saveSettingsImpl();
            eventBus.emit('ui:refresh-editor');
            showToast(t("toast.colors_reset_to_defaults"), "success");

            // Re-render settings to update UI
            setTimeout(() => {
                closeSettings();
                showAppSettings();
            }, 300);
        });
    }

    const btnClearPwaToken = document.getElementById("btn-clear-pwa-token");
    if (btnClearPwaToken) {
      btnClearPwaToken.addEventListener("click", async () => {
        const confirmed = await showConfirmDialog({
          title: "Logout PWA Session",
          message: "Are you sure you want to logout? You will need to login again to use the standalone PWA."
        });

        if (confirmed) {
          if (window.pwaAuth) {
            await window.pwaAuth.logout();
          } else {
            // Fallback: clear all OAuth tokens
            localStorage.removeItem('blueprint_studio_access_token');
            localStorage.removeItem('blueprint_studio_refresh_token');
            localStorage.removeItem('blueprint_studio_token_expires_at');
          }
          showToast(t("toast.pwa_token_cleared"), "success");
          closeSettings();

          // If in standalone mode, reload to prompt for login
          if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
            window.location.reload();
          }
        }
      });
    }

    const btnClearCache = document.getElementById("btn-clear-frontend-cache");
    if (btnClearCache) {
      btnClearCache.addEventListener("click", async () => {
        btnClearCache.disabled = true;
        btnClearCache.textContent = t('settings.cache.clearing');
        try {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          window.location.reload(true);
        } catch (e) {
          console.error("Cache clear failed:", e);
          showToast(t('toast.cache_clear_failed', { error: e.message }), "error");
          btnClearCache.disabled = false;
          btnClearCache.textContent = t('settings.cache.clear_reload');
        }
      });
    }

    // Handle Reset Application button
    const btnResetApp = document.getElementById("btn-reset-app");
    if (btnResetApp) {
      btnResetApp.addEventListener("click", async () => {
        // Close settings modal first
        closeSettings();

        // Show confirmation dialog
        const confirmed = await showConfirmDialogWithItems(
            t('settings.reset.title'),
            t('settings.reset.confirm'),
            [
                t('settings.reset.clear_settings'),
                t('settings.reset.theme'),
                t('settings.reset.recent'),
                t('settings.reset.onboarding'),
                t('settings.reset.credentials'),
                t('settings.reset.repository')
            ],
            t('settings.reset.warning'),
            true
        );

        if (!confirmed) return;

        // Show advanced options
        const advancedModal = document.getElementById("modal");
        const advancedModalBody = document.getElementById("modal-body");
        const advancedModalTitle = document.getElementById("modal-title");

        advancedModalTitle.textContent = t('settings.reset.options');
        advancedModalBody.innerHTML = `
          <div style="padding: 16px 0;">
            <div style="margin-bottom: 16px;">
              <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" id="clear-credentials-check" style="margin-right: 8px;">
                <span>${t('settings.reset.credentials')}</span>
              </label>
            </div>
            <div style="margin-bottom: 16px;">
              <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" id="delete-repo-check" style="margin-right: 8px;">
                <span>${t('settings.reset.repository_folder')}</span>
              </label>
            </div>
            <div style="padding: 12px; background: var(--bg-tertiary); border-radius: 6px; font-size: 12px; color: var(--text-secondary);">
              <strong>${t('common.note')}:</strong> ${t('settings.reset.note')}
            </div>
          </div>
        `;

        const handleConfirm = async () => {
            const clearCredentials = document.getElementById("clear-credentials-check")?.checked;
            const deleteRepo = document.getElementById("delete-repo-check")?.checked;
            cleanup();
            await resetApplicationData({
              clearCredentials,
              deleteRepository: deleteRepo,
            }, 0, true);
        };

        // One-time listener for this specific modal instance
        const cleanup = () => {
            elements.modalConfirm.removeEventListener("click", handleConfirm);
            eventBus.emit('ui:modal-hide');
        };

        elements.modalConfirm.addEventListener("click", handleConfirm, { once: true });
      });
    }

    // Handle Polling Interval slider
    const pollingIntervalSlider = document.getElementById("polling-interval-slider");
    const pollingIntervalValue = document.getElementById("polling-interval-value");
    if (pollingIntervalSlider && pollingIntervalValue) {
      pollingIntervalSlider.addEventListener("input", (e) => {
        const seconds = (parseInt(e.target.value) / 1000).toFixed(0);
        pollingIntervalValue.textContent = t('settings.units.seconds_short', { count: seconds });
      });

      pollingIntervalSlider.addEventListener("change", async (e) => {
        state.pollingInterval = parseInt(e.target.value);
        await saveSettingsImpl();
        showToast(t('toast.polling_interval_set', { seconds: (state.pollingInterval / 1000).toFixed(0) }), "success");
      });
    }

    // Handle Remote Fetch Interval slider
    const remoteFetchIntervalSlider = document.getElementById("remote-fetch-interval-slider");
    const remoteFetchIntervalValue = document.getElementById("remote-fetch-interval-value");
    if (remoteFetchIntervalSlider && remoteFetchIntervalValue) {
      remoteFetchIntervalSlider.addEventListener("input", (e) => {
        const seconds = (parseInt(e.target.value) / 1000).toFixed(0);
        remoteFetchIntervalValue.textContent = t('settings.units.seconds_short', { count: seconds });
      });

      remoteFetchIntervalSlider.addEventListener("change", async (e) => {
        state.remoteFetchInterval = parseInt(e.target.value);
        await saveSettingsImpl();
        showToast(t('toast.remote_fetch_interval_set', { seconds: (state.remoteFetchInterval / 1000).toFixed(0) }), "success");
      });
    }

    // Handle File Cache Size slider
    const fileCacheSizeSlider = document.getElementById("file-cache-size-slider");
    const fileCacheSizeValue = document.getElementById("file-cache-size-value");
    if (fileCacheSizeSlider && fileCacheSizeValue) {
      fileCacheSizeSlider.addEventListener("input", (e) => {
        fileCacheSizeValue.textContent = t('settings.units.files', { count: e.target.value });
      });

      fileCacheSizeSlider.addEventListener("change", async (e) => {
        state.fileCacheSize = parseInt(e.target.value);
        await saveSettingsImpl();
        showToast(t("toast.cache_size_set", { size: state.fileCacheSize }), "success");
      });
    }

    // Handle Virtual Scrolling toggle
    const virtualScrollToggle = document.getElementById("virtual-scroll-toggle");
    if (virtualScrollToggle) {
      virtualScrollToggle.addEventListener("change", async (e) => {
        state.enableVirtualScroll = e.target.checked;
        await saveSettingsImpl();
        showToast(t(state.enableVirtualScroll ? "toast.virtual_scroll_enabled" : "toast.virtual_scroll_disabled"), "success");
      });
    }

    // Handle Split View toggle (Experimental)
    const splitViewToggle = document.getElementById("split-view-toggle");
    if (splitViewToggle) {
      splitViewToggle.addEventListener("change", async (e) => {
        state.enableSplitView = e.target.checked;
        await saveSettingsImpl();
        showToast(t(state.enableSplitView ? "toast.split_view_enabled" : "toast.split_view_disabled"), "success");

        // Update split view buttons visibility
        // This will be handled by the updateSplitViewButtons function in split-view.js
        const event = new CustomEvent('splitViewSettingChanged', {
          detail: { enabled: state.enableSplitView }
        });
        window.dispatchEvent(event);
      });
    }

    const dependencySatisfied = ({ dependsOn = [], dependencyMode = 'all' }) => {
      if (!dependsOn.length) return true;
      const values = dependsOn.map((id) => Boolean(modalBody.querySelector(`#${id}`)?.checked));
      return dependencyMode === 'any' ? values.some(Boolean) : values.every(Boolean);
    };

    const controlHasDefault = (control, metadata) => {
      if (control.type === 'checkbox') return control.checked === metadata.defaultValue;
      return String(control.value) === String(metadata.defaultValue);
    };

    const defaultLabel = (control, metadata) => {
      if (control.type === 'checkbox') {
        return metadata.defaultValue ? t('settings.meta.on') : t('settings.meta.off');
      }
      if (control.tagName === 'SELECT') {
        return [...control.options].find((option) => option.value === String(metadata.defaultValue))?.textContent?.trim()
          || String(metadata.defaultValue);
      }
      return `${metadata.defaultValue}${metadata.suffix || ''}`;
    };

    Object.entries(SETTINGS_CONTROL_METADATA).forEach(([controlId, metadata]) => {
      const control = modalBody.querySelector(`#${controlId}`);
      const row = control?.closest('.git-settings-section > div');
      if (!control || !row || row.querySelector(`.setting-meta[data-control-id="${controlId}"]`)) return;
      row.classList.add('setting-row-decorated');
      const meta = document.createElement('div');
      meta.className = 'setting-meta';
      meta.dataset.controlId = controlId;
      meta.innerHTML = `
        <span class="setting-meta-default">${t('settings.meta.default', { value: escapeHtml(defaultLabel(control, metadata)) })}</span>
        <span class="setting-meta-apply">${t(metadata.apply === 'reload' ? 'settings.meta.next_reload' : 'settings.meta.immediate')}</span>
        <span class="setting-disabled-reason" id="${controlId}-disabled-reason" hidden></span>
        <button type="button" class="setting-reset ui-button ui-icon-button" title="${t('settings.meta.reset')}" aria-label="${t('settings.meta.reset')}">
          <span class="ui-icon material-icons" aria-hidden="true">restart_alt</span>
        </button>
      `;
      row.appendChild(meta);
      meta.querySelector('.setting-reset').addEventListener('click', () => {
        if (control.type === 'checkbox') control.checked = metadata.defaultValue;
        else control.value = String(metadata.defaultValue);
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        control.focus({ preventScroll: true });
      });
    });

    SETTINGS_DEPENDENCY_GROUPS.forEach((group) => {
      const container = modalBody.querySelector(group.selector);
      if (!container || container.querySelector(':scope > .setting-dependency-notice')) return;
      const notice = document.createElement('div');
      notice.className = 'setting-dependency-notice';
      notice.innerHTML = `<span class="ui-icon material-icons" aria-hidden="true">lock</span><span>${t(group.reasonKey)}</span>`;
      container.prepend(notice);
    });

    const updateSettingsMetadata = () => {
      Object.entries(SETTINGS_CONTROL_METADATA).forEach(([controlId, metadata]) => {
        const control = modalBody.querySelector(`#${controlId}`);
        const meta = modalBody.querySelector(`.setting-meta[data-control-id="${controlId}"]`);
        if (!control || !meta) return;
        const enabled = dependencySatisfied(metadata);
        const reason = meta.querySelector('.setting-disabled-reason');
        control.disabled = !enabled;
        control.toggleAttribute('aria-describedby', !enabled);
        if (!enabled) control.setAttribute('aria-describedby', `${controlId}-disabled-reason`);
        reason.hidden = enabled;
        reason.textContent = enabled ? '' : t('settings.meta.unavailable', { reason: t(metadata.reasonKey) });
        meta.closest('.setting-row-decorated')?.classList.toggle('setting-dependency-disabled', !enabled);
        const reset = meta.querySelector('.setting-reset');
        reset.disabled = !enabled || controlHasDefault(control, metadata);
      });

      SETTINGS_DEPENDENCY_GROUPS.forEach((group) => {
        const container = modalBody.querySelector(group.selector);
        if (!container) return;
        const enabled = dependencySatisfied(group);
        container.classList.toggle('setting-dependency-disabled', !enabled);
        const notice = container.querySelector(':scope > .setting-dependency-notice');
        if (notice) notice.hidden = enabled;
        container.querySelectorAll('input, select, button').forEach((control) => {
          if (!control.closest('.setting-meta')) control.disabled = !enabled;
        });
      });
    };

    modalBody.addEventListener('input', updateSettingsMetadata);
    modalBody.addEventListener('change', updateSettingsMetadata);
    updateSettingsMetadata();
  }

// Helper function for confirmation dialogs with list items (local variant)
async function showConfirmDialogWithItems(title, message, items, note, showCancel = true) {
  return new Promise((resolve) => {
    const modal = document.getElementById("modal");
    const modalOverlay = document.getElementById("modal-overlay");
    const modalTitle = document.getElementById("modal-title");
    const modalBody = document.getElementById("modal-body");

    modalTitle.textContent = title;
    modalBody.innerHTML = `
      <div style="padding: 16px 0;">
        <p style="margin-bottom: 12px; font-size: 14px;">${message}</p>
        ${items ? `
          <ul style="margin: 12px 0; padding-left: 20px;">
            ${items.map(item => `<li style="margin: 6px 0; font-size: 13px;">${item}</li>`).join('')}
          </ul>
        ` : ''}
        ${note ? `
          <div style="padding: 12px; background: var(--bg-tertiary); border-radius: 6px; font-size: 12px; color: var(--text-secondary); margin-top: 12px;">
            ${note}
          </div>
        ` : ''}
      </div>
    `;

    activateSharedModal({ initialFocus: elements.modalCancel });

    const handleConfirm = () => {
      deactivateSharedModal();
      elements.modalConfirm.removeEventListener("click", handleConfirm);
      if (showCancel) {
        elements.modalCancel.removeEventListener("click", handleCancel);
      }
      resolve(true);
    };

    const handleCancel = () => {
      deactivateSharedModal();
      elements.modalConfirm.removeEventListener("click", handleConfirm);
      if (showCancel) {
        elements.modalCancel.removeEventListener("click", handleCancel);
      }
      resolve(false);
    };

    elements.modalConfirm.addEventListener("click", handleConfirm);
    if (showCancel) {
      elements.modalCancel.addEventListener("click", handleCancel);
    }
  });
}
