/** GIT-ACTION-CONFIRMATION.JS | Purpose: Describes Git action scope and consequences consistently. */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function row(label, value) {
  return `<div class="git-action-confirmation__row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function fileTarget(files) {
  const paths = Array.from(new Set((files || []).filter(Boolean)));
  const visible = paths.slice(0, 4).map((file) => `<code>${escapeHtml(file)}</code>`).join(', ');
  const remaining = paths.length > 4 ? ` and ${paths.length - 4} more` : '';
  return `${paths.length} working ${paths.length === 1 ? 'file' : 'files'}${visible ? `: ${visible}${remaining}` : ''}`;
}

function confirmation({ title, confirmText, scope, target, consequence, recovery, isDanger = true }) {
  return {
    title,
    confirmText,
    cancelText: 'Cancel',
    isDanger,
    message: `<div class="git-action-confirmation">
      ${row('Scope', escapeHtml(scope))}
      ${row('Target', target)}
      ${row('Consequence', escapeHtml(consequence))}
      ${row('Recovery', escapeHtml(recovery))}
    </div>`,
  };
}

export function getGitActionConfirmation(kind, context = {}) {
  const provider = context.provider || 'remote';
  const branch = context.branch || 'current branch';
  const currentBranch = context.currentBranch || 'current branch';
  const defaultBranch = context.defaultBranch || 'main';

  switch (kind) {
    case 'discard':
      return confirmation({
        title: 'Discard Working Changes?',
        confirmText: 'Discard Changes',
        scope: 'Local working tree only',
        target: fileTarget(context.files),
        consequence: 'Replaces the selected unstaged content with the last committed version.',
        recovery: 'Not recoverable by Git unless the content exists elsewhere.',
      });
    case 'hard-reset':
      return confirmation({
        title: `Reset Local Branch from ${provider}?`,
        confirmText: 'Reset Local Branch',
        scope: 'Local repository and working tree',
        target: `<code>${escapeHtml(currentBranch)}</code> from ${escapeHtml(provider)}`,
        consequence: 'Moves the local branch to the remote version and removes local commits and file changes.',
        recovery: 'Not recoverable in Blueprint Studio after the reset.',
      });
    case 'force-push':
      return confirmation({
        title: `Overwrite ${provider} Branch?`,
        confirmText: 'Force Push',
        scope: `${provider} remote history`,
        target: `<code>${escapeHtml(currentBranch)}</code> on ${escapeHtml(provider)}`,
        consequence: 'Replaces remote branch history with the local branch and can disrupt collaborators.',
        recovery: 'Requires a surviving commit reference or another clone.',
      });
    case 'clean-locks':
      return confirmation({
        title: 'Clean Git Recovery State?',
        confirmText: 'Clean Recovery State',
        scope: 'Local Git metadata only',
        target: `<code>${escapeHtml(currentBranch)}</code> lock files and in-progress operation state`,
        consequence: 'Removes stale locks plus merge, rebase, cherry-pick, and revert state. Do not continue if another Git process is active.',
        recovery: 'Removed operation state cannot be restored by Blueprint Studio.',
      });
    case 'repair-index':
      return confirmation({
        title: 'Rebuild Git Index?',
        confirmText: 'Repair Index',
        scope: 'Local Git metadata and working tree status',
        target: `<code>${escapeHtml(currentBranch)}</code> index`,
        consequence: 'Deletes the current index and rebuilds it from Git. Working file content is retained, but staged selections are cleared.',
        recovery: 'Files can be staged again after repair; the previous staged selection is not retained.',
      });
    case 'delete-local-branch':
      return confirmation({
        title: 'Delete Local Branch?',
        confirmText: 'Delete Local Branch',
        scope: 'Local repository only',
        target: `<code>${escapeHtml(branch)}</code>`,
        consequence: 'Removes the local branch reference. Its remote branch is unchanged.',
        recovery: 'Unmerged commits may become difficult to recover.',
      });
    case 'force-delete-local-branch':
      return confirmation({
        title: 'Force Delete Unmerged Branch?',
        confirmText: 'Force Delete Branch',
        scope: 'Local repository only',
        target: `<code>${escapeHtml(branch)}</code>`,
        consequence: 'Removes the branch even though it contains commits not merged into the current branch.',
        recovery: 'Those commits may become difficult to recover.',
      });
    case 'delete-remote-branch':
      return confirmation({
        title: `Delete ${provider} Branch?`,
        confirmText: 'Delete Remote Branch',
        scope: `${provider} remote only`,
        target: `<code>${escapeHtml(branch)}</code> on ${escapeHtml(provider)}`,
        consequence: 'Removes the remote branch for every collaborator. The local branch is unchanged.',
        recovery: 'Republishing requires a local branch or another surviving commit reference.',
      });
    case 'change-default-and-delete':
      return confirmation({
        title: `Change ${provider} Default and Delete Branch?`,
        confirmText: 'Change Default and Delete',
        scope: `${provider} repository settings and remote branches`,
        target: `default <code>${escapeHtml(branch)}</code> to <code>${escapeHtml(defaultBranch)}</code>, then delete <code>${escapeHtml(branch)}</code>`,
        consequence: 'Changes the repository default branch, then removes the previous default branch for every collaborator.',
        recovery: 'The default can be changed again; republishing the deleted branch requires a surviving commit reference.',
      });
    case 'repair-branch-mismatch':
      return confirmation({
        title: context.resumeStep > 0 ? 'Resume Branch Repair?' : 'Repair Branch Mismatch?',
        confirmText: context.resumeStep > 0 ? 'Resume Repair' : 'Repair Branches',
        scope: 'Local Git repository and GitHub history',
        target: '<code>master</code> to <code>main</code>, then merge <code>origin/main</code>',
        consequence: context.resumeStep > 0
          ? `Resumes at step ${context.resumeStep + 1} of 3. Earlier completed steps remain applied.`
          : 'Clears an in-progress merge or rebase, renames the local branch, then merges the remote history. The merge may create conflicts.',
        recovery: 'Retry resumes at the first unfinished step. Resolve merge conflicts in Source Control or abort the merge if necessary.',
        isDanger: false,
      });
    case 'merge':
      return confirmation({
        title: 'Merge Branch into Current Branch?',
        confirmText: 'Merge into Current Branch',
        scope: 'Local current branch',
        target: `<code>${escapeHtml(branch)}</code> into <code>${escapeHtml(currentBranch)}</code>`,
        consequence: 'Adds the source branch changes to the current branch and may create conflicts.',
        recovery: 'The source branch is retained; a completed merge can be reverted with a later commit.',
        isDanger: false,
      });
    default:
      throw new Error(`Unsupported Git confirmation kind: ${kind}`);
  }
}
