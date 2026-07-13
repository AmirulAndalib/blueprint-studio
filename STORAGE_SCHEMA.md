# Storage Schema and Migration Inventory

This document records persistence behavior before backend modernization. Future
migrations must preserve unknown fields, workspace state, and the original data
when migration or saving fails.

## Home Assistant Store

- Store key: `blueprint_studio.credentials`
- Store version: `2` (version `1` is migrated automatically and atomically)
- Host file: `.storage/blueprint_studio.credentials`
- Root data fields: `settings`, optional `github_credentials`, optional
  `gitea_credentials`, and legacy `credentials`.

Home Assistant wraps the integration data in its standard object containing
`version`, `minor_version`, `key`, and `data`.

### Credential Shapes

Current provider credentials use:

```json
{
  "github_credentials": {
    "username": "string",
    "token": "base64-encoded string"
  },
  "gitea_credentials": {
    "username": "string",
    "token": "base64-encoded string"
  }
}
```

Base64 is encoding, not encryption. Settings may also contain AI API keys and
SSH passwords/private keys as plain JSON values. Phase 3 and Phase 6 must avoid
logging these values and should separate secrets from ordinary workspace data
without breaking existing saved credentials.

## Settings Shape

The `settings` object is replaced as a unit by `save_settings`. It currently
contains these groups:

- Sync metadata: `_clientId`, `_savedAt`.
- Workspace: `rememberWorkspace`, `openTabs`, `activeTabPath`, `splitView`,
  `currentNavigationPath`, `navigationHistory`, `expandedFolders`,
  `activeSidebarView`.
- Tab records: `path`, `modified`, `cursor`, `scroll`, and, for modified tabs,
  `content` and `originalContent`.
- Editor/UI: `theme`, `themePreset`, `accentColor`, `language`, `customColors`,
  `syntaxTheme`, `fontSize`, `fontFamily`, `tabSize`, `indentWithTabs`,
  `sidebarWidth`, `tabPosition`, `wordWrap`, `showLineNumbers`, `showMinimap`,
  `autocompleteEnabled`, `showWhitespace`, `autoSave`, `autoSaveDelay`,
  `fileTreeCompact`, `fileTreeShowIcons`, `fileTreeFilter`,
  `treeCollapsableMode`, `recentFilesLimit`, `breadcrumbStyle`, `showHidden`,
  `showRecentFiles`, `favoriteFiles`, `recentFiles`, `terminalVisible`,
  `autoHideSidebar`, `fileTreeCollapsed`, and panel collapsed/size fields.
- Integrations: `gitConfig`, Git/Gitea collapsed groups and enable flags,
  `sftpIntegrationEnabled`, `terminalIntegrationEnabled`, `sshHosts`,
  `defaultSshHost`, SFTP connection/path/expanded-folder state.
- AI: enable/type/provider/model fields, provider URLs, API keys,
  `hassAgentId`, `aiChatHistory`, and `aiSidebarVisible`.
- Features/performance: `enableSplitView`, `onTabMode`, preview/form state,
  `pollingInterval`, `remoteFetchInterval`, `fileCacheSize`, and
  `enableVirtualScroll`.

The disposable Home Assistant `2026.6.1` instance was inspected with secret
values omitted. Its deployed store is version 1 and currently has only the
`settings` root field, including `openTabs`, `activeTabPath`, navigation state,
split-view state, and `sshHosts`.

## Browser Storage

Primary local storage:

- `blueprint_studio_settings`: mirror/fallback for the server settings object.
- `blueprint_studio_settings_client_id`: device-scoped recovery identifier.
- `onboardingCompleted`, `gitIntegrationEnabled`,
  `giteaIntegrationEnabled`: legacy settings keys.
- `blueprint_studio_active_sftp_conn`, `blueprint_studio_active_sftp_path`:
  legacy SFTP navigation state.
- `giteaServerUrl`, `githubOAuthClientId`: provider UI values.
- `bps_ai_diff_history`: at most the configured recent AI diff records.
- `bp_fab_pos`: floating action-button position.
- `blueprint_studio_pending_ai_edit`: one-time pending AI edit handoff.

Standalone PWA authentication also uses `blueprint_studio_access_token`,
`blueprint_studio_refresh_token`, and `blueprint_studio_token_expires_at`.
These auth values are session credentials, not workspace migration data.
`sftpWarningShown` is session-storage-only UI state.

## Existing Migration History

1. Backend legacy credentials: root `username` and `token` are moved into
   `credentials`; `settings` is retained. This is inline setup logic and does
   not increment `STORAGE_VERSION`.
2. Frontend local-to-server migration: when server settings are empty, the
   `blueprint_studio_settings` object and legacy onboarding/Git flags are saved
   to the Home Assistant store.
3. Short crash recovery: a newer local settings copy is restored only for the
   same `_clientId` and within two minutes.
4. SSH/SFTP host unification: `sftpConnections` entries are merged into
   `sshHosts`; missing IDs and authentication fields receive defaults.
5. AI provider migration: legacy `aiProvider` maps into `aiType` and
   `cloudProvider`; the legacy field remains written for compatibility.

Version 2 registers a Home Assistant `Store` migration callback. The migration
copies and validates version-1 data, preserves unknown root and settings fields,
moves legacy root `username` and `token` fields without rebuilding the object,
and records `schema_version: 2`. Home Assistant saves the migrated object only
after the callback succeeds, leaving the original store untouched on failure.

## Preservation Requirements

- Copy input before migration and save only after validation succeeds.
- Preserve unknown root and settings fields.
- Never replace the original store after a failed migration.
- Preserve tab order, active tab, cursor/scroll positions, split panes,
  navigation state, hosts, credentials, and all unsaved buffer content.
- Persist modified empty buffers; the current truthy-content check does not.
- Do not interpret active terminals or in-progress transfers as persisted
  workspace state.
- Keep local recovery compatible until the server migration is confirmed.
