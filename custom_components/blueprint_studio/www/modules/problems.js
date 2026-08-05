/** PROBLEMS.JS | Validation findings, editor markers, and focused navigation. */

import { state } from './state.js';
import { eventBus } from './event-bus.js';

let markerHandles = [];
let markedLines = [];
let findingsState = [];
let visibleLimit = 100;
let dismissedForCurrentValidation = false;

function problemElements() {
  return {
    panel: document.getElementById('problems-panel'),
    list: document.getElementById('problems-list'),
    summary: document.getElementById('problems-summary'),
    status: document.getElementById('problems-status'),
    announcer: document.getElementById('validation-announcer'),
    search: document.getElementById('problems-search'),
    trigger: document.getElementById('btn-problems'),
  };
}

function classifyFinding(finding, fallbackSeverity) {
  const description = `${finding.type || ''} ${finding.message || ''}`.toLowerCase();
  if (description.includes('deprecat') || description.includes('legacy')) return 'deprecation';
  if (description.includes('entity') || description.includes('instance') || description.includes('service')) return 'instance';
  if (fallbackSeverity === 'error') return 'error';
  return 'recommendation';
}

function validationAuthority(fileName) {
  const extension = fileName.split('.').pop().toLowerCase();
  if (extension === 'js') return 'Syntax';
  if (extension === 'yaml' || extension === 'yml' || extension === 'json' || extension === 'py') return 'Syntax and schema';
  return 'Syntax';
}

function clearEditorMarkers() {
  markerHandles.forEach(marker => marker.clear());
  markedLines.forEach(({ editor, line, className }) => editor.removeLineClass(line, 'wrap', className));
  markerHandles = [];
  markedLines = [];
}

function markFindings(findings, editor = state.editor) {
  clearEditorMarkers();
  if (!editor) return;
  findings.forEach(finding => {
    if (!Number.isInteger(finding.line) || finding.line < 1) return;
    const line = finding.line - 1;
    const className = `problem-line--${finding.severity}`;
    editor.addLineClass(line, 'wrap', className);
    markedLines.push({ editor, line, className });
    const start = { line, ch: Math.max(0, (finding.column || 1) - 1) };
    const end = { line, ch: Math.max(start.ch + 1, editor.getLine(line)?.length || 1) };
    markerHandles.push(editor.markText(start, end, {
      className: `problem-marker problem-marker--${finding.severity}`,
      title: finding.message,
    }));
  });
}

function navigateToFinding(finding) {
  const editor = state.editor;
  if (!editor || !Number.isInteger(finding.line)) return;
  const position = { line: Math.max(0, finding.line - 1), ch: Math.max(0, (finding.column || 1) - 1) };
  editor.setCursor(position);
  editor.scrollIntoView({ from: position, to: position }, 80);
  editor.focus();
}

function quickFixFor(finding) {
  if (!finding.original || !finding.line) return null;
  const replacements = {
    legacy_syntax: [['service:', 'action:']],
    singular_key: [['trigger:', 'triggers:'], ['condition:', 'conditions:'], ['action:', 'actions:']],
    deprecated_syntax: [['data_template:', 'data:'], ['service_template:', 'action:']],
  };
  const match = (replacements[finding.type] || []).find(([from]) => finding.original.includes(from));
  return match ? finding.original.replace(match[0], match[1]) : null;
}

function recoveryGuidance(finding) {
  if (finding.solution) return finding.solution;
  if (finding.category === 'instance') return 'Check the target or action against the connected Home Assistant instance, then validate again.';
  if (finding.category === 'deprecation') return 'Review the current Home Assistant syntax and replace the deprecated form.';
  if (finding.category === 'error') return 'Correct the highlighted syntax or schema value, then validate again.';
  return 'Review this recommendation and update the file if it applies.';
}

function addQuickFix(item, finding) {
  const replacement = quickFixFor(finding);
  if (!replacement) return;
  const review = document.createElement('button');
  review.type = 'button';
  review.className = 'problem-quick-fix';
  review.textContent = 'Review fix';
  review.addEventListener('click', () => {
    const editor = state.editor;
    if (!editor) return;
    const line = finding.line - 1;
    const current = editor.getLine(line) || '';
    const indent = current.match(/^\s*/)[0];
    const preview = document.createElement('div');
    preview.className = 'problem-fix-preview';
    const before = document.createElement('code');
    before.textContent = current;
    const after = document.createElement('code');
    after.textContent = `${indent}${replacement}`;
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'problem-quick-fix';
    apply.textContent = 'Apply fix';
    apply.addEventListener('click', () => {
      if (editor.getLine(line)?.trim() !== finding.original.trim()) {
        setStatus('stale', 'Fix preview is stale; validate again');
        return;
      }
      editor.replaceRange(`${indent}${replacement}`, { line, ch: 0 }, { line, ch: current.length }, 'problems-quick-fix');
      setStatus('stale', 'Quick fix applied; Undo is available');
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'problem-quick-fix';
      undo.textContent = 'Undo fix';
      undo.addEventListener('click', () => { editor.undo(); setStatus('stale', 'Quick fix undone; validate again'); });
      apply.replaceWith(undo);
    });
    preview.append(before, after, apply);
    review.replaceWith(preview);
  });
  item.append(review);
}

function renderFindings(findings) {
  const { list, summary, search } = problemElements();
  if (!list || !summary) return;
  const query = search?.value.trim().toLowerCase() || '';
  const matches = findings.filter(finding => !query || `${finding.message} ${finding.type} ${finding.solution || ''}`.toLowerCase().includes(query));
  const visible = matches.slice(0, visibleLimit);
  const errors = findings.filter(finding => finding.severity === 'error').length;
  const warnings = findings.length - errors;
  summary.textContent = findings.length ? `${errors} error${errors === 1 ? '' : 's'}, ${warnings} advisory finding${warnings === 1 ? '' : 's'}` : 'No problems found';
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'problems-empty';
    empty.textContent = findings.length ? 'No problems match this filter.' : 'Validation has not found any problems.';
    list.append(empty);
    return;
  }
  const groups = new Map();
  visible.forEach(finding => {
    const entries = groups.get(finding.path) || [];
    entries.push(finding);
    groups.set(finding.path, entries);
  });
  groups.forEach((entries, path) => {
    const group = document.createElement('section');
    group.className = 'problems-file-group';
    const heading = document.createElement('h3');
    heading.textContent = path;
    group.append(heading);
    entries.forEach(finding => {
      const item = document.createElement('div');
      item.className = `problem-item problem-item--${finding.severity}`;
      const navigate = document.createElement('button');
      navigate.type = 'button';
      navigate.className = 'problem-navigation';
      navigate.setAttribute('aria-label', `Go to ${finding.path}, line ${finding.line || 1}: ${finding.message}`);
      const icon = document.createElement('span');
      icon.className = 'ui-icon material-icons';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = finding.severity === 'error' ? 'error_outline' : 'info_outline';
      const copy = document.createElement('span');
      copy.className = 'problem-item-copy';
      const message = document.createElement('strong');
      message.textContent = finding.message;
      const metadata = document.createElement('small');
      metadata.textContent = `${finding.category} | ${finding.authority}${finding.line ? ` | Line ${finding.line}${finding.column ? `, column ${finding.column}` : ''}` : ''}`;
      copy.append(message, metadata);
      const solution = document.createElement('em');
      solution.textContent = recoveryGuidance(finding);
      copy.append(solution);
      navigate.append(icon, copy);
      navigate.addEventListener('click', () => navigateToFinding(finding));
      item.append(navigate);
      addQuickFix(item, finding);
      group.append(item);
    });
    list.append(group);
  });
  if (matches.length > visible.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'problems-show-more';
    more.textContent = `Show ${Math.min(100, matches.length - visible.length)} more of ${matches.length}`;
    more.addEventListener('click', () => { visibleLimit += 100; renderFindings(findingsState); });
    list.append(more);
  }
}

function setStatus(status, message) {
  const { panel, status: statusNode, announcer, trigger } = problemElements();
  if (panel) panel.dataset.status = status;
  if (statusNode) statusNode.textContent = message;
  if (announcer) announcer.textContent = message;
  if (trigger) trigger.setAttribute('aria-label', `Problems: ${message}`);
}

export function publishValidationResult({ fileName, result, editor }) {
  const findings = [
    ...(result.errors || []).map(item => ({ ...item, severity: 'error' })),
    ...(result.warnings || []).map(item => ({ ...item, severity: 'warning' })),
  ].map(item => ({
    ...item,
    path: fileName,
    category: classifyFinding(item, item.severity),
    authority: validationAuthority(fileName),
  }));
  findingsState = findings;
  visibleLimit = 100;
  markFindings(findings, editor);
  renderFindings(findings);
  const unavailable = !result.valid && !findings.length && Boolean(result.error);
  const status = unavailable ? 'unavailable' : !result.valid ? 'failed' : findings.length ? 'warnings' : 'passed';
  const count = `${findings.length} finding${findings.length === 1 ? '' : 's'}`;
  setStatus(status, status === 'unavailable' ? 'Validation unavailable' : status === 'failed' ? `Validation failed, ${count}` : status === 'warnings' ? `Validation passed with ${count}` : 'Validation passed, no findings');
  if (findings.length && !dismissedForCurrentValidation) {
    showProblems();
    // Validation also updates lint markers, operation results, and toolbar
    // state. Reassert the requested panel after that render turn so none of
    // those updates can leave the findings available but the panel hidden.
    requestAnimationFrame(() => {
      if (findingsState.length && !dismissedForCurrentValidation) showProblems();
    });
  }
  return findings;
}

export function setValidationRunning(fileName) {
  dismissedForCurrentValidation = false;
  clearEditorMarkers();
  findingsState = [];
  visibleLimit = 100;
  renderFindings([]);
  setStatus('running', `Validating ${fileName}`);
}

export function showProblems() {
  const { panel, trigger } = problemElements();
  if (!panel) return;
  dismissedForCurrentValidation = false;
  panel.hidden = false;
  trigger?.setAttribute('aria-expanded', 'true');
}

export function hideProblems() {
  const { panel, trigger } = problemElements();
  if (!panel) return;
  dismissedForCurrentValidation = true;
  panel.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
}

export function initProblems() {
  const { panel, search, trigger } = problemElements();
  if (!panel || panel.dataset.initialized) return;
  panel.dataset.initialized = 'true';
  document.getElementById('btn-close-problems')?.addEventListener('click', hideProblems);
  trigger?.addEventListener('click', () => panel.hidden ? showProblems() : hideProblems());
  search?.addEventListener('input', () => { visibleLimit = 100; renderFindings(findingsState); });
  eventBus.on('validation:stale', ({ tab }) => {
    if (findingsState.length && tab?.path === findingsState[0]?.path) setStatus('stale', 'Validation is stale; run validation again');
  });
}
