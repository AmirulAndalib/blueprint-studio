import json
import pathlib
import re
import shutil
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
PANEL = (
    ROOT
    / "custom_components"
    / "blueprint_studio"
    / "www"
    / "panels"
    / "panel_custom.html"
)
UI_MODULE = (
    ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "ui.js"
)
DIALOG_MANAGER = (
    ROOT
    / "custom_components"
    / "blueprint_studio"
    / "www"
    / "modules"
    / "dialog-manager.js"
)
FEEDBACK_SERVICE = (
    ROOT
    / "custom_components"
    / "blueprint_studio"
    / "www"
    / "modules"
    / "feedback-service.js"
)
COMPONENT_SHOWCASE = (
    ROOT / "custom_components" / "blueprint_studio" / "www" / "component-showcase.html"
)
COMPONENT_SHOWCASE_MODULE = (
    ROOT
    / "custom_components"
    / "blueprint_studio"
    / "www"
    / "modules"
    / "component-showcase.js"
)
COMPONENT_SHOWCASE_STYLES = (
    ROOT
    / "custom_components"
    / "blueprint_studio"
    / "www"
    / "styles"
    / "component-showcase.css"
)
TRANSLATIONS_MODULE = (
    ROOT
    / "custom_components"
    / "blueprint_studio"
    / "www"
    / "modules"
    / "translations.js"
)
PARITY_MATRIX = ROOT / "FRONTEND_FUNCTIONAL_PARITY.md"
MODAL_INVENTORY = ROOT / "FRONTEND_MODAL_INVENTORY.md"
STYLE_MODULES = (
    ROOT / "custom_components" / "blueprint_studio" / "www" / "styles" / "modules"
)
PRIMITIVES = STYLE_MODULES / "primitives.css"
GIT_STYLES = STYLE_MODULES / "git.css"
UI_COMPONENTS = STYLE_MODULES / "ui-components.css"
WELCOME_STYLES = STYLE_MODULES / "welcome.css"
AI_STYLES = STYLE_MODULES / "ai.css"
PROBLEMS_MODULE = (
    ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "problems.js"
)
COMPLETION_DETAILS_MODULE = (
    ROOT
    / "custom_components"
    / "blueprint_studio"
    / "www"
    / "modules"
    / "completion-details.js"
)


class FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.panel = PANEL.read_text(encoding="utf-8")
        cls.ui_module = UI_MODULE.read_text(encoding="utf-8")
        cls.dialog_manager = DIALOG_MANAGER.read_text(encoding="utf-8")
        cls.feedback_service = FEEDBACK_SERVICE.read_text(encoding="utf-8")
        cls.component_showcase = COMPONENT_SHOWCASE.read_text(encoding="utf-8")
        cls.component_showcase_module = COMPONENT_SHOWCASE_MODULE.read_text(
            encoding="utf-8"
        )
        cls.component_showcase_styles = COMPONENT_SHOWCASE_STYLES.read_text(
            encoding="utf-8"
        )
        cls.parity_matrix = PARITY_MATRIX.read_text(encoding="utf-8")
        cls.modal_inventory = MODAL_INVENTORY.read_text(encoding="utf-8")

    def test_shared_modal_has_accessible_dialog_contract(self):
        modal = re.search(
            r'<div class="[^"]*\bmodal\b[^"]*" id="modal"(?P<attrs>[^>]*)>', self.panel
        )
        self.assertIsNotNone(modal)
        attrs = modal.group("attrs")
        self.assertIn('role="dialog"', attrs)
        self.assertIn('aria-modal="true"', attrs)
        self.assertIn('aria-labelledby="modal-title"', attrs)
        self.assertIn('aria-describedby="modal-hint"', attrs)

        close = re.search(
            r'<button class="modal-close" id="modal-close"(?P<attrs>[^>]*)>', self.panel
        )
        self.assertIsNotNone(close)
        self.assertIn('aria-label="Close dialog"', close.group("attrs"))

    def test_problems_panel_uses_safe_findings_and_editor_navigation(self):
        problems = PROBLEMS_MODULE.read_text(encoding="utf-8")
        editor_styles = (STYLE_MODULES / "editor.css").read_text(encoding="utf-8")
        ui_coordinator = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "UICoordinator.js"
        ).read_text(encoding="utf-8")

        self.assertRegex(
            self.panel,
            r'<button[^>]*id="btn-problems"[^>]*aria-controls="problems-panel"[^>]*aria-expanded="false"',
        )
        self.assertIn('id="problems-panel"', self.panel)
        self.assertIn('id="problems-search"', self.panel)
        self.assertIn('id="problems-list"', self.panel)
        self.assertRegex(
            self.panel,
            r'id="validation-announcer"[^>]*role="status"[^>]*aria-live="polite"',
        )
        self.assertIn("publishValidationResult", problems)
        self.assertIn("editor.markText", problems)
        self.assertIn("editor.setCursor", problems)
        self.assertIn("editor.scrollIntoView", problems)
        self.assertIn("problem-fix-preview", problems)
        self.assertIn("Apply fix", problems)
        self.assertIn("Undo fix", problems)
        self.assertIn("Validation is stale", problems)
        self.assertIn("Validation unavailable", problems)
        self.assertIn("Validation passed, no findings", problems)
        self.assertIn("announcer.textContent = message", problems)
        self.assertIn("problems-show-more", problems)
        self.assertIn("recoveryGuidance", problems)
        self.assertIn("problem-navigation", problems)
        self.assertIn("requestAnimationFrame(() =>", problems)
        self.assertIn("let dismissedForCurrentValidation = false;", problems)
        self.assertIn("findings.length && !dismissedForCurrentValidation", problems)
        self.assertIn("findingsState.length && !dismissedForCurrentValidation", problems)
        self.assertIn("dismissedForCurrentValidation = true;", problems)
        self.assertNotIn("toast.file_is_valid", ui_coordinator)
        self.assertNotRegex(
            problems,
            r"createElement\(['\"]button['\"]\)[\s\S]{0,100}className = `problem-item",
        )
        self.assertNotIn("innerHTML", problems)
        for selector in (".problems-panel", ".problem-item", ".problem-marker--error"):
            self.assertIn(selector, editor_styles)

    def test_service_worker_updates_do_not_reload_over_unsaved_work(self):
        coordinator = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "index.js"
        ).read_text(encoding="utf-8")

        for contract in (
            "const canReloadForUpdate = () =>",
            "Array.isArray(tabs)",
            "const scheduleUpdateReload = (delay, version = '') =>",
            "if (!canReloadForUpdate())",
            "window.__blueprintStudioUpdateReload = true;",
        ):
            self.assertIn(contract, self.panel)
        self.assertEqual(self.panel.count("window.location.reload();"), 1)
        self.assertNotIn("beforeinstallprompt", self.panel)
        self.assertNotIn("deferredPrompt", self.panel)
        self.assertIn(
            "if (window.__blueprintStudioUpdateReload) return;", coordinator
        )

    def test_completion_details_are_stable_and_contextual(self):
        details = COMPLETION_DETAILS_MODULE.read_text(encoding="utf-8")
        editor = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "editor.js"
        ).read_text(encoding="utf-8")

        self.assertIn('id="completion-details"', self.panel)
        self.assertIn('id="completion-details-title"', self.panel)
        self.assertIn('id="completion-details-body"', self.panel)
        self.assertIn("getYamlContext", details)
        self.assertIn("Installed action:", details)
        self.assertIn("Required field", details)
        self.assertIn("Search ${target.label.toLowerCase()} targets", details)
        self.assertIn("SELECTOR_TARGETS", details)
        self.assertIn("RESULT_LIMIT = 50", details)
        self.assertIn("Example: ", details)
        self.assertIn("editor.replaceRange", details)
        self.assertIn("updateCompletionDetails(editor)", editor)

    def test_standard_modal_close_icons_use_shared_wrapper(self):
        styles = UI_COMPONENTS.read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.modal-close-icon\s*\{[^}]*font-size:\s*16px;[^}]*height:\s*16px;[^}]*width:\s*16px;",
        )

        for control_id in ("modal-close", "btn-close-donation", "btn-close-support"):
            control = re.search(
                rf'<button[^>]*class="modal-close"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-icon", control.group("classes"))
            self.assertIn("material-icons", control.group("classes"))
            self.assertIn("modal-close-icon", control.group("classes"))
            self.assertNotIn("style=", control.group("attributes"))

    def test_welcome_icons_use_shared_wrapper(self):
        main_icon = re.search(
            r'<div class="welcome-screen"[^>]*>\s*'
            r'<span class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(main_icon)
        self.assertIn("ui-icon", main_icon.group("classes"))
        self.assertIn("material-icons", main_icon.group("classes"))
        self.assertIn("welcome-main-icon", main_icon.group("classes"))
        self.assertNotIn("style=", main_icon.group("attributes"))

        for control_id in ("btn-welcome-new-file", "btn-welcome-upload-file"):
            control = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-icon", control.group("classes"))
            self.assertIn("material-icons", control.group("classes"))
            self.assertIn("welcome-action-icon", control.group("classes"))
            self.assertNotIn("style=", control.group("attributes"))

        styles = WELCOME_STYLES.read_text(encoding="utf-8")
        self.assertRegex(
            styles, r"\.welcome-main-icon\s*\{[^}]*height:\s*40px;[^}]*width:\s*40px;"
        )
        self.assertRegex(
            styles, r"\.welcome-action-icon\s*\{[^}]*height:\s*16px;[^}]*width:\s*16px;"
        )

    def test_welcome_restore_clears_editor_overlays_and_rebuilds_actions(self):
        workflow = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "editor-workflow.js"
        ).read_text(encoding="utf-8")
        tabs = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "tabs.js"
        ).read_text(encoding="utf-8")

        self.assertIn("export function restoreWelcomeWorkspace()", workflow)
        for surface_id in (
            "completion-details",
            "problems-panel",
            "editor-operation-result",
            "secondary-editor-operation-result",
        ):
            self.assertIn(f"'{surface_id}'", workflow)
        self.assertIn("surface.hidden = true", workflow)
        self.assertIn("wrapper.style.display = 'none'", workflow)
        self.assertIn(
            "document.getElementById(id)?.classList.remove('visible')", workflow
        )
        self.assertIn("minimap.style.display = 'none'", workflow)
        self.assertIn("welcome.style.pointerEvents = 'auto'", workflow)
        self.assertIn("isWorkspaceDrawerMode()", workflow)
        self.assertIn("eventBus.emit('ui:hide-sidebar')", workflow)
        self.assertIn(
            "document.getElementById('sidebar-overlay')?.classList.remove('visible')",
            workflow,
        )
        self.assertIn("renderWelcomeWorkspace();", workflow)
        self.assertIn("restoreWelcomeWorkspace();", tabs)
        self.assertIn("if (!state.openTabs.includes(tab)) return;", tabs)
        self.assertIn("!state.openTabs.includes(tab) || state.activeTab !== tab", tabs)
        welcome_styles = WELCOME_STYLES.read_text(encoding="utf-8")
        self.assertRegex(
            welcome_styles,
            r"\.welcome-screen\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*30;[^}]*pointer-events:\s*auto;",
        )

    def test_ai_sidebar_control_icons_use_shared_wrapper(self):
        self.assertRegex(
            self.panel,
            r'<textarea[^>]*id="ai-chat-input"[^>]*aria-label="Message AI Studio"',
        )

        controls = {
            "btn-close-ai": ("ai-close-icon", 'aria-label="Close AI Studio"'),
            "btn-ai-send": ("ai-send-icon", 'aria-label="Send message"'),
        }
        for control_id, (compatibility_class, accessible_name) in controls.items():
            control = re.search(
                rf'<button(?P<attributes>[^>]*)id="{control_id}"(?P<suffix>[^>]*)>\s*'
                r'<span class="(?P<classes>[^"]*)"(?P<icon_attributes>[^>]*)>',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            button_attributes = control.group("attributes") + control.group("suffix")
            self.assertIn('type="button"', button_attributes)
            self.assertIn(accessible_name, button_attributes)
            self.assertIn("ui-icon", control.group("classes"))
            self.assertIn("material-icons", control.group("classes"))
            self.assertIn(compatibility_class, control.group("classes"))
            self.assertNotIn("style=", control.group("icon_attributes"))

        styles = AI_STYLES.read_text(encoding="utf-8")
        self.assertRegex(
            styles, r"\.ai-close-icon\s*\{[^}]*height:\s*18px;[^}]*width:\s*18px;"
        )
        self.assertRegex(
            styles, r"\.ai-send-icon\s*\{[^}]*height:\s*24px;[^}]*width:\s*24px;"
        )

    def test_support_dialog_icons_use_shared_wrapper(self):
        support = re.search(
            r"<!-- Support Modal -->(?P<body>.*?)<!-- Keyboard Shortcuts Overlay -->",
            self.panel,
            flags=re.S,
        )
        self.assertIsNotNone(support)
        icons = re.findall(
            r'<span class="(?P<classes>[^"]*\bmaterial-icons\b[^"]*)"(?P<attributes>[^>]*)>',
            support.group("body"),
        )
        self.assertEqual(len(icons), 7)
        for classes, attributes in icons:
            self.assertIn("ui-icon", classes)
            self.assertNotIn("style=", attributes)

        styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.support-option-icon,\s*\.support-action-icon\s*\{[^}]*height:\s*24px;[^}]*width:\s*24px;",
        )
        self.assertRegex(styles, r"\.support-action-icon\s*\{[^}]*margin-right:\s*8px;")

    def test_donation_dialog_icons_use_shared_wrapper(self):
        donation = re.search(
            r"<!-- Donation Modal -->(?P<body>.*?)<!-- Support Modal -->",
            self.panel,
            flags=re.S,
        )
        self.assertIsNotNone(donation)
        icons = re.findall(
            r'<span class="(?P<classes>[^"]*\bmaterial-icons\b[^"]*)"(?P<attributes>[^>]*)>',
            donation.group("body"),
        )
        self.assertEqual(len(icons), 10)
        for classes, attributes in icons:
            self.assertIn("ui-icon", classes)
            self.assertNotIn("style=", attributes)

        for platform in ("kofi", "paypal", "alipay", "bitcoin", "solana"):
            brand = re.search(
                rf'<div class="[^"]*\bdonation-icon-{platform}\b[^"]*"(?P<attributes>[^>]*)>',
                donation.group("body"),
            )
            self.assertIsNotNone(brand, platform)
            self.assertNotIn("style=", brand.group("attributes"))

        styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.donation-brand-icon\s*\{[^}]*font-size:\s*22px;[^}]*height:\s*22px;[^}]*width:\s*22px;",
        )
        for compatibility_class in ("donation-action", "donation-copy-icon"):
            self.assertRegex(
                styles,
                rf"\.{compatibility_class}\s*\{{[^}}]*font-size:\s*18px;[^}}]*height:\s*18px;[^}}]*width:\s*18px;",
            )

    def test_support_and_donation_dialogs_use_named_layout_classes(self):
        styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")
        donation = self.panel[
            self.panel.index("<!-- Donation Modal -->") : self.panel.index(
                "<!-- Support Modal -->"
            )
        ]
        support = self.panel[
            self.panel.index("<!-- Support Modal -->") : self.panel.index(
                "<!-- Keyboard Shortcuts Overlay -->"
            )
        ]

        self.assertNotIn("style=", donation)
        self.assertNotIn("style=", support)
        for class_name in (
            "support-modal",
            "support-options",
            "support-option",
            "support-icon",
            "support-option-title",
            "support-option-description",
            "support-links",
            "support-link",
            "support-link-label",
            "support-footer",
        ):
            self.assertIn(class_name, support)
            self.assertIn(f".{class_name}", styles)
        self.assertRegex(
            styles, r"\.modal\.donation-modal\s*\{[^}]*max-width:\s*540px;"
        )
        self.assertRegex(styles, r"\.modal\.support-modal\s*\{[^}]*max-width:\s*500px;")
        self.assertRegex(
            styles,
            r"\.support-option\s*\{[^}]*align-items:\s*center;[^}]*background:\s*var\(--bg-primary\);[^}]*border:\s*1px solid var\(--border-color\);[^}]*border-radius:\s*8px;[^}]*cursor:\s*pointer;[^}]*display:\s*flex;[^}]*padding:\s*16px;",
        )
        self.assertRegex(
            styles,
            r"\.support-links\s*\{[^}]*display:\s*grid;[^}]*gap:\s*12px;[^}]*grid-template-columns:\s*1fr 1fr;[^}]*margin-top:\s*12px;",
        )

    def test_tab_size_picker_icons_use_shared_wrapper(self):
        status_bar = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "status-bar.js"
        ).read_text(encoding="utf-8")
        self.assertEqual(
            status_bar.count('class="ui-icon material-icons tab-size-picker-icon"'),
            4,
        )
        self.assertNotIn('class="material-icons">${state.tabSize', status_bar)
        self.assertNotIn('class="material-icons">${state.indentWithTabs', status_bar)

        styles = UI_COMPONENTS.read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.tab-size-picker-icon\s*\{[^}]*font-size:\s*16px;[^}]*height:\s*16px;[^}]*width:\s*16px;",
        )

    def test_favorites_icons_use_shared_wrapper(self):
        favorites = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "favorites.js"
        ).read_text(encoding="utf-8")
        for compatibility_class in ("favorite-file-icon", "favorite-unpin-icon"):
            icon = re.search(
                rf'<span class="(?P<classes>[^"]*\b{compatibility_class}\b[^"]*)"(?P<attributes>[^>]*)>',
                favorites,
            )
            self.assertIsNotNone(icon, compatibility_class)
            self.assertIn("ui-icon", icon.group("classes"))
            self.assertIn("material-icons", icon.group("classes"))
            self.assertNotIn("style=", icon.group("attributes"))

        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.favorite-file-icon,\s*\.favorite-unpin-icon,\s*\.recent-file-icon\s*\{[^}]*height:\s*1em;[^}]*width:\s*1em;",
        )

    def test_recent_files_icon_use_shared_wrapper(self):
        recent_files = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "recent-files.js"
        ).read_text(encoding="utf-8")
        icon = re.search(
            r'<span class="(?P<classes>[^"]*\brecent-file-icon\b[^"]*)"(?P<attributes>[^>]*)>',
            recent_files,
        )
        self.assertIsNotNone(icon)
        self.assertIn("ui-icon", icon.group("classes"))
        self.assertIn("material-icons", icon.group("classes"))
        self.assertNotIn("style=", icon.group("attributes"))

        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        self.assertRegex(
            styles, r"\.recent-file-icon\s*\{[^}]*height:\s*1em;[^}]*width:\s*1em;"
        )

    def test_zip_progress_icon_use_shared_wrapper(self):
        self.assertIn(
            '<span class="ui-icon material-icons zip-progress-icon" aria-hidden="true"></span>',
            self.feedback_service,
        )
        self.assertNotIn(
            '<span class="material-icons zip-progress-icon">', self.feedback_service
        )

        styles = UI_COMPONENTS.read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.zip-progress-icon\s*\{[^}]*font-size:\s*18px;[^}]*height:\s*18px;[^}]*width:\s*18px;",
        )

    def test_command_palette_icons_use_shared_wrapper(self):
        command_palette = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "command-palette.js"
        ).read_text(encoding="utf-8")
        self.assertEqual(
            command_palette.count('class="ui-icon material-icons command-item-icon'),
            1,
        )
        self.assertIn(
            "icon.className = 'ui-icon material-icons command-item-icon'",
            command_palette,
        )
        self.assertNotIn('class="material-icons command-item-icon', command_palette)

        styles = UI_COMPONENTS.read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.command-item-icon\s*\{[^}]*font-size:\s*24px;[^}]*height:\s*24px;[^}]*width:\s*20px;",
        )

    def test_mobile_command_icon_uses_shared_wrapper(self):
        coordinators = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "index.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            '<span class="ui-icon material-icons mobile-command-icon">bolt</span>',
            coordinators,
        )
        self.assertNotIn(
            '<span class="material-icons" style="font-size:20px;vertical-align:middle;">bolt</span>',
            coordinators,
        )

        styles = UI_COMPONENTS.read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.mobile-command-icon\s*\{[^}]*font-size:\s*20px;[^}]*height:\s*20px;[^}]*width:\s*20px;",
        )

    def test_entity_popup_material_icons_use_shared_wrapper(self):
        editor = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "editor.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'class="ui-icon material-icons entity-popup-fallback-icon"',
            editor,
        )
        self.assertIn(
            'class="ui-icon material-icons entity-popup-copy-icon"',
            editor,
        )
        self.assertNotIn(
            '<span class="material-icons" style="margin-right:6px;font-size:1.1em;',
            editor,
        )
        self.assertNotIn('<span class="material-icons" style="font-size:14px;', editor)

        styles = (STYLE_MODULES / "editor.css").read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.entity-popup-fallback-icon\s*\{[^}]*font-size:\s*14px;[^}]*height:\s*14px;[^}]*margin-right:\s*6px;[^}]*width:\s*14px;",
        )
        self.assertRegex(
            styles,
            r"\.entity-popup-copy-icon\s*\{[^}]*font-size:\s*14px;[^}]*height:\s*14px;[^}]*width:\s*14px;",
        )

    def test_clipboard_fallback_and_entity_popup_use_shared_presentation(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        utils = (modules / "utils.js").read_text(encoding="utf-8")
        search = (modules / "global-search.js").read_text(encoding="utf-8")
        editor = (modules / "editor.js").read_text(encoding="utf-8")
        base = (STYLE_MODULES / "base.css").read_text(encoding="utf-8")
        editor_styles = (STYLE_MODULES / "editor.css").read_text(encoding="utf-8")

        self.assertIn('textArea.className = "clipboard-fallback-control"', utils)
        self.assertNotIn("textArea.style.position", utils)
        self.assertNotIn("textArea.style.left", utils)
        self.assertNotIn("textArea.style.top", utils)
        self.assertRegex(
            base,
            r"\.clipboard-fallback-control\s*\{[^}]*left:\s*-9999px;[^}]*position:\s*fixed;[^}]*top:\s*0;",
        )

        for consumer in (search, editor):
            self.assertIn("copyToClipboard", consumer)
            self.assertNotIn("style.cssText", consumer)
        self.assertNotIn("function _copyFallback", search)
        self.assertNotIn("function _fallbackCopy", editor)
        self.assertIn("entity-popup-mdi-icon", editor)
        self.assertRegex(
            editor_styles,
            r"#entity-inspect-popup\s*\{[^}]*background:\s*var\(--bg-primary, #1e1e2e\);[^}]*position:\s*fixed;[^}]*z-index:\s*99999;",
        )

    def test_shared_code_copy_icon_uses_shared_wrapper(self):
        preview = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "asset-preview.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'class="ui-icon material-icons code-copy-icon">content_copy</span>',
            preview,
        )
        self.assertNotIn(
            '<span class="material-icons" style="font-size: 18px;">content_copy</span>',
            preview,
        )

        styles = (STYLE_MODULES / "previews.css").read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.code-copy-icon\s*\{[^}]*font-size:\s*18px;[^}]*height:\s*18px;[^}]*width:\s*18px;",
        )

    def test_file_context_menu_icons_use_shared_wrapper(self):
        menu = re.search(
            r'<div class="context-menu" id="context-menu">(?P<body>.*?)'
            r'<div class="context-menu" id="tab-context-menu">',
            self.panel,
            flags=re.S,
        )
        self.assertIsNotNone(menu)
        icons = re.findall(
            r'<span class="(?P<classes>[^"]*\bmaterial-icons\b[^"]*)"(?P<attributes>[^>]*)>',
            menu.group("body"),
        )
        self.assertEqual(len(icons), 14)
        for classes, attributes in icons:
            self.assertIn("ui-icon", classes)
            self.assertIn("context-menu-icon", classes)
            self.assertNotIn("style=", attributes)

        styles = UI_COMPONENTS.read_text(encoding="utf-8")
        self.assertRegex(
            styles, r"\.context-menu-icon\s*\{[^}]*height:\s*18px;[^}]*width:\s*18px;"
        )

    def test_tab_context_menu_icons_use_shared_wrapper(self):
        menu = re.search(
            r'<div class="context-menu" id="tab-context-menu">(?P<body>.*?)'
            r"<!-- Loading Overlay -->",
            self.panel,
            flags=re.S,
        )
        self.assertIsNotNone(menu)
        icons = re.findall(
            r'<span class="(?P<classes>[^"]*\bmaterial-icons\b[^"]*)"(?P<attributes>[^>]*)>',
            menu.group("body"),
        )
        self.assertEqual(len(icons), 6)
        for classes, attributes in icons:
            self.assertIn("ui-icon", classes)
            self.assertIn("context-menu-icon", classes)
            self.assertNotIn("style=", attributes)

        context_menu_module = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "context-menu.js"
        ).read_text(encoding="utf-8")
        self.assertEqual(
            context_menu_module.count(
                '<span class="ui-icon material-icons context-menu-icon">'
            ),
            2,
        )
        self.assertNotIn(
            '<span class="material-icons">${state.splitView.orientation',
            context_menu_module,
        )

    def test_shared_status_surfaces_are_announced(self):
        self.assertRegex(
            self.panel,
            r'class="[^"]*\btoast-container\b[^"]*"[^>]*role="region"[^>]*aria-live="polite"',
        )
        self.assertRegex(
            self.panel,
            r'class="[^"]*\bloading-overlay\b[^"]*\bvisible\b[^"]*"[^>]*role="status"[^>]*aria-live="polite"',
        )

    def test_workspace_has_named_landmarks(self):
        self.assertIn(
            'class="toolbar" role="toolbar" aria-label="Blueprint Studio commands"',
            self.panel,
        )
        self.assertIn(
            'class="main-container" role="main" aria-label="Blueprint Studio workspace"',
            self.panel,
        )
        self.assertIn(
            'class="sidebar" id="sidebar" role="complementary" aria-label="Blueprint Studio navigation"',
            self.panel,
        )

    def test_toolbar_commands_have_named_functional_groups(self):
        expected_groups = {
            "toolbar-group--support": ("Support", ("btn-donate", "btn-support")),
            "toolbar-group--workspace-tools": (
                "Workspace tools",
                ("btn-terminal", "btn-ai-studio"),
            ),
            "toolbar-group--instance": (
                "Home Assistant instance controls",
                ("btn-restart-ha", "btn-dev-tools"),
            ),
            "toolbar-group--application": (
                "Application controls",
                ("btn-app-settings", "btn-refresh"),
            ),
        }

        for class_name, (label, control_ids) in expected_groups.items():
            group = re.search(
                rf'<div class="[^"]*\b{class_name}\b[^"]*" role="group" aria-label="{re.escape(label)}"[^>]*>'
                rf"(?P<body>.*?)</div>",
                self.panel,
                flags=re.S,
            )
            self.assertIsNotNone(group, class_name)
            for control_id in control_ids:
                self.assertIn(f'id="{control_id}"', group.group("body"))

    def test_toolbar_overflow_preserves_commands_by_explicit_priority(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        overflow = (modules / "toolbar-overflow.js").read_text(encoding="utf-8")
        initialization = (modules / "initialization.js").read_text(encoding="utf-8")
        layout = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")
        responsive = (STYLE_MODULES / "responsive.css").read_text(encoding="utf-8")

        priority_groups = re.findall(
            r'<div class="[^"]*\btoolbar-group\b[^"]*"[^>]*data-toolbar-priority="([0-5])"',
            self.panel,
        )
        self.assertEqual(len(priority_groups), 16)
        self.assertEqual(set(priority_groups), {"0", "1", "2", "3", "4", "5"})

        trigger = re.search(r'<button[^>]*id="btn-toolbar-overflow"[^>]*>', self.panel)
        self.assertIsNotNone(trigger)
        self.assertIn('aria-haspopup="menu"', trigger.group(0))
        self.assertIn('aria-controls="toolbar-overflow-menu"', trigger.group(0))
        self.assertIn('aria-expanded="false"', trigger.group(0))
        self.assertRegex(
            self.panel,
            r'<div class="ui-menu toolbar-overflow-menu" id="toolbar-overflow-menu" role="menu"[^>]*hidden>',
        )

        toolbar_markup = re.search(
            r'<div class="toolbar"[^>]*>(?P<body>.*?)</div>\s*'
            r'<div class="ui-menu toolbar-overflow-menu"',
            self.panel,
            flags=re.S,
        )
        self.assertIsNotNone(toolbar_markup)
        command_ids = re.findall(
            r'<button[^>]*id="(btn-[^"]+)"', toolbar_markup.group("body")
        )
        self.assertEqual(
            len(
                [
                    control_id
                    for control_id in command_ids
                    if control_id != "btn-toolbar-overflow"
                ]
            ),
            39,
        )

        for contract in (
            "toolbar.scrollWidth <= toolbar.clientWidth",
            "Number(right.dataset.toolbarPriority)",
            "item.dataset.commandId = control.id",
            "control.click()",
            "(?:Ctrl|Cmd|Alt|Option|Shift|Meta|F\\d)",
            "event.key === 'ArrowDown'",
            "event.key === 'ArrowUp'",
            "event.key === 'Home'",
            "event.key === 'End'",
            "event.key === 'Escape'",
            "new MutationObserver",
        ):
            self.assertIn(contract, overflow)
        self.assertIn("initToolbarOverflow();", initialization)
        self.assertIn(".toolbar-group.toolbar-overflow-hidden", layout)
        self.assertIn(".toolbar-overflow-menu-item", layout)
        self.assertIn("width: min(360px, calc(100vw - 16px));", layout)
        for arbitrarily_hidden in (
            "#group-split-view",
            "#btn-upload-folder",
            "#btn-download-folder",
            "#btn-one-tab-mode",
            "#btn-toggle-select",
        ):
            self.assertNotIn(arbitrarily_hidden, responsive)

    def test_instance_toolbar_group_has_warning_boundary(self):
        styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")
        responsive = (STYLE_MODULES / "responsive.css").read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.toolbar-group--instance\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--status-warning\) 8%, transparent\);"
            r"[^}]*border:\s*1px solid color-mix\(in srgb, var\(--status-warning\) 45%, var\(--border-subtle\)\);",
        )
        self.assertRegex(
            responsive,
            r"\.toolbar-group\.toolbar-group--instance\s*\{[^}]*border:\s*1px solid color-mix\(in srgb, var\(--status-warning\) 45%, var\(--border-subtle\)\);",
        )

        restart = re.search(
            r'<button class="(?P<classes>[^"]*)" id="btn-restart-ha"[^>]*>', self.panel
        )
        self.assertIsNotNone(restart)
        self.assertIn("danger", restart.group("classes").split())

    def test_activity_rail_has_named_keyboard_buttons(self):
        for activity, label, pressed in (
            ("activity-explorer", "Explorer", "true"),
            ("activity-search", "Search", "false"),
            ("activity-source-control", "Source Control", "false"),
            ("activity-sftp", "SFTP", "false"),
        ):
            control = re.search(rf'<div[^>]*id="{activity}"[^>]*>', self.panel)
            self.assertIsNotNone(control)
            self.assertIn('role="button"', control.group(0))
            self.assertIn('tabindex="0"', control.group(0))
            self.assertIn(f'aria-label="{label}"', control.group(0))
            self.assertIn(f'aria-pressed="{pressed}"', control.group(0))

    def test_close_sidebar_has_named_keyboard_button(self):
        control = re.search(r'<div[^>]*id="btn-close-sidebar"[^>]*>', self.panel)
        self.assertIsNotNone(control)
        self.assertIn('role="button"', control.group(0))
        self.assertIn('tabindex="0"', control.group(0))
        self.assertIn('aria-label="Close Sidebar"', control.group(0))

    def test_activity_rail_icons_use_shared_wrapper(self):
        for control_id in (
            "activity-explorer",
            "activity-search",
            "activity-source-control",
            "activity-sftp",
            "btn-close-sidebar",
        ):
            icon = re.search(
                rf'<div[^>]*id="{control_id}"[^>]*>\s*<span class="([^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(icon, control_id)
            self.assertIn("ui-icon", icon.group(1).split())
            self.assertIn("material-icons", icon.group(1).split())

    def test_source_control_is_a_dedicated_sidebar_view(self):
        self.assertRegex(
            self.panel,
            r'<div id="view-source-control" class="sidebar-view hidden">',
        )
        self.assertIn('id="source-control-panels"', self.panel)
        self.assertIn('id="source-control-unavailable"', self.panel)
        self.assertIn(
            'for (const panelId of ["git-panel", "gitea-panel"])',
            self.ui_module,
        )
        self.assertIn(
            "elements.sourceControlPanels.appendChild(panel)",
            self.ui_module,
        )

        sidebar = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "sidebar.js"
        ).read_text(encoding="utf-8")
        coordinator = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "UICoordinator.js"
        ).read_text(encoding="utf-8")
        self.assertIn('[elements.activitySourceControl, "source-control"]', sidebar)
        self.assertIn(
            'bindActivity(elements.activitySourceControl, "source-control")',
            coordinator,
        )

    def test_activity_rail_uses_shared_semantic_states_and_badge(self):
        module = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "activity-rail.js"
        ).read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")

        self.assertIn("['loading', 'empty', 'ready', 'unavailable']", module)
        self.assertIn("control.setAttribute('aria-busy'", module)
        self.assertIn(
            "normalizedCount > 0 ? `${baseLabel}, ${normalizedCount} changes`", module
        )
        self.assertIn(
            "state.gitIntegrationEnabled || state.giteaIntegrationEnabled", module
        )
        self.assertRegex(styles, r"\.activity-badge\s*\{[^}]*position:\s*absolute;")
        self.assertRegex(
            styles, r"\.activity-item:focus-visible\s*\{[^}]*var\(--focus-color\)"
        )
        self.assertIn(".activity-item.is-unavailable:not(.active)", styles)

    def test_sftp_disabled_state_remains_discoverable(self):
        sftp = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "sftp.js"
        ).read_text(encoding="utf-8")
        self.assertIn('id="sftp-view-state"', self.panel)
        self.assertIn("activitySftp.classList.remove('hidden')", sftp)
        self.assertIn("'SFTP is disabled'", sftp)
        self.assertNotIn("activitySftp.style.display = enabled ? 'flex' : 'none'", sftp)

    def test_sftp_active_connection_releases_initial_tree_visibility(self):
        sftp = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "sftp.js"
        ).read_text(encoding="utf-8")
        active_connection = sftp.split("if (!connectionId)", 1)[1].split(
            "// TREE MODE", 1
        )[0]

        self.assertIn(
            "breadcrumbEl?.classList.remove('workspace-initially-hidden')",
            active_connection,
        )
        self.assertIn(
            "treeEl?.classList.remove('workspace-initially-hidden')", active_connection
        )
        self.assertIn('defaultOpt.textContent = t("sidebar.sftp")', sftp)
        self.assertNotIn("viewSftp.querySelector('.sidebar-header span')", sftp)
        self.assertEqual(
            sftp.count(
                "#sftp-connection-selector-container > span, #sftp-connection-selector-container option[value='']"
            ),
            1,
        )

        manifest = json.loads(
            (
                ROOT / "custom_components" / "blueprint_studio" / "manifest.json"
            ).read_text(encoding="utf-8")
        )
        sftp_consumers = [
            path
            for path in (
                ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
            ).rglob("*.js")
            if path.name != "sftp.js"
            and re.search(
                r"from ['\"][^'\"]*sftp\.js", path.read_text(encoding="utf-8")
            )
        ]
        self.assertTrue(sftp_consumers)
        for consumer in sftp_consumers:
            self.assertIn(
                f"sftp.js?v={manifest['version']}", consumer.read_text(encoding="utf-8")
            )

    def test_theme_toggle_has_named_keyboard_button(self):
        control = re.search(r'<div[^>]*id="theme-toggle"[^>]*>', self.panel)
        self.assertIsNotNone(control)
        self.assertIn('role="button"', control.group(0))
        self.assertIn('tabindex="0"', control.group(0))
        self.assertIn('aria-label="Theme"', control.group(0))
        self.assertIn('aria-haspopup="menu"', control.group(0))
        self.assertIn('aria-controls="theme-menu"', control.group(0))
        self.assertIn('aria-expanded="false"', control.group(0))

    def test_theme_presets_have_keyboard_menu_semantics(self):
        menu = re.search(r'<div[^>]*class="[^"]*\btheme-menu\b[^"]*"[^>]*>', self.panel)
        self.assertIsNotNone(menu)
        self.assertIn('role="menu"', menu.group(0))
        self.assertIn('aria-label="Theme presets"', menu.group(0))
        coordinator = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "UICoordinator.js"
        ).read_text(encoding="utf-8")
        self.assertIn('item.setAttribute("role", "menuitemradio")', coordinator)
        self.assertIn(
            'elements.themeToggle.setAttribute("aria-expanded", "true")', coordinator
        )
        self.assertIn(
            'elements.themeToggle.setAttribute("aria-expanded", "false")', coordinator
        )
        self.assertIn('if (event.key === "ArrowDown")', coordinator)
        self.assertIn('if (event.key === "ArrowUp")', coordinator)
        self.assertIn('if (event.key === "Home")', coordinator)
        self.assertIn('if (event.key === "End")', coordinator)
        self.assertIn('else if (event.key === "Escape")', coordinator)
        self.assertIn(
            'item.setAttribute("aria-checked", String(isActive))', self.ui_module
        )

    def test_theme_icons_use_shared_wrapper(self):
        trigger = re.search(
            r'<span class="(?P<classes>[^"]*)"[^>]*id="theme-icon"[^>]*>',
            self.panel,
        )
        self.assertIsNotNone(trigger)
        self.assertIn("ui-icon", trigger.group("classes"))
        self.assertIn("material-icons", trigger.group("classes"))
        self.assertIn("theme-trigger-icon", trigger.group("classes"))

        menu = re.search(
            r'<div[^>]*id="theme-menu"[^>]*>(?P<body>.*?)</div>\s*</div>',
            self.panel,
            flags=re.S,
        )
        self.assertIsNotNone(menu)
        icons = re.findall(
            r'<span class="(?P<classes>[^"]*\btheme-menu-icon\b[^"]*)">',
            menu.group("body"),
        )
        self.assertEqual(len(icons), 11)
        for classes in icons:
            self.assertIn("ui-icon", classes.split())
            self.assertIn("material-icons", classes.split())

    def test_global_search_loading_icon_uses_shared_wrapper(self):
        control = re.search(
            r'<span[^>]*id="global-search-loading"[^>]*class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(control)
        self.assertIn("ui-icon", control.group("classes"))
        self.assertIn("material-icons", control.group("classes"))
        self.assertIn("global-search-loading-icon", control.group("classes"))
        self.assertIn("spinning-centered", control.group("classes"))
        self.assertIn('aria-hidden="true"', control.group("attributes"))
        self.assertNotIn("style=", control.group("attributes"))

    def test_global_search_loading_state_uses_semantic_class(self):
        styles = UI_COMPONENTS.read_text(encoding="utf-8")
        search = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "global-search.js"
        ).read_text(encoding="utf-8")

        self.assertIn('globalSearchLoading.classList.toggle("active", visible)', search)
        self.assertIn(
            'globalSearchLoading.setAttribute("aria-hidden", String(!visible))', search
        )
        self.assertEqual(search.count("setGlobalSearchLoading(true)"), 1)
        self.assertEqual(search.count("setGlobalSearchLoading(false)"), 4)
        self.assertNotIn("globalSearchLoading.style.display", search)
        self.assertRegex(
            styles, r"\.global-search-loading-icon\.active\s*\{[^}]*display:\s*block;"
        )

    def test_global_search_empty_icon_uses_shared_wrapper(self):
        control = re.search(
            r'<span class="(?P<classes>[^"]*\bglobal-search-empty-icon\b[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(control)
        self.assertIn("ui-icon", control.group("classes"))
        self.assertIn("material-icons", control.group("classes"))
        self.assertNotIn("style=", control.group("attributes"))

    def test_status_connection_icon_uses_shared_wrapper(self):
        control = re.search(
            r'<div[^>]*id="status-connection"[^>]*>\s*'
            r'<span class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(control)
        self.assertIn("ui-icon", control.group("classes"))
        self.assertIn("material-icons", control.group("classes"))
        self.assertIn("status-connection-icon", control.group("classes"))
        self.assertNotIn("style=", control.group("attributes"))

    def test_keyboard_shortcuts_close_uses_shared_icon_wrapper(self):
        dialog = re.search(
            r'<div[^>]*class="shortcuts-modal"(?P<attributes>[^>]*)>', self.panel
        )
        self.assertIsNotNone(dialog)
        self.assertIn('role="dialog"', dialog.group("attributes"))
        self.assertIn('aria-modal="true"', dialog.group("attributes"))
        self.assertIn(
            'aria-labelledby="keyboard-shortcuts-title"', dialog.group("attributes")
        )
        self.assertIn(
            '<h2 id="keyboard-shortcuts-title">Keyboard Shortcuts</h2>', self.panel
        )

        control = re.search(
            r'<button[^>]*class="shortcuts-close"[^>]*id="shortcuts-close"(?P<attributes>[^>]*)>\s*'
            r'<span class="(?P<classes>[^"]*)">',
            self.panel,
        )
        self.assertIsNotNone(control)
        self.assertIn('type="button"', control.group("attributes"))
        self.assertIn(
            'aria-label="Close keyboard shortcuts"', control.group("attributes")
        )
        self.assertIn("ui-icon", control.group("classes"))
        self.assertIn("material-icons", control.group("classes"))

    def test_command_palette_results_have_listbox_semantics(self):
        results = re.search(r'<div[^>]*id="command-palette-results"[^>]*>', self.panel)
        self.assertIsNotNone(results)
        self.assertIn('role="listbox"', results.group(0))
        self.assertIn('aria-label="Command palette results"', results.group(0))

        palette = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "command-palette.js"
        ).read_text(encoding="utf-8")
        self.assertIn('div.setAttribute("role", "option")', palette)
        self.assertIn('div.setAttribute("aria-selected"', palette)

    def test_command_palette_exposes_complete_command_metadata(self):
        palette = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "command-palette.js"
        ).read_text(encoding="utf-8")
        toolbar_commands = re.findall(
            r'<div class="toolbar-group[^>]*data-toolbar-priority="\d+"[^>]*>(.*?)</div>',
            self.panel,
            flags=re.S,
        )
        toolbar_ids = {
            command_id
            for group in toolbar_commands
            for command_id in re.findall(r'<button[^>]*id="([^"]+)"', group)
        }
        self.assertEqual(len(toolbar_ids), 39)
        self.assertIn("btn-problems", toolbar_ids)
        self.assertIn(
            "querySelectorAll(':scope > .toolbar-group[data-toolbar-priority] > button')",
            palette,
        )
        self.assertIn("export function getCommandPaletteCommands()", palette)
        self.assertIn(
            "`${command.label} ${command.scope} ${command.shortcut} ${command.keywords}`",
            palette,
        )
        self.assertIn(
            "status.textContent = availability.enabled ? 'Available'", palette
        )
        self.assertIn("`Unavailable: ${availability.reason}`", palette)
        self.assertIn("div.setAttribute('aria-disabled'", palette)
        self.assertIn("if (!item.availability().enabled) return", palette)

    def test_command_palette_contextual_commands_explain_unavailability(self):
        palette = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "command-palette.js"
        ).read_text(encoding="utf-8")
        for command_id, reason in (
            ("btn-format", "Open a file to format it"),
            ("btn-use-blueprint", "Open a Blueprint file to use it"),
            ("btn-markdown-preview", "Open a Markdown file to preview it"),
            ("btn-terminal", "Enable Terminal in Settings"),
            ("btn-ai-studio", "Enable AI Studio in Settings"),
            ("btn-git-pull", "Enable GitHub source control in Settings"),
            ("btn-gitea-pull", "Enable Gitea source control in Settings"),
        ):
            self.assertIn(f"'{command_id}'", palette)
            self.assertIn(reason, palette)

        styles = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "styles"
            / "modules"
            / "ui-components.css"
        ).read_text(encoding="utf-8")
        for selector in (
            ".command-item.is-disabled",
            ".command-item-metadata",
            ".command-item-status::before",
            ".command-item-disabled-reason::before",
        ):
            self.assertIn(selector, styles)

    def test_file_tree_collapse_has_explicit_state_contract(self):
        control = re.search(
            r'<button[^>]*id="btn-file-tree-collapse"[^>]*>', self.panel
        )
        self.assertIsNotNone(control)
        self.assertIn('aria-label="Collapse file tree"', control.group(0))
        self.assertIn('aria-controls="file-tree"', control.group(0))
        self.assertIn('aria-expanded="true"', control.group(0))

    def test_primary_navigation_layout_uses_named_classes(self):
        activity_spacer = re.search(
            r'<div class="activity-rail-spacer"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(activity_spacer)
        self.assertIn('aria-hidden="true"', activity_spacer.group("attributes"))
        self.assertNotIn("style=", activity_spacer.group("attributes"))

        collapse = re.search(
            r'<button class="(?P<classes>[^"]*)" id="btn-file-tree-collapse"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(collapse)
        self.assertIn("file-tree-collapse-control", collapse.group("classes"))
        self.assertNotIn("style=", collapse.group("attributes"))

        layout_styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")
        file_tree_styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        self.assertRegex(layout_styles, r"\.activity-rail-spacer\s*\{[^}]*flex:\s*1;")
        self.assertRegex(
            file_tree_styles,
            r"\.file-tree-collapse-control\s*\{[^}]*flex-shrink:\s*0;[^}]*margin-left:\s*auto;",
        )

    def test_primary_workspace_markup_has_no_inline_presentation(self):
        self.assertNotRegex(self.panel, r"\sstyle\s*=")

        for class_name in (
            "workspace-initially-hidden",
            "gitea-toolbar-icon",
            "git-panel-github-icon",
            "git-empty-state-icon",
            "gitea-panel-badge",
            "favorites-tree",
            "sftp-connection-selector",
            "sftp-file-tree",
        ):
            self.assertIn(class_name, self.panel)

        base_styles = (STYLE_MODULES / "base.css").read_text(encoding="utf-8")
        self.assertRegex(
            base_styles,
            r"\.workspace-initially-hidden\.workspace-initially-hidden\s*\{[^}]*display:\s*none;",
        )

        toolbar = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "toolbar.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "btnUseBlueprint.classList.toggle('hidden', !isBlueprint)", toolbar
        )
        self.assertNotIn("btnUseBlueprint.style.display", toolbar)

    def test_breadcrumb_home_has_keyboard_button_semantics(self):
        home = re.search(
            r'<span[^>]*class="breadcrumb-item breadcrumb-home"[^>]*>', self.panel
        )
        self.assertIsNotNone(home)
        self.assertIn('role="button"', home.group(0))
        self.assertIn('tabindex="0"', home.group(0))
        self.assertIn('aria-label="Home"', home.group(0))

        file_tree = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "file-tree.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'bindBreadcrumbButton(homeItem, t("sidebar.home"), navigateHome)', file_tree
        )

    def test_dynamic_breadcrumb_segments_reuse_keyboard_button_binding(self):
        file_tree = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "file-tree.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "function bindBreadcrumbButton(element, label, action)", file_tree
        )
        self.assertIn(
            "bindBreadcrumbButton(item, part, () => navigateToFolder(itemPath))",
            file_tree,
        )
        self.assertIn('event.key === "Enter" || event.key === " "', file_tree)

    def test_editor_breadcrumb_links_have_keyboard_button_semantics(self):
        breadcrumb = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "breadcrumb.js"
        ).read_text(encoding="utf-8")
        self.assertIn("function bindBreadcrumbLink(element, label, action)", breadcrumb)
        self.assertIn('element.setAttribute("role", "button")', breadcrumb)
        self.assertIn('element.setAttribute("tabindex", "0")', breadcrumb)
        self.assertIn('element.setAttribute("aria-label", label)', breadcrumb)
        self.assertIn('bindBreadcrumbLink(configLink, "config", () => {', breadcrumb)
        self.assertIn("bindBreadcrumbLink(connLink, connId, () => {", breadcrumb)
        self.assertIn("bindBreadcrumbLink(link, part, () => {", breadcrumb)
        self.assertIn('event.key === "Enter" || event.key === " "', breadcrumb)

    def test_global_search_disclosures_have_keyboard_state_semantics(self):
        coordinator = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "UICoordinator.js"
        ).read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        for control_id, controls_id in (
            ("btn-toggle-replace-all", "global-replace-container"),
            ("btn-toggle-patterns", "global-patterns-container"),
        ):
            control = re.search(rf'<span[^>]*id="{control_id}"[^>]*>', self.panel)
            self.assertIsNotNone(control)
            self.assertIn('role="button"', control.group(0))
            self.assertIn('tabindex="0"', control.group(0))
            self.assertIn(f'aria-controls="{controls_id}"', control.group(0))
            self.assertIn('aria-expanded="false"', control.group(0))
        self.assertIn(
            "function bindDisclosureControl(control, container, onToggle)", coordinator
        )
        self.assertIn(
            'const expanded = container.classList.toggle("expanded")', coordinator
        )
        self.assertIn(
            'control.setAttribute("aria-expanded", String(expanded))', coordinator
        )
        self.assertNotIn("container.style.display", coordinator)
        self.assertIn('event.key === "Enter" || event.key === " "', coordinator)
        for container_id, layout_class in (
            ("global-replace-container", "global-search-replace-row"),
            ("global-patterns-container", "global-search-patterns"),
        ):
            container = re.search(
                rf'<div id="{container_id}" class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
                self.panel,
            )
            self.assertIsNotNone(container)
            self.assertIn("global-search-disclosure-panel", container.group("classes"))
            self.assertIn(layout_class, container.group("classes"))
            self.assertNotIn("style=", container.group("attributes"))
        self.assertRegex(
            styles, r"\.global-search-disclosure-panel\s*\{[^}]*display:\s*none;"
        )
        self.assertRegex(
            styles,
            r"\.global-search-disclosure-panel\.expanded\s*\{[^}]*display:\s*flex;",
        )

    def test_global_search_disclosure_layout_uses_named_classes(self):
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        controls = {
            "global-replace-input": "global-search-replace-input",
            "btn-global-replace-all": "global-search-replace-action",
            "btn-toggle-patterns": "global-search-pattern-toggle",
            "global-search-include": "global-search-pattern-input",
            "global-search-exclude": "global-search-pattern-input",
        }
        for control_id, compatibility_class in controls.items():
            control = re.search(
                rf'<(?:input|button|span)[^>]*id="{control_id}"[^>]*>', self.panel
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn(compatibility_class, control.group(0))
            self.assertNotIn("style=", control.group(0))

        toggle_row = re.search(
            r'<div class="global-search-pattern-toggle-row"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(toggle_row)
        self.assertNotIn("style=", toggle_row.group("attributes"))
        self.assertRegex(
            styles,
            r"\.global-search-replace-row\s*\{[^}]*align-items:\s*center;[^}]*gap:\s*4px;[^}]*margin-bottom:\s*8px;[^}]*margin-left:\s*22px;",
        )
        self.assertRegex(
            styles,
            r"\.toolbar-btn\.global-search-replace-action\s*\{[^}]*height:\s*32px;[^}]*width:\s*32px;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-pattern-toggle\s*\{[^}]*color:\s*var\(--accent-color\);[^}]*cursor:\s*pointer;[^}]*font-size:\s*11px;[^}]*font-weight:\s*600;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-patterns\s*\{[^}]*flex-direction:\s*column;[^}]*gap:\s*4px;[^}]*margin-left:\s*22px;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-patterns \.search-input\.global-search-pattern-input\s*\{[^}]*font-size:\s*12px;[^}]*padding:\s*4px 8px;",
        )

    def test_global_search_scope_has_keyboard_tab_semantics(self):
        coordinator = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "UICoordinator.js"
        ).read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        tablist = re.search(
            r'<div[^>]*class="[^"]*\bsearch-mode-tabs\b[^"]*"[^>]*>', self.panel
        )
        self.assertIsNotNone(tablist)
        self.assertIn('role="tablist"', tablist.group(0))
        self.assertIn('aria-label="Search scope"', tablist.group(0))
        self.assertNotIn("style=", tablist.group(0))
        tabs = re.findall(
            r'<div[^>]*class="[^"]*\bsearch-mode-tab\b[^"]*"[^>]*>', self.panel
        )
        self.assertEqual(len(tabs), 3)
        for tab in tabs:
            self.assertIn('role="tab"', tab)
            self.assertIn('aria-controls="global-search-results"', tab)
            self.assertIn("aria-selected=", tab)
            self.assertNotIn("style=", tab)
        self.assertRegex(
            styles,
            r"\.search-mode-tabs\s*\{[^}]*display:\s*flex;[^}]*margin-bottom:\s*12px;",
        )
        self.assertRegex(
            styles,
            r"\.search-mode-tab\s*\{[^}]*color:\s*var\(--text-secondary\);[^}]*flex:\s*1;[^}]*font-size:\s*11px;[^}]*padding:\s*4px;",
        )
        self.assertRegex(
            styles,
            r"\.search-mode-tab\.active\s*\{[^}]*background:\s*var\(--bg-tertiary\);[^}]*color:\s*var\(--accent-color\);",
        )
        self.assertIn(
            "const activateSearchModeTab = (tab, moveFocus = false) =>", coordinator
        )
        self.assertIn(
            "item.setAttribute('aria-selected', String(selected))", coordinator
        )
        self.assertNotIn("item.style.background", coordinator)
        self.assertNotIn("item.style.color", coordinator)
        self.assertIn("if (event.key === 'ArrowRight')", coordinator)
        self.assertIn("if (event.key === 'ArrowLeft')", coordinator)
        self.assertIn("if (event.key === 'Home')", coordinator)
        self.assertIn("if (event.key === 'End')", coordinator)

    def test_global_search_query_row_uses_named_layout_classes(self):
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        row = re.search(
            r'<div class="global-search-query-row"(?P<attributes>[^>]*)>', self.panel
        )
        wrapper = re.search(
            r'<div class="global-search-input-wrap"(?P<attributes>[^>]*)>', self.panel
        )
        input_control = re.search(
            r'<input[^>]*class="[^"]*\bglobal-search-query-input\b[^"]*"[^>]*id="global-search-input"(?P<attributes>[^>]*)>',
            self.panel,
        )
        modifiers = re.search(
            r'<div class="global-search-modifiers"(?P<attributes>[^>]*)>', self.panel
        )
        for control in (row, wrapper, input_control, modifiers):
            self.assertIsNotNone(control)
            self.assertNotIn("style=", control.group("attributes"))

        self.assertRegex(
            styles,
            r"\.global-search-query-row\s*\{[^}]*align-items:\s*center;[^}]*display:\s*flex;[^}]*gap:\s*4px;[^}]*margin-bottom:\s*8px;[^}]*position:\s*relative;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-input-wrap\s*\{[^}]*flex:\s*1;[^}]*position:\s*relative;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-input-wrap \.search-input\.global-search-query-input\s*\{[^}]*padding-right:\s*30px;[^}]*width:\s*100%;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-modifiers\s*\{[^}]*display:\s*flex;[^}]*gap:\s*2px;",
        )

    def test_global_search_static_frame_uses_named_layout_classes(self):
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        container = re.search(
            r'<div class="(?P<classes>[^"]*\bglobal-search-container\b[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        results = re.search(
            r'<div id="global-search-results" class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        empty_state = re.search(
            r'<div class="(?P<classes>[^"]*\bsearch-empty-state\b[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        empty_copy = re.search(
            r'<p class="(?P<classes>[^"]*\bglobal-search-empty-copy\b[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        for control in (container, results, empty_state, empty_copy):
            self.assertIsNotNone(control)
            self.assertNotIn("style=", control.group("attributes"))
        self.assertIn("search-container", container.group("classes"))
        self.assertIn("global-search-results", results.group("classes"))
        self.assertIn("ui-empty-state", empty_state.group("classes"))

        self.assertRegex(
            styles,
            r"#view-search \.search-container\.global-search-container\s*\{[^}]*border-bottom:\s*1px solid var\(--border-color\);[^}]*padding:\s*12px;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-results\s*\{[^}]*flex:\s*1;[^}]*overflow-y:\s*auto;[^}]*padding:\s*0;",
        )
        self.assertRegex(
            styles,
            r"\.search-empty-state\s*\{[^}]*align-items:\s*center;[^}]*color:\s*var\(--text-secondary\);[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*padding:\s*40px 20px;[^}]*text-align:\s*center;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-empty-copy\s*\{[^}]*font-size:\s*14px;[^}]*margin:\s*0;",
        )

    def test_global_search_dynamic_empty_and_error_states_use_named_classes(self):
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        search = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "global-search.js"
        ).read_text(encoding="utf-8")

        self.assertEqual(search.count('class="ui-empty-state search-empty-state"'), 3)
        self.assertEqual(
            search.count('class="ui-icon material-icons global-search-empty-icon"'), 3
        )
        self.assertEqual(search.count('class="global-search-empty-copy"'), 3)
        self.assertIn('class="global-search-error-state"', search)
        self.assertNotIn('class="search-empty-state" style=', search)
        self.assertNotIn("Search failed: ${e.message}", search)
        self.assertIn("Search failed: ${escapeHtml(e.message)}", search)
        self.assertRegex(
            styles,
            r"\.global-search-error-state\s*\{[^}]*color:\s*var\(--error-color\);[^}]*padding:\s*20px;[^}]*text-align:\s*center;",
        )

    def test_global_search_file_result_groups_use_named_classes(self):
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        search = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "global-search.js"
        ).read_text(encoding="utf-8")
        template = search[
            search.index("function _buildFileGroupHtml") : search.index(
                "function renderGlobalSearchResults"
            )
        ]

        for class_name in (
            "global-search-file-header",
            "global-search-file-toggle-icon",
            "global-search-file-name",
            "global-search-file-folder",
            "global-search-file-actions",
            "global-search-file-action-icon",
            "global-search-file-badge",
            "global-search-file-list",
        ):
            self.assertIn(class_name, template)
            self.assertIn(f".{class_name}", styles)
        self.assertNotIn("style=", template)
        self.assertEqual(template.count("ui-icon material-icons"), 3)
        self.assertRegex(
            styles,
            r"\.global-search-file-header\s*\{[^}]*align-items:\s*center;[^}]*background:\s*var\(--bg-tertiary\);[^}]*border-bottom:\s*1px solid var\(--border-color\);[^}]*cursor:\s*pointer;[^}]*display:\s*flex;[^}]*padding:\s*8px 12px;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-file-actions\s*\{[^}]*align-items:\s*center;[^}]*display:\s*flex;[^}]*gap:\s*8px;[^}]*margin-left:\s*auto;",
        )
        self.assertRegex(
            styles, r"\.global-search-file-list\s*\{[^}]*display:\s*block;"
        )

    def test_global_search_match_rows_use_named_classes(self):
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        search = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "global-search.js"
        ).read_text(encoding="utf-8")
        template = search[
            search.index("function _buildMatchHtml") : search.index(
                "function _buildFileGroupHtml"
            )
        ]

        for class_name in (
            "global-search-match-row",
            "global-search-match-line",
            "global-search-match-excerpt",
            "global-search-match-actions",
            "global-search-match-action-icon",
        ):
            self.assertIn(class_name, template)
            self.assertIn(f".{class_name}", styles)
        self.assertNotIn("style=", template)
        self.assertEqual(
            template.count("ui-icon material-icons global-search-match-action-icon"), 2
        )
        self.assertRegex(
            styles,
            r"\.global-search-match-row\s*\{[^}]*align-items:\s*center;[^}]*border-bottom:\s*1px solid var\(--border-color\);[^}]*cursor:\s*pointer;[^}]*display:\s*flex;[^}]*font-family:\s*monospace;[^}]*font-size:\s*12px;[^}]*padding:\s*6px 12px 6px 34px;[^}]*position:\s*relative;",
        )
        self.assertRegex(
            styles,
            r"\.global-search-match-actions\s*\{[^}]*background:\s*var\(--bg-primary\);[^}]*display:\s*flex;[^}]*gap:\s*4px;[^}]*opacity:\s*0;[^}]*padding-left:\s*8px;[^}]*position:\s*absolute;[^}]*right:\s*12px;",
        )

    def test_global_search_entity_results_use_named_classes(self):
        styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        search = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "global-search.js"
        ).read_text(encoding="utf-8")
        start = search.index("if (entityResults && entityResults.length > 0)")
        template = search[start : search.index("for (const [path, matches]", start)]

        for class_name in (
            "global-search-entity-header",
            "global-search-entity-title",
            "global-search-entity-badge",
            "global-search-entity-list",
            "global-search-entity-row",
            "global-search-entity-name",
            "global-search-entity-id",
        ):
            self.assertIn(class_name, template)
        for class_name in (
            "global-search-entity-badge",
            "global-search-entity-row",
            "global-search-entity-name",
            "global-search-entity-id",
        ):
            self.assertIn(f".{class_name}", styles)
        self.assertNotIn("style=", template)
        self.assertIn(
            "ui-icon material-icons arrow rotated global-search-file-toggle-icon",
            template,
        )
        self.assertIn("${escapeHtml(e.friendly_name || e.entity_id)}", template)
        self.assertIn("${escapeHtml(e.entity_id)}", template)
        self.assertRegex(
            styles,
            r"\.global-search-entity-row\s*\{[^}]*border-bottom:\s*1px solid var\(--border-color\);[^}]*cursor:\s*pointer;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*font-size:\s*12px;[^}]*padding:\s*6px 12px 6px 34px;",
        )

    def test_editor_search_replace_disclosures_have_keyboard_state(self):
        coordinator = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "UICoordinator.js"
        ).read_text(encoding="utf-8")
        search = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "search.js"
        ).read_text(encoding="utf-8")
        for control_id, controls_id in (
            ("search-toggle-replace", "search-replace-row"),
            ("secondary-search-toggle-replace", "secondary-search-replace-row"),
        ):
            control = re.search(rf'<span[^>]*id="{control_id}"[^>]*>', self.panel)
            self.assertIsNotNone(control)
            self.assertIn('role="button"', control.group(0))
            self.assertIn('tabindex="0"', control.group(0))
            self.assertIn('aria-label="Replace options"', control.group(0))
            self.assertIn(f'aria-controls="{controls_id}"', control.group(0))
            self.assertIn('aria-expanded="false"', control.group(0))
        self.assertIn(
            "const bindSearchReplaceDisclosure = (toggle, widget) =>", coordinator
        )
        self.assertIn('event.key === "Enter" || event.key === " "', coordinator)
        self.assertIn(
            'replaceToggle.setAttribute("aria-expanded", String(replaceMode))', search
        )
        self.assertIn(
            'elements.secondarySearchToggle.setAttribute("aria-expanded", "false")',
            search,
        )

    def test_search_modifiers_expose_pressed_state(self):
        coordinator = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "coordinators"
            / "UICoordinator.js"
        ).read_text(encoding="utf-8")
        for control_id, label in (
            ("btn-match-case", "Match case"),
            ("btn-match-word", "Match whole word"),
            ("btn-use-regex", "Use regular expression"),
            ("search-case-sensitive", "Match case"),
            ("search-whole-word", "Match whole word"),
            ("search-use-regex", "Use regular expression"),
            ("secondary-search-case-sensitive", "Match case"),
            ("secondary-search-whole-word", "Match whole word"),
            ("secondary-search-use-regex", "Use regular expression"),
        ):
            control = re.search(rf'<button[^>]*id="{control_id}"[^>]*>', self.panel)
            self.assertIsNotNone(control)
            self.assertIn(f'aria-label="{label}"', control.group(0))
            self.assertIn('aria-pressed="false"', control.group(0))
        self.assertIn('btn.setAttribute("aria-pressed", String(active))', coordinator)
        self.assertIn(
            "const bindEditorSearchModifier = (stateKey, primaryButton, secondaryButton) =>",
            coordinator,
        )
        self.assertIn(
            'button.setAttribute("aria-pressed", String(pressed))', coordinator
        )

    def test_file_search_has_explicit_accessible_name(self):
        search = re.search(r'<input[^>]*id="file-search"[^>]*>', self.panel)
        self.assertIsNotNone(search)
        self.assertIn('aria-label="Search all files"', search.group(0))

    def test_material_icon_font_is_preloaded(self):
        self.assertRegex(
            self.panel,
            r'<link rel="preload"[^>]*material-icons\.woff2[^>]*as="font"[^>]*type="font/woff2"',
        )

    def test_all_material_icon_elements_use_shared_wrapper(self):
        frontend = ROOT / "custom_components" / "blueprint_studio" / "www"
        icon_element = re.compile(
            r'<[a-z][\w-]*\b[^>]*class=(["\'])(?P<classes>[^"\'<>]*\bmaterial-icons\b[^"\'<>]*)\1[^>]*>',
            re.IGNORECASE,
        )
        icon_assignment = re.compile(
            r'\.className\s*=\s*(["\'])(?P<classes>[^"\']*\bmaterial-icons\b[^"\']*)\1'
        )
        unwrapped = []
        for suffix in ("*.html", "*.js"):
            for path in sorted(frontend.rglob(suffix)):
                source = path.read_text(encoding="utf-8")
                for pattern in (icon_element, icon_assignment):
                    for match in pattern.finditer(source):
                        if "ui-icon" not in match.group("classes").split():
                            line = source.count("\n", 0, match.start()) + 1
                            unwrapped.append(f"{path.relative_to(ROOT)}:{line}")

        self.assertEqual(
            unwrapped, [], "Material Icons without ui-icon: " + ", ".join(unwrapped)
        )

    def test_material_icons_have_no_inline_presentation(self):
        frontend = ROOT / "custom_components" / "blueprint_studio" / "www"
        icon_element = re.compile(
            r'<[a-z][\w-]*\b[^>]*class=(["\'])[^"\'<>]*\bmaterial-icons\b[^"\'<>]*\1[^>]*>',
            re.IGNORECASE,
        )
        inline_icons = []
        for suffix in ("*.html", "*.js"):
            for path in sorted(frontend.rglob(suffix)):
                source = path.read_text(encoding="utf-8")
                for match in icon_element.finditer(source):
                    if re.search(r"\bstyle\s*=", match.group(0), re.IGNORECASE):
                        line = source.count("\n", 0, match.start()) + 1
                        inline_icons.append(f"{path.relative_to(ROOT)}:{line}")

        self.assertEqual(
            inline_icons,
            [],
            "Material Icons with inline presentation: " + ", ".join(inline_icons),
        )

        primitives = PRIMITIVES.read_text(encoding="utf-8")
        for class_name, size in (
            ("ui-icon--size-xs", 14),
            ("ui-icon--size-sm", 16),
            ("ui-icon--size-action", 18),
            ("ui-icon--size-lg", 24),
            ("ui-icon--size-display", 48),
        ):
            self.assertRegex(
                primitives,
                rf"\.{class_name}\s*\{{[^}}]*font-size:\s*{size}px;[^}}]*height:\s*{size}px;[^}}]*width:\s*{size}px;",
            )
        for token in (
            "var(--surface-selected)",
            "var(--content-secondary)",
            "var(--status-success)",
            "var(--status-warning)",
            "var(--status-error)",
            "var(--feature-gitea-color)",
        ):
            self.assertIn(token, primitives)

    def test_settings_and_developer_tool_icons_use_named_presentation(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        styles = UI_COMPONENTS.read_text(encoding="utf-8")
        styled_icon = re.compile(
            r'<[a-z][\w-]*\b[^>]*class=(["\'])[^"\'<>]*\bmaterial-icons\b[^"\'<>]*\1[^>]*\bstyle=',
            re.IGNORECASE,
        )

        for filename in ("settings-ui.js", "dev-tools.js"):
            source = (modules / filename).read_text(encoding="utf-8")
            self.assertIsNone(styled_icon.search(source), filename)

        for class_name in (
            "settings-host-icon",
            "settings-info-icon",
            "settings-external-link-icon",
            "settings-refresh-icon",
            "bdt-action-empty-icon",
            "bdt-button-icon",
            "bdt-toolbar-icon",
            "bdt-section-icon",
        ):
            self.assertIn(f".{class_name}", styles)
        self.assertIn("color: var(--content-secondary);", styles)
        self.assertIn("color: var(--status-info);", styles)

    def test_git_and_gitea_icons_use_named_presentation(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        styles = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "styles"
            / "modules"
            / "git.css"
        ).read_text(encoding="utf-8")
        responsive = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "styles"
            / "modules"
            / "responsive.css"
        ).read_text(encoding="utf-8")
        styled_icon = re.compile(
            r'<[a-z][\w-]*\b[^>]*class=(["\'])[^"\'<>]*\bmaterial-icons\b[^"\'<>]*\1[^>]*\bstyle=',
            re.IGNORECASE,
        )

        for filename in ("git-ui.js", "gitea-ui.js"):
            source = (modules / filename).read_text(encoding="utf-8")
            self.assertIsNone(styled_icon.search(source), filename)

        for class_name in (
            "git-branch-icon",
            "git-sync-icon",
            "git-alert-icon",
            "git-action-icon",
            "git-empty-state-glyph",
            "git-empty-action-icon",
            "git-diff-icon",
            "git-file-group-icon-prominent",
            "gitea-brand-icon",
        ):
            self.assertIn(f".{class_name}", styles)
        self.assertIn("color: var(--success-color);", styles)
        self.assertIn("color: var(--warning-color);", styles)
        self.assertIn("color: #fa8e14;", styles)
        for class_name, size in (
            ("git-branch-icon", 11),
            ("git-empty-state-glyph", 48),
            ("git-file-group-icon-prominent", 18),
        ):
            self.assertRegex(
                styles,
                rf"\.{class_name}\s*\{{[^}}]*font-size:\s*{size}px;[^}}]*height:\s*{size}px;[^}}]*width:\s*{size}px;",
            )
        self.assertRegex(
            styles,
            r"\.git-empty-action-icon,\s*\.git-diff-icon\s*\{[^}]*font-size:\s*16px;[^}]*height:\s*16px;[^}]*width:\s*16px;",
        )
        self.assertRegex(
            styles,
            r"\.git-empty-state \.git-action-icon\s*\{[^}]*font-size:\s*18px;[^}]*height:\s*18px;[^}]*width:\s*18px;",
        )
        self.assertRegex(
            responsive,
            r"\.git-panel-actions\s*\{[^}]*max-width:\s*calc\(100% - 4px\);[^}]*overflow-x:\s*auto;",
        )

    def test_shared_control_primitives_are_loaded_and_used(self):
        self.assertIn(
            "/local/blueprint_studio/styles/modules/primitives.css?v={{VERSION}}",
            self.panel,
        )
        primitives = PRIMITIVES.read_text(encoding="utf-8")
        for token in (
            "--surface-canvas",
            "--content-primary",
            "--border-subtle",
            "--focus-color",
            "--control-height-md",
            "--touch-target-min",
        ):
            self.assertIn(token, primitives)
        self.assertIn(".ui-button", primitives)
        self.assertIn(".ui-icon-button", primitives)
        for control_id in (
            "btn-save",
            "btn-undo",
            "btn-redo",
            "btn-search",
            "btn-validate",
            "btn-app-settings",
        ):
            control = re.search(rf'<button[^>]*id="{control_id}"[^>]*>', self.panel)
            self.assertIsNotNone(control)
            self.assertIn("ui-button", control.group(0))
            self.assertIn("ui-icon-button", control.group(0))
            icon = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*<span class="([^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(icon)
            self.assertIn("ui-icon", icon.group(1).split())
            self.assertIn("material-icons", icon.group(1).split())

    def test_colored_toolbar_icons_use_shared_semantic_tones(self):
        primitives = PRIMITIVES.read_text(encoding="utf-8")
        for token in ("--status-info", "--feature-ai-color"):
            self.assertIn(token, primitives)

        expected_tones = {
            "btn-ai-studio": "ai",
            "btn-restart-ha": "warning",
            "btn-dev-tools": "info",
        }
        for control_id, tone in expected_tones.items():
            icon = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*<span class="([^"]*)"([^>]*)>',
                self.panel,
            )
            self.assertIsNotNone(icon)
            self.assertIn("ui-icon", icon.group(1).split())
            self.assertIn("material-icons", icon.group(1).split())
            self.assertIn(f'data-tone="{tone}"', icon.group(2))
            self.assertNotIn("style=", icon.group(2))

    def test_utility_toolbar_icons_use_shared_wrapper(self):
        for control_id in ("btn-donate", "btn-support", "btn-terminal", "btn-refresh"):
            icon = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*<span class="([^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(icon)
            self.assertIn("ui-icon", icon.group(1).split())
            self.assertIn("material-icons", icon.group(1).split())

    def test_shared_form_primitives_are_defined_and_used_by_explorer(self):
        primitives = PRIMITIVES.read_text(encoding="utf-8")
        for primitive in (".ui-input", ".ui-select", ".ui-checkbox", ".ui-toggle"):
            self.assertIn(primitive, primitives)

        search = re.search(r'<input[^>]*id="file-search"[^>]*>', self.panel)
        self.assertIsNotNone(search)
        self.assertIn("ui-input", search.group(0))

        file_filter = re.search(r'<select[^>]*id="file-filter"[^>]*>', self.panel)
        self.assertIsNotNone(file_filter)
        self.assertIn("ui-select", file_filter.group(0))

    def test_shared_segmented_and_tab_primitives_are_used(self):
        primitives = PRIMITIVES.read_text(encoding="utf-8")
        for primitive in (
            ".ui-segmented-control",
            ".ui-segmented-control__item",
            ".ui-tabs",
            ".ui-tab",
            ".ui-badge",
        ):
            self.assertIn(primitive, primitives)

        search_modes = re.search(
            r'<div[^>]*class="[^"]*explorer-search-modes[^"]*"[^>]*>', self.panel
        )
        self.assertIsNotNone(search_modes)
        self.assertIn("ui-segmented-control", search_modes.group(0))
        for control_id, label, pressed in (
            ("btn-filename-search", "Match File Names", "true"),
            ("btn-content-search", "Match File Content", "false"),
        ):
            control = re.search(rf'<button[^>]*id="{control_id}"[^>]*>', self.panel)
            self.assertIsNotNone(control)
            self.assertIn("ui-segmented-control__item", control.group(0))
            self.assertIn(f'aria-label="{label}"', control.group(0))
            self.assertIn(f'aria-pressed="{pressed}"', control.group(0))

        tabs = re.findall(
            r'<div[^>]*class="[^"]*\bsearch-mode-tab\b[^"]*"[^>]*>', self.panel
        )
        self.assertEqual(len(tabs), 3)
        for tab in tabs:
            self.assertIn("ui-tab", tab)

        translations = TRANSLATIONS_MODULE.read_text(encoding="utf-8")
        self.assertIn(
            'elements.btnFilenameSearch.setAttribute("aria-label"', translations
        )
        self.assertIn(
            'elements.btnContentSearch.setAttribute("aria-label"', translations
        )

    def test_explorer_search_icons_use_shared_wrapper(self):
        for control_id in (
            "file-search-clear",
            "btn-filename-search",
            "btn-content-search",
        ):
            control = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*<span class="([^"]+)"',
                self.panel,
            )
            self.assertIsNotNone(control)
            self.assertIn("ui-icon", control.group(1).split())
            self.assertIn("material-icons", control.group(1).split())

        filter_icon = re.search(
            r'<span class="([^"]+)" id="file-filter-icon">',
            self.panel,
        )
        self.assertIsNotNone(filter_icon)
        self.assertIn("ui-icon", filter_icon.group(1).split())
        self.assertIn("material-icons", filter_icon.group(1).split())

    def test_explorer_selection_actions_use_shared_wrappers(self):
        for control_id in (
            "btn-download-selected",
            "btn-delete-selected",
            "btn-cancel-selection",
        ):
            control = re.search(
                rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-button", control.group("classes").split())
            self.assertIn("ui-icon-button", control.group("classes").split())
            self.assertIn("ui-icon", control.group("icon_classes").split())
            self.assertIn("material-icons", control.group("icon_classes").split())

    def test_shared_feedback_primitives_are_defined_and_used(self):
        primitives = PRIMITIVES.read_text(encoding="utf-8")
        for primitive in (
            ".ui-progress",
            ".ui-skeleton",
            ".ui-empty-state",
            ".ui-alert",
            ".ui-toast-region",
            ".ui-toast",
            ".ui-progress-overlay",
            ".ui-progress-spinner",
        ):
            self.assertIn(primitive, primitives)

        self.assertIn('class="ui-toast-region toast-container"', self.panel)
        self.assertIn('class="ui-progress-overlay loading-overlay visible"', self.panel)
        self.assertIn('class="ui-progress-spinner loading-spinner"', self.panel)
        self.assertGreaterEqual(self.panel.count("ui-empty-state"), 3)
        self.assertIn(
            "toast.className = `ui-toast toast ${type}`", self.feedback_service
        )
        self.assertIn(
            'statusIcon.className = "ui-icon material-icons toast-status-icon"',
            self.feedback_service,
        )
        self.assertIn(
            'closeIcon.className = "ui-icon material-icons toast-dismiss-icon"',
            self.feedback_service,
        )
        self.assertEqual(
            self.ui_module.count('class="ui-skeleton skeleton file-skeleton"'), 5
        )

    def test_feedback_service_owns_notification_and_operation_state(self):
        zip_progress = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "zip-progress.js"
        ).read_text(encoding="utf-8")

        for contract in (
            "export function notify(",
            "export function showGlobalPending(",
            "export function hideGlobalPending(",
            "export function setControlPending(",
            "export function updateOperationFeedback(",
            "export function removeOperationFeedback(",
            'toast.setAttribute("role", type === "error" ? "alert" : "status")',
            'track.setAttribute("aria-valuenow"',
            'stack.setAttribute("aria-label", "Operations")',
        ):
            self.assertIn(contract, self.feedback_service)

        self.assertIn(
            "return notify(message, { type, duration, action });", self.ui_module
        )
        self.assertIn("showGlobalPending(message);", self.ui_module)
        self.assertIn("hideGlobalPending();", self.ui_module)
        self.assertIn("setControlPending(button, isLoading);", self.ui_module)
        self.assertIn(
            "import { removeOperationFeedback, updateOperationFeedback } from './feedback-service.js?v=2.5.188';",
            zip_progress,
        )
        self.assertNotIn('document.createElement("div")', zip_progress)
        self.assertNotIn("activeToastKeys", self.ui_module)

    def test_operation_center_keeps_bounded_transfer_history_and_scope(self):
        downloads = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "downloads-uploads.js"
        ).read_text(encoding="utf-8")
        zip_progress = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "zip-progress.js"
        ).read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "ui-components.css").read_text(encoding="utf-8")

        for contract in (
            "operationRecords",
            "MAX_OPERATION_HISTORY = 24",
            "operation-center-header",
            "operation-center-list",
            "operation-group-active",
            "operation-group-recent",
            "operation-elapsed",
            "export function clearCompletedOperations",
            "formatElapsed",
            "track.hidden = terminal",
        ):
            self.assertIn(contract, self.feedback_service)
        self.assertIn("bottom: calc(46px + env(safe-area-inset-bottom));", styles)
        for contract in ('scope: "Local Home Assistant"', 'target: "This device"', 'scope: isSftp ? `SFTP ${connId}`'):
            self.assertIn(contract, downloads)
        for default in ('scope = ""', 'target = ""'):
            self.assertIn(default, zip_progress)
        self.assertNotIn("setTimeout(() => removeOperationFeedback", zip_progress)
        for selector in (".operation-center-header", ".operation-center-list", ".operation-status", ".operation-scope"):
            self.assertIn(selector, styles)
        self.assertIn('document.body.classList.add("operation-center-open")', self.feedback_service)
        self.assertIn('document.body.classList.remove("operation-center-open")', self.feedback_service)
        self.assertIn('.operation-center-open .toast-container', styles)
        self.assertIn('top: calc(12px + env(safe-area-inset-top))', styles)

    def test_uploads_confirm_local_or_remote_destination_before_starting(self):
        downloads = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "downloads-uploads.js"
        ).read_text(encoding="utf-8")

        for contract in (
            "function uploadDestinationMarkup",
            "async function confirmUploadDestination",
            "Remote SFTP · ${escapeMarkup(connectionName)}",
            "Local Home Assistant",
            "Destination · ${escapeMarkup(localConfigPath(path))}",
            "if (!confirmed) return;",
            'if (!confirmed) {\n    event.target.value = "";',
        ):
            self.assertIn(contract, downloads)

        regular_confirmation = downloads.index("const confirmed = await confirmUploadDestination({", downloads.index("export async function processUploads"))
        regular_progress = downloads.index("const progress = startUploadProgress({", regular_confirmation)
        folder_confirmation = downloads.index("const confirmed = await confirmUploadDestination({", downloads.index("export async function handleFolderUpload"))
        folder_progress = downloads.index("const progress = startUploadProgress({", folder_confirmation)
        self.assertLess(regular_confirmation, regular_progress)
        self.assertLess(folder_confirmation, folder_progress)

    def test_operation_center_supports_details_actions_and_validation(self):
        coordinator = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
            / "coordinators" / "UICoordinator.js"
        ).read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "ui-components.css").read_text(encoding="utf-8")

        for contract in (
            "operation-details-text",
            "operation-actions",
            "Array.isArray(options.actions)",
            "Promise.resolve(action.callback())",
            "normalizeDetail(options.failureDetail)",
        ):
            self.assertIn(contract, self.feedback_service)
        for contract in (
            "updateOperationFeedback(operationId",
            "failureDetail: failureDetail || errorToastMsg",
            "restoreValidatedView();",
            "callback: retryValidation",
            "callback: openValidatedFile",
            "scope: 'Document'",
        ):
            self.assertIn(contract, coordinator)
        for selector in (".operation-details", ".operation-details-text", ".operation-actions", ".operation-action", ".operation-group-heading"):
            self.assertIn(selector, styles)

    def test_upload_operations_expose_real_cancel_and_retry_outcomes(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        downloads = (modules / "downloads-uploads.js").read_text(encoding="utf-8")
        zip_progress = (modules / "zip-progress.js").read_text(encoding="utf-8")
        sftp = (modules / "sftp.js").read_text(encoding="utf-8")

        for contract in (
            "const uploadController = new AbortController();",
            "onCancel: () => uploadController.abort()",
            "onRetry: () => processUploads(uploadFiles, targetFolder)",
            'progress.cancel(successCount',
            'new DOMException("Upload cancelled", "AbortError")',
            'signal?.addEventListener("abort", abortUpload, { once: true })',
        ):
            self.assertIn(contract, downloads)
        for contract in (
            'label: "Cancel"',
            'message: "Cancelling upload request..."',
            'status: "cancelled"',
            'Files completed before cancellation remain at the destination.',
            'label: "Retry"',
            'openLabel = "Show"',
            'openIcon = "folder_open"',
            "actions: terminalActions()",
            "actions: terminalActions(true)",
        ):
            self.assertIn(contract, zip_progress)
        for contract in (
            "async function showUploadDestination",
            'eventBus.emit("ui:switch-sidebar-view", "explorer")',
            'eventBus.emit("ui:switch-sidebar-view", "sftp")',
            "await connectToServer(connId)",
            "await navigateSftp(connId, path || \"/\")",
            'await revealAndOpenFile(localWorkspacePath(path), "navigate")',
            "onOpen: () => showUploadDestination({",
        ):
            self.assertIn(contract, downloads)
        self.assertIn("requestOptions = {}", sftp)
        self.assertIn("}, { signal });", sftp)

    def test_zip_operations_expose_cooperative_server_cancellation(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        zip_progress = (modules / "zip-progress.js").read_text(encoding="utf-8")

        for contract in (
            'body: JSON.stringify({ action: "cancel_zip", progress_id: progressId })',
            'label: "Cancel"',
            'status: "cancelling"',
            'progress.status === "cancelled"',
            'await cancelZip(progressId);',
        ):
            self.assertIn(contract, zip_progress)

    def test_operation_center_tracks_git_and_gitea_remote_work(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        git_operations = (modules / "git-operations.js").read_text(encoding="utf-8")
        gitea = (modules / "gitea-integration.js").read_text(encoding="utf-8")

        self.assertIn("export function startOperationFeedback(options = {})", self.feedback_service)
        for source, provider in ((git_operations, "GitHub"), (gitea, "Gitea")):
            self.assertIn("startOperationFeedback({", source)
            self.assertIn(f"scope: '{provider} repository'", source)
            self.assertIn("open: () => eventBus.emit('ui:switch-sidebar-view', 'source-control')", source)
            self.assertGreaterEqual(source.count("operation.finish("), 3)
            self.assertGreaterEqual(source.count("operation.fail("), 3)
        for label in ("Pull from GitHub", "Push to GitHub", "Pull from Gitea", "Push to Gitea"):
            self.assertIn(label, git_operations + gitea)
        self.assertIn("await Promise.all(eventBus.emit('git:commit-staged').filter(Boolean))", git_operations)
        coordinator = (modules / "coordinators" / "GitCoordinator.js").read_text(encoding="utf-8")
        self.assertIn("return functions.commitStagedFiles();", coordinator)

    def test_remote_repository_creation_uses_persistent_scoped_operations(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        github = (modules / "github-integration.js").read_text(encoding="utf-8")
        gitea = (modules / "gitea-integration.js").read_text(encoding="utf-8")

        for source, provider in ((github, "GitHub"), (gitea, "Gitea")):
            creation = source[source.index(f"export async function {provider.lower()}CreateRepo"):]
            self.assertIn("const request = Object.freeze({", creation)
            self.assertIn(f"label: 'Create {provider} repository'", creation)
            self.assertIn("target: `${request.repoName} (${visibility})`", creation)
            self.assertIn("openLabel: 'Source Control'", creation)
            self.assertIn("operation.finish('Repository created')", creation)
            self.assertIn("operation.fail('Repository creation failed', message)", creation)
            self.assertIn("repo_name: request.repoName", creation)
        self.assertIn("scope: 'GitHub account'", github)
        self.assertIn("serverLabel = `Gitea ${new URL(request.giteaUrl).host}`", gitea)
        self.assertIn("request.giteaUrl", gitea)

    def test_operation_center_tracks_local_git_branch_work(self):
        git_operations = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "git-operations.js"
        ).read_text(encoding="utf-8")

        self.assertIn("function startBranchOperation(", git_operations)
        self.assertIn("scope: 'Local Git repository'", git_operations)
        self.assertIn("() => gitCheckoutBranch(branch)", git_operations)
        self.assertIn("() => runGitCreateBranch(name)", git_operations)
        self.assertIn("() => gitDeleteLocalBranch(branch, force)", git_operations)
        self.assertIn("() => gitMergeBranch(branch)", git_operations)
        self.assertIn("return runGitCreateBranch(name.trim())", git_operations)
        self.assertIn("return runGitDeleteLocalBranch(branch, force)", git_operations)
        self.assertGreaterEqual(git_operations.count("operation.finish("), 7)
        self.assertGreaterEqual(git_operations.count("operation.fail("), 10)
        for loading in (
            "showGlobalLoading(`Switching to",
            "showGlobalLoading(`Creating branch",
            "showGlobalLoading(`Deleting '${branch}'",
            "showGlobalLoading(`Merging",
        ):
            self.assertNotIn(loading, git_operations)

    def test_sftp_mutations_use_persistent_scoped_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "sftp.js"
        ).read_text(encoding="utf-8")
        mutation_slice = source[
            source.index("function _sftpMutationLabel"):
            source.index("async function _promptDelete")
        ]

        for contract in (
            "async function _runSftpMutation(request)",
            "startOperationFeedback({",
            "scope: `SFTP ${request.connectionName}`",
            "target: `${request.source} -> ${request.destination}`",
            "retry: () => _confirmSftpMutationRetry(request)",
            "open: () => _browseSftpMutation(request.connId, request.destination)",
            "openLabel: 'Browse'",
            "If the destination now exists, it will be replaced.",
            "operation.fail(`${label} failed`, message)",
            "operation.finish(`${label} complete`",
            "state.activeSftp.connectionId === request.connId",
            "oldTab.path = buildSftpPath(request.connId, request.destination)",
        ):
            self.assertIn(contract, mutation_slice)
        self.assertGreaterEqual(source.count("await _runSftpMutation({"), 3)

    def test_single_deletes_use_persistent_irreversible_operations(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        local = (modules / "file-operations.js").read_text(encoding="utf-8")
        remote = (modules / "sftp.js").read_text(encoding="utf-8")
        ui = (modules / "file-operations-ui.js").read_text(encoding="utf-8")
        coordinator = (modules / "coordinators" / "FileCoordinator.js").read_text(encoding="utf-8")
        local_delete = local[
            local.index("async function browseLocalDelete"):
            local.index("export async function copyItem")
        ]
        remote_delete = remote[
            remote.index("async function _promptDelete"):
            remote.index("function _attachDialogEvents")
        ]

        for contract in (
            "async function runDeleteItem(request)",
            "label: `Delete local ${item}`",
            "scope: 'Local Home Assistant workspace'",
            "target: request.path",
            "retry: () => confirmDeleteItem(request)",
            "open: () => browseLocalDelete(request.path)",
            "A previous recursive attempt may already have removed some contents.",
            "Some contents may already be deleted. No changes were rolled back.",
            "operation.finish(`Deleted ${request.path}`",
            "if (!response?.success) throw new Error",
        ):
            self.assertIn(contract, local_delete)
        for contract in (
            "async function _runSftpDelete(request)",
            "label: `Delete remote ${item}`",
            "scope: `SFTP ${request.connectionName}`",
            "target: request.remotePath",
            "retry: () => _confirmSftpDeleteRetry(request)",
            "open: () => _browseSftpMutation(request.connId, request.remotePath)",
            "A previous recursive attempt may already have removed some contents.",
            "Some contents may already be deleted. No changes were rolled back.",
            "operation.finish(`Deleted ${request.remotePath}`",
            "state.activeSftp.connectionId === request.connId",
        ):
            self.assertIn(contract, remote_delete)
        self.assertIn("eventBus.emit('file:delete', { path, isFolder })", ui)
        self.assertIn("deleteItemImpl(data.path, data.isFolder)", coordinator)
        self.assertLess(
            local_delete.index("if (!response?.success)"),
            local_delete.index("tabsToClose.forEach"),
        )
        self.assertLess(
            remote_delete.index("if (!result.success)"),
            remote_delete.index("tabsToClose.forEach"),
        )

    def test_local_copy_uses_persistent_atomic_staged_operation(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        source = (modules / "file-operations.js").read_text(encoding="utf-8")
        ui = (modules / "file-operations-ui.js").read_text(encoding="utf-8")
        coordinator = (modules / "coordinators" / "FileCoordinator.js").read_text(encoding="utf-8")
        backend = (
            ROOT / "custom_components" / "blueprint_studio" / "backend" / "file_manager.py"
        ).read_text(encoding="utf-8")
        copy_slice = source[
            source.index("async function browseLocalCopy"):
            source.index("export async function renameItem")
        ]

        for contract in (
            "async function runCopyItem(request)",
            "label: `Copy local ${item}`",
            "scope: 'Local Home Assistant workspace'",
            "target: `${request.source} -> ${request.destination}`",
            "retry: () => confirmCopyItem(request)",
            "open: () => browseLocalCopy(request.destination)",
            "openLabel: 'Browse Destination'",
            "it will be replaced after the new copy is fully staged",
            "Object.freeze({ ...request, overwrite: true })",
            "operation.fail(`Could not copy ${request.source}`, message)",
            "operation.finish(`Copied ${request.source}`",
        ):
            self.assertIn(contract, copy_slice)
        self.assertEqual(ui.count("'file:copy', { oldPath: path, newPath"), 2)
        self.assertGreaterEqual(ui.count("isFolder"), 2)
        self.assertIn("copyItemImpl(data.oldPath, data.newPath, data.overwrite, data.isFolder)", coordinator)
        for contract in (
            "def _copy_path_staged(",
            "source in destination.parents",
            "shutil.copytree(source, staged)",
            "destination.rename(backup)",
            "staged.rename(destination)",
            "backup.rename(destination)",
            "_copy_path_staged, src, dest, overwrite",
        ):
            self.assertIn(contract, backend)

    def test_single_file_downloads_use_persistent_origin_scoped_operations(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        downloads = (modules / "downloads-uploads.js").read_text(encoding="utf-8")
        sftp = (modules / "sftp.js").read_text(encoding="utf-8")
        download_slice = downloads[
            downloads.index("async function showDownloadSource"):
            downloads.index("export function downloadContent")
        ]

        for contract in (
            "function downloadRequest(path)",
            "async function runFileDownload(request)",
            "scope: 'Local Home Assistant workspace'",
            "scope: `SFTP ${connection?.name || connId}`",
            "target: `${request.source} -> Browser downloads`",
            "retry: () => runFileDownload(request)",
            "open: () => showDownloadSource(request)",
            "openLabel: 'Open Source'",
            "operation.finish(`Download started for ${request.filename}`",
            "The browser owns the download destination and completion state.",
            "operation.fail(`Could not prepare ${request.filename}`, message)",
            "eventBus.emit('tab:open', { tab: openTab, noActivate: false })",
            "await navigateSftp(request.connId, parentPath(request.remotePath) || '/')",
            "await revealAndOpenFile(request.path, 'navigate')",
        ):
            self.assertIn(contract, download_slice)
        self.assertNotIn("showToast(`Downloaded ${filename}`", download_slice)
        sftp_download = sftp[
            sftp.index("async function _downloadFile"):
            sftp.index("async function _downloadFolder")
        ]
        self.assertIn("await downloadFileByPath(buildSftpPath(connId, remotePath))", sftp_download)
        self.assertNotIn("sftpStreamUrl", sftp_download)

    def test_github_settings_verify_identity_and_long_errors_expand(self):
        github = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "github-integration.js"
        ).read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "ui-components.css").read_text(encoding="utf-8")

        self.assertIn('action: "git_get_credentials", verify: true', github)
        self.assertIn("credentialsData.authenticated === true", github)
        self.assertIn("Connected to GitHub as", github)
        self.assertIn("Saved credentials could not be verified", github)
        self.assertIn("GitHub authentication is no longer valid", github)
        self.assertNotIn("You are logged in as", github)
        self.assertNotIn('t("toast.gitea_', github)
        self.assertNotIn('t("gitea.', github)
        self.assertIn('t("toast.github_create_repo_failed"', github)
        self.assertIn('t("toast.github_error"', github)
        self.assertIn("if (state.isMobile) {", github)
        self.assertNotIn("state.isMobile()", github)
        self.assertNotIn("compactMessage", self.feedback_service)
        self.assertIn('type === "error" || displayMessage.length > 64', self.feedback_service)
        for contract in (
            'expandButton.className = "toast-expand-btn"',
            'expandButton.setAttribute("aria-expanded", "false")',
            'toast.classList.toggle("expanded")',
            "clearTimeout(dismissTimer)",
        ):
            self.assertIn(contract, self.feedback_service)
        for selector in (".toast.expanded .toast-message", ".toast-expand-btn", ".git-auth-status"):
            self.assertIn(selector, styles)

    def test_component_showcase_reuses_shared_production_boundaries(self):
        for stylesheet in (
            "./styles/modules/base.css",
            "./styles/modules/primitives.css",
            "./styles/modules/ui-components.css",
            "./styles/component-showcase.css",
        ):
            self.assertIn(f'href="{stylesheet}"', self.component_showcase)

        for primitive in (
            "ui-button",
            "ui-icon-button",
            "ui-input",
            "ui-select",
            "ui-checkbox",
            "ui-segmented-control",
            "ui-tabs",
            "ui-menu",
            "ui-badge",
            "ui-progress",
            "ui-skeleton",
            "ui-empty-state",
            "ui-alert",
            "ui-toast-region",
            "ui-dialog",
        ):
            self.assertIn(primitive, self.component_showcase)

        self.assertIn('src="./modules/component-showcase.js"', self.component_showcase)
        self.assertIn(
            '<html lang="en" class="component-showcase-root">', self.component_showcase
        )
        self.assertNotIn("modules/main.js", self.component_showcase)
        self.assertNotIn("/api/blueprint_studio", self.component_showcase)
        self.assertNotRegex(self.component_showcase, r'\sstyle="')

    def test_component_showcase_has_accessible_interactive_states(self):
        for contract in (
            'role="group" aria-label="Showcase theme"',
            'role="tablist" aria-label="Workspace views"',
            'role="menu" aria-label="File actions"',
            'role="region" aria-label="Notifications" aria-live="polite"',
            'role="dialog" aria-modal="true" aria-labelledby="showcase-dialog-title"',
            'aria-busy="true"',
            'data-status="success" role="status"',
            'data-status="error" role="alert"',
        ):
            self.assertIn(contract, self.component_showcase)

        self.assertIn(
            'import { closeDialog, openDialog } from "./dialog-manager.js";',
            self.component_showcase_module,
        )
        self.assertIn(
            'import { notify } from "./feedback-service.js";',
            self.component_showcase_module,
        )
        self.assertIn(
            'import { initTooltips } from "./tooltip.js";',
            self.component_showcase_module,
        )
        self.assertIn("returnFocus: dialogTrigger", self.component_showcase_module)

    def test_component_showcase_has_stable_responsive_layout(self):
        for contract in (
            "grid-template-columns: repeat(2, minmax(0, 1fr));",
            "grid-template-columns: repeat(3, minmax(0, 1fr));",
            "@media (max-width: 800px)",
            "@media (max-width: 480px)",
            "grid-template-columns: minmax(0, 1fr);",
            "@media (prefers-reduced-motion: reduce)",
            ".component-showcase-root",
        ):
            self.assertIn(contract, self.component_showcase_styles)

    def test_shared_menu_and_tooltip_primitives_are_used(self):
        primitives = PRIMITIVES.read_text(encoding="utf-8")
        for primitive in (".ui-menu", ".ui-menu__item", ".ui-tooltip"):
            self.assertIn(primitive, primitives)

        menu = re.search(r'<div[^>]*id="theme-menu"[^>]*>', self.panel)
        self.assertIsNotNone(menu)
        self.assertIn("ui-menu", menu.group(0))
        menu_items = re.findall(
            r'<div[^>]*class="[^"]*\btheme-menu-item\b[^"]*"[^>]*>', self.panel
        )
        self.assertGreaterEqual(len(menu_items), 10)
        for item in menu_items:
            self.assertIn("ui-menu__item", item)

        save = re.search(r'<button[^>]*id="btn-save"[^>]*>', self.panel)
        self.assertIsNotNone(save)
        self.assertIn("ui-tooltip", save.group(0))
        self.assertIn('aria-label="Save"', save.group(0))
        self.assertIn('data-tooltip="Save (Ctrl+S)"', save.group(0))
        translations = TRANSLATIONS_MODULE.read_text(encoding="utf-8")
        self.assertIn(
            'setToolbarControlLabel(elements.btnSave, t("toolbar.save"))', translations
        )
        tooltip = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "tooltip.js"
        ).read_text(encoding="utf-8")
        initialization = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "initialization.js"
        ).read_text(encoding="utf-8")
        self.assertIn('tooltip.setAttribute("role", "tooltip")', tooltip)
        self.assertIn('trigger.setAttribute("aria-describedby", TOOLTIP_ID)', tooltip)
        self.assertIn('root.addEventListener("pointerover"', tooltip)
        self.assertIn('root.addEventListener("focusin"', tooltip)
        self.assertIn("initTooltips();", initialization)

    def test_toolbar_tooltips_and_disabled_reasons_have_one_owner(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        toolbar = (modules / "toolbar.js").read_text(encoding="utf-8")
        tooltip = (modules / "tooltip.js").read_text(encoding="utf-8")
        initialization = (modules / "initialization.js").read_text(encoding="utf-8")
        translations = TRANSLATIONS_MODULE.read_text(encoding="utf-8")

        self.assertIn("export function initializeToolbarControls", toolbar)
        self.assertIn("export function setToolbarControlLabel", toolbar)
        self.assertIn("export function setToolbarControlAvailability", toolbar)
        self.assertIn(
            "toolbar.querySelectorAll(':scope > .toolbar-group > button')", toolbar
        )
        self.assertIn("control.classList.add('ui-tooltip')", toolbar)
        self.assertIn("control.removeAttribute('title')", toolbar)
        self.assertIn("control.dataset.disabledReason", toolbar)
        for reason in (
            "Open a file to save it",
            "The active file has no unsaved changes",
            "No open files have unsaved changes",
            "There is nothing to undo",
            "There is nothing to redo",
            "Open a file to download it",
        ):
            self.assertIn(reason, toolbar)

        self.assertIn("initializeToolbarControls();", initialization)
        self.assertGreaterEqual(translations.count("setToolbarControlLabel("), 25)
        self.assertNotIn("trigger.disabled", tooltip)

    def test_shared_dialog_and_panel_primitives_are_used(self):
        primitives = PRIMITIVES.read_text(encoding="utf-8")
        for primitive in (
            ".ui-dialog",
            ".ui-dialog__header",
            ".ui-dialog__body",
            ".ui-dialog__footer",
            ".ui-panel",
        ):
            self.assertIn(primitive, primitives)

        dialog = re.search(r'<div[^>]*id="modal"[^>]*>', self.panel)
        self.assertIsNotNone(dialog)
        self.assertIn("ui-dialog", dialog.group(0))
        self.assertIn('role="dialog"', dialog.group(0))
        self.assertIn('aria-modal="true"', dialog.group(0))
        self.assertIn('class="ui-dialog__header modal-header"', self.panel)
        self.assertIn('class="ui-dialog__body modal-body"', self.panel)
        self.assertIn('class="ui-dialog__footer modal-footer"', self.panel)

        explorer = re.search(r'<div[^>]*id="view-explorer"[^>]*>', self.panel)
        self.assertIsNotNone(explorer)
        self.assertIn("ui-panel", explorer.group(0))

    def test_editor_command_toolbar_icons_use_shared_wrapper(self):
        for control_id in (
            "btn-save-all",
            "btn-format",
            "btn-split-vertical",
            "btn-split-close",
        ):
            control = re.search(
                rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control)
            self.assertIn("ui-button", control.group("classes"))
            self.assertIn("ui-icon-button", control.group("classes"))
            self.assertIn("ui-icon", control.group("icon_classes"))
            self.assertIn("material-icons", control.group("icon_classes"))

    def test_workspace_file_toolbar_icons_use_shared_wrapper(self):
        for control_id in ("btn-menu", "btn-new-file", "btn-new-folder"):
            control = re.search(
                rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control)
            self.assertIn("ui-button", control.group("classes"))
            self.assertIn("ui-icon-button", control.group("classes"))
            self.assertIn("ui-icon", control.group("icon_classes"))
            self.assertIn("material-icons", control.group("icon_classes"))

    def test_explorer_state_toolbar_icons_use_shared_wrapper(self):
        for control_id in (
            "btn-show-hidden",
            "btn-toggle-select",
            "btn-collapse-all-folders",
        ):
            control = re.search(
                rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control)
            self.assertIn("ui-button", control.group("classes"))
            self.assertIn("ui-icon-button", control.group("classes"))
            self.assertIn("ui-icon", control.group("icon_classes"))
            self.assertIn("material-icons", control.group("icon_classes"))

    def test_editor_mode_toolbar_icons_use_shared_wrapper(self):
        for control_id in ("btn-one-tab-mode", "btn-use-blueprint"):
            control = re.search(
                rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-button", control.group("classes"))
            self.assertIn("ui-icon-button", control.group("classes"))
            self.assertIn("ui-icon", control.group("icon_classes"))
            self.assertIn("material-icons", control.group("icon_classes"))

    def test_transfer_toolbar_icons_use_shared_wrapper(self):
        for control_id in (
            "btn-upload",
            "btn-download",
            "btn-upload-folder",
            "btn-download-folder",
        ):
            control = re.search(
                rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-button", control.group("classes"))
            self.assertIn("ui-icon-button", control.group("classes"))
            self.assertIn("ui-icon", control.group("icon_classes"))
            self.assertIn("material-icons", control.group("icon_classes"))

    def test_editor_context_icons_use_shared_wrapper(self):
        for control_id in ("breadcrumb-copy", "btn-markdown-preview"):
            control = re.search(
                rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-button", control.group("classes"))
            self.assertIn("ui-icon-button", control.group("classes"))
            self.assertIn("ui-icon", control.group("icon_classes"))
            self.assertIn("material-icons", control.group("icon_classes"))

    def test_gitea_settings_icon_uses_shared_semantic_tone(self):
        primitives = PRIMITIVES.read_text(encoding="utf-8")
        self.assertIn("--feature-gitea-color", primitives)
        self.assertIn('.ui-icon[data-tone="gitea"]', primitives)

        control = re.search(
            r'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="btn-gitea-settings"[^>]*>\s*'
            r'<span class="(?P<icon_classes>[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(control)
        self.assertIn("ui-button", control.group("classes"))
        self.assertIn("ui-icon-button", control.group("classes"))
        self.assertIn("ui-icon", control.group("icon_classes"))
        self.assertIn("material-icons", control.group("icon_classes"))
        self.assertIn('data-tone="gitea"', control.group("attributes"))
        self.assertNotIn("style=", control.group("attributes"))

    def test_source_control_panel_actions_use_shared_wrappers(self):
        for provider in ("git", "gitea"):
            for action in ("branches", "help", "history", "refresh", "collapse"):
                control_id = f"btn-{provider}-{action}"
                control = re.search(
                    rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                    r'<span class="(?P<icon_classes>[^"]*)"(?P<attributes>[^>]*)>',
                    self.panel,
                )
                self.assertIsNotNone(control, control_id)
                self.assertIn("ui-button", control.group("classes"))
                self.assertIn("ui-icon-button", control.group("classes"))
                self.assertIn("git-panel-btn", control.group("classes"))
                self.assertIn("ui-icon", control.group("icon_classes"))
                self.assertIn("material-icons", control.group("icon_classes"))
                self.assertNotIn("style=", control.group("attributes"))

        git_styles = GIT_STYLES.read_text(encoding="utf-8")
        self.assertRegex(
            git_styles,
            r"\.git-panel-btn\s*\{[^}]*min-height:\s*28px;[^}]*min-width:\s*28px;[^}]*width:\s*28px;[^}]*padding:\s*0;",
        )
        self.assertRegex(
            git_styles,
            r"\.git-panel-btn \.ui-icon\s*\{[^}]*font-size:\s*18px;[^}]*height:\s*18px;[^}]*width:\s*18px;",
        )
        for control_id in ("btn-git-collapse", "btn-gitea-collapse"):
            collapse = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*<span class="([^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(collapse, control_id)
            self.assertIn("git-panel-collapse-icon", collapse.group(1))

    def test_gitea_panel_brand_icons_use_shared_semantic_tone(self):
        for icon_class in ("gitea-panel-title-icon", "gitea-empty-state-icon"):
            icon = re.search(
                rf'<span class="(?P<classes>[^"]*\b{icon_class}\b[^"]*)"'
                r"(?P<attributes>[^>]*)>",
                self.panel,
            )
            self.assertIsNotNone(icon, icon_class)
            self.assertIn("ui-icon", icon.group("classes"))
            self.assertIn("material-icons", icon.group("classes"))
            self.assertIn('data-tone="gitea"', icon.group("attributes"))
            self.assertNotIn("style=", icon.group("attributes"))

    def test_sidebar_header_icons_use_shared_wrapper(self):
        for control_id in (
            "btn-sftp-add",
            "btn-sftp-refresh",
            "btn-refresh-search",
            "btn-collapse-search",
        ):
            control = re.search(
                rf'<button[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("sidebar-header-btn", control.group("classes"))
            self.assertNotIn("ui-button", control.group("classes"))
            self.assertIn("ui-icon", control.group("icon_classes"))
            self.assertIn("material-icons", control.group("icon_classes"))

    def test_explorer_folder_navigation_icons_use_shared_wrapper(self):
        for control_id in ("btn-nav-back", "btn-file-tree-collapse"):
            control = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<icon_classes>[^"]*)">',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-icon", control.group("icon_classes"))
            self.assertIn("material-icons", control.group("icon_classes"))

        static_home = re.search(
            r'<span[^>]*class="breadcrumb-item breadcrumb-home"[^>]*>\s*'
            r'<span class="(?P<icon_classes>[^"]*)">',
            self.panel,
        )
        self.assertIsNotNone(static_home)
        self.assertIn("ui-icon", static_home.group("icon_classes"))
        self.assertIn("material-icons", static_home.group("icon_classes"))

        file_tree = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "file-tree.js"
        ).read_text(encoding="utf-8")
        self.assertIn('<span class="ui-icon material-icons">home</span>', file_tree)

    def test_editor_search_disclosure_icons_use_shared_wrapper(self):
        for control_id in (
            "search-toggle-replace",
            "secondary-search-toggle-replace",
        ):
            control = re.search(
                rf'<span[^>]*class="(?P<classes>[^"]*)"[^>]*id="{control_id}"[^>]*>',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-icon", control.group("classes"))
            self.assertIn("material-icons", control.group("classes"))
            self.assertIn("search-toggle-icon", control.group("classes"))

    def test_global_search_disclosure_icon_uses_shared_wrapper(self):
        control = re.search(
            r'<span[^>]*class="(?P<classes>[^"]*)"[^>]*id="btn-toggle-replace-all"'
            r"(?P<attributes>[^>]*)>",
            self.panel,
        )
        self.assertIsNotNone(control)
        self.assertIn("ui-icon", control.group("classes"))
        self.assertIn("material-icons", control.group("classes"))
        self.assertIn("global-replace-toggle", control.group("classes"))
        self.assertNotIn("style=", control.group("attributes"))

    def test_global_replace_all_action_icon_uses_shared_wrapper(self):
        control = re.search(
            r'<button[^>]*id="btn-global-replace-all"[^>]*>\s*'
            r'<span class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(control)
        self.assertIn("ui-icon", control.group("classes"))
        self.assertIn("material-icons", control.group("classes"))
        self.assertNotIn("style=", control.group("attributes"))

    def test_editor_replace_action_icons_use_shared_wrapper(self):
        for control_id in (
            "search-replace",
            "search-replace-all",
            "secondary-search-replace",
            "secondary-search-replace-all",
        ):
            control = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-icon", control.group("classes"))
            self.assertIn("material-icons", control.group("classes"))
            self.assertIn("search-replace-action-icon", control.group("classes"))
            self.assertNotIn("style=", control.group("attributes"))

    def test_editor_search_navigation_icons_use_shared_wrapper(self):
        for control_id in (
            "search-prev",
            "search-next",
            "search-close",
            "secondary-search-prev",
            "secondary-search-next",
            "secondary-search-close",
        ):
            control = re.search(
                rf'<button[^>]*id="{control_id}"[^>]*>\s*'
                r'<span class="(?P<classes>[^"]*)"(?P<attributes>[^>]*)>',
                self.panel,
            )
            self.assertIsNotNone(control, control_id)
            self.assertIn("ui-icon", control.group("classes"))
            self.assertIn("material-icons", control.group("classes"))
            self.assertIn("search-navigation-icon", control.group("classes"))
            self.assertNotIn("style=", control.group("attributes"))

    def test_editor_replace_spacers_are_not_material_icons(self):
        spacers = re.findall(
            r'<span class="(?P<classes>[^"]*\bsearch-spacer\b[^"]*)"[^>]*></span>',
            self.panel,
        )
        self.assertEqual(len(spacers), 2)
        for classes in spacers:
            self.assertNotIn("material-icons", classes.split())
            self.assertNotIn("ui-icon", classes.split())

    def test_dialog_manager_owns_focus_dismissal_and_scroll_containment(self):
        for contract in (
            "export function openDialog(",
            "export function closeDialog(",
            "export function closeTopDialog(",
            "export function hasOpenDialog(",
            "event.key === 'Escape'",
            "event.key !== 'Tab'",
            "entry.returnFocus.focus()",
            "event.target !== entry.overlay",
            "classList.toggle('dialog-open'",
        ):
            self.assertIn(contract, self.dialog_manager)

    def test_dialog_families_use_shared_manager(self):
        module_dir = UI_MODULE.parent
        managed_modules = (
            "ui.js",
            "dialogs.js",
            "command-palette.js",
            "user-guide.js",
            "sftp.js",
            "file-operations-ui.js",
            "initialization.js",
            "settings-ui.js",
            "git-diff.js",
            "github-integration.js",
            "gitea-integration.js",
        )
        for filename in managed_modules:
            source = (module_dir / filename).read_text(encoding="utf-8")
            self.assertRegex(source, r"(?:openDialog|activateSharedModal)\(", filename)

        all_modules = "\n".join(
            path.read_text(encoding="utf-8")
            for path in module_dir.glob("*.js")
            if path.name != "dialog-manager.js"
        )
        self.assertNotRegex(
            all_modules, r"modalOverlay\.classList\.(?:add|remove)\([^)]*visible"
        )
        self.assertNotRegex(
            all_modules, r"elements\.modalOverlay\.classList\.(?:add|remove)"
        )

    def test_modal_inventory_covers_dialog_implementation_families(self):
        required_sources = {
            "ui.js",
            "file-operations-ui.js",
            "downloads-uploads.js",
            "git-operations.js",
            "github-integration.js",
            "gitea-integration.js",
            "settings-ui.js",
            "terminal.js",
            "initialization.js",
            "command-palette.js",
            "user-guide.js",
            "window.confirm",
        }
        for source in required_sources:
            self.assertIn(source, self.modal_inventory)

    def test_parity_matrix_covers_every_feature_family(self):
        required_sections = {
            "Workspace And Editor",
            "Local Files And Search",
            "Source Control",
            "SFTP And Terminal",
            "Home Assistant Tools",
            "AI And Assistance",
            "Settings, Help, And Platform",
        }
        for section in required_sections:
            self.assertIn(f"## {section}", self.parity_matrix)

        rows = [
            line
            for line in self.parity_matrix.splitlines()
            if line.startswith("| ") and "---" not in line and "Capability" not in line
        ]
        self.assertGreaterEqual(len(rows), 60)

    def test_parity_matrix_assigns_owner_and_proof_to_every_feature_family(self):
        self.assertIn("## Ownership And Proof Contract", self.parity_matrix)
        required_domains = {
            "Workspace and editor",
            "Local files and search",
            "Source control",
            "SFTP and terminal",
            "Home Assistant tools",
            "AI and assistance",
            "Settings, help, and platform",
            "Cross-cutting UI state",
        }
        for domain in required_domains:
            row = next(
                (
                    line
                    for line in self.parity_matrix.splitlines()
                    if line.startswith(f"| {domain} |")
                ),
                None,
            )
            self.assertIsNotNone(row, f"Missing ownership row for {domain}")
            self.assertGreaterEqual(row.count("|"), 5)

    def test_focused_codemirror_wrapper_has_no_frame_decoration(self):
        unsafe_rules = []
        for stylesheet in sorted(STYLE_MODULES.glob("*.css")):
            css = re.sub(
                r"/\*.*?\*/", "", stylesheet.read_text(encoding="utf-8"), flags=re.S
            )
            for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
                selector = selector.strip()
                targets_focused_wrapper = re.search(
                    r"\.CodeMirror-focused(?![\w-])\s*(?:,|$)", selector
                ) or re.search(
                    r"\.CodeMirror:(?:focus|focus-visible)(?![\w-])", selector
                )
                if not targets_focused_wrapper:
                    continue
                if re.search(
                    r"(?:^|;)\s*(?:outline|border(?:-(?:top|right|bottom|left))?|box-shadow)\s*:",
                    declarations,
                ):
                    unsafe_rules.append(f"{stylesheet.name}: {selector}")

        self.assertEqual(
            unsafe_rules,
            [],
            "Focused CodeMirror wrappers must not receive frame decoration; "
            "it renders as full-width editor artifacts: " + ", ".join(unsafe_rules),
        )

    def test_autocomplete_yaml_contexts(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not installed")
        result = subprocess.run(
            [node, "tests/js/autocomplete_context.mjs"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_autocomplete_snippet_icon_uses_shared_wrapper(self):
        autocomplete = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "ha-autocomplete.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'class="ui-icon material-icons ha-hint-snippet-icon"',
            autocomplete,
        )
        self.assertNotIn(
            '<span class="material-icons" style="font-size: 16px;', autocomplete
        )

        styles = (STYLE_MODULES / "codemirror.css").read_text(encoding="utf-8")
        self.assertRegex(
            styles,
            r"\.ha-hint-snippet-icon\s*\{[^}]*font-size:\s*16px;[^}]*height:\s*16px;[^}]*margin-right:\s*6px;[^}]*width:\s*16px;",
        )

    def test_ai_ui_has_one_runtime_module_boundary(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        self.assertFalse((modules / "ai.js").exists())

        ai_ui = (modules / "ai-ui.js").read_text(encoding="utf-8")
        for export_name in (
            "updateAIVisibility",
            "renderAiChatHistory",
            "toggleAISidebar",
            "formatAiResponse",
            "sendAIChatMessage",
        ):
            self.assertRegex(ai_ui, rf"export (?:async )?function {export_name}\(")

        for consumer_path in (
            modules / "coordinators" / "UICoordinator.js",
            modules / "coordinators" / "index.js",
        ):
            consumer = consumer_path.read_text(encoding="utf-8")
            self.assertIn("ai-ui.js", consumer)
            self.assertNotRegex(consumer, r"(?:^|[/'\"])ai\.js(?:['\"]|$)")

    def test_ai_ui_presentation_uses_named_classes(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        ai_ui = (modules / "ai-ui.js").read_text(encoding="utf-8")
        ai_styles = AI_STYLES.read_text(encoding="utf-8")

        self.assertIn('class="markdown-body ai-response-markdown"', ai_ui)
        self.assertEqual(ai_ui.count('classList.add("ai-message-error")'), 2)
        self.assertIn(
            'btnAI.classList.toggle("hidden", !state.aiIntegrationEnabled)', ai_ui
        )
        self.assertNotIn('style="padding: 0; background: transparent;', ai_ui)
        self.assertNotIn('loadingMsg.style.color = "var(--error-color)"', ai_ui)

        ai_button = re.search(
            r'<button class="(?P<classes>[^"]*)" id="btn-ai-studio"(?P<attrs>[^>]*)>',
            self.panel,
        )
        self.assertIsNotNone(ai_button)
        self.assertIn("hidden", ai_button.group("classes"))
        self.assertNotIn("style=", ai_button.group("attrs"))

        self.assertRegex(
            ai_styles,
            r"\.ai-message \.markdown-body\.ai-response-markdown\s*\{[^}]*background:\s*transparent;[^}]*border:\s*none;[^}]*margin:\s*0;[^}]*max-width:\s*100%;[^}]*padding:\s*0;",
        )
        self.assertRegex(
            ai_styles, r"\.ai-message-error\s*\{[^}]*color:\s*var\(--error-color\);"
        )

    def test_ai_edit_proposals_require_review_before_apply(self):
        ai_ui = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "ai-ui.js"
        ).read_text(encoding="utf-8")
        ai_styles = AI_STYLES.read_text(encoding="utf-8")

        self.assertIn("if (result.proposal) await renderProposalReview", ai_ui)
        self.assertIn("action: 'ai_apply_proposal'", ai_ui)
        self.assertIn("action: 'ai_reject_proposal'", ai_ui)
        self.assertIn("hasUnsavedProposalTargets(proposal, paths)", ai_ui)
        self.assertIn("edit.old_content", ai_ui)
        self.assertIn("edit.new_content", ai_ui)
        self.assertIn("role', 'status'", ai_ui)
        self.assertIn(".ai-proposal-comparison", ai_styles)

        for control in (
            "proposal_apply_all",
            "proposal_apply_selected",
            "proposal_previous_change",
            "proposal_next_change",
            "proposal_inline",
            "proposal_side",
            "proposal_copy_selected",
            "proposal_edit",
            "proposal_compare_current",
            "proposal_regenerate",
            "proposal_discard",
        ):
            self.assertIn(f"ai.{control}", ai_ui)
        self.assertIn("selected_paths", ai_ui)
        self.assertIn("action: 'ai_revise_proposal'", ai_ui)
        self.assertIn("await renderProposalReview", ai_ui)
        self.assertIn("result.status === 409", ai_ui)
        self.assertIn("Proposal text copied. No files were changed.", ai_ui)
        self.assertNotRegex(
            ai_ui,
            r"proposal_(?:copy|edit)[\s\S]{0,800}action:\s*['\"]write_file",
        )
        self.assertIn(".ai-proposal-diff-toolbar", ai_styles)
        self.assertIn(".ai-proposal-diff-line", ai_styles)
        self.assertIn(".ai-proposal-editor", ai_styles)

    def test_ai_assistant_modes_context_preview_and_request_states_are_persistent(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        ai_ui = (modules / "ai-ui.js").read_text(encoding="utf-8")
        state_source = (modules / "state.js").read_text(encoding="utf-8")
        settings = (modules / "settings.js").read_text(encoding="utf-8")
        ai_styles = AI_STYLES.read_text(encoding="utf-8")

        for mode in ("ask", "explain", "generate", "fix", "refactor"):
            self.assertIn(f'data-ai-mode="{mode}"', self.panel)
        for control in (
            'id="ai-context-tray"',
            'id="ai-include-file-context"',
            'id="ai-include-metadata"',
            'id="ai-request-status"',
            'id="btn-ai-cancel"',
            'id="btn-ai-retry"',
        ):
            self.assertIn(control, self.panel)

        self.assertIn("action: 'ai_preview_context'", ai_ui)
        self.assertIn("include_file_context: includeFile", ai_ui)
        self.assertIn("include_metadata: state.aiIncludeMetadata !== false", ai_ui)
        self.assertIn("new AbortController()", ai_ui)
        self.assertIn("action: 'ai_cancel'", ai_ui)
        self.assertIn("request.controller.abort()", ai_ui)
        self.assertIn("request_id: requestId", ai_ui)
        self.assertIn("input.value = query", ai_ui)
        self.assertIn("setAiRequestState('cancelled'", ai_ui)
        for key in ("aiTaskMode", "aiIncludeFileContext", "aiIncludeMetadata"):
            self.assertIn(f"{key}:", state_source)
            self.assertIn(f"{key}: state.{key}", settings)
        self.assertIn(".ai-task-modes", ai_styles)
        self.assertIn(".ai-context-tray", ai_styles)
        self.assertIn(".ai-request-status", ai_styles)
        self.assertIn('id="ai-proposal-history"', self.panel)
        self.assertIn("AI_PROPOSAL_HISTORY_LIMIT = 20", ai_ui)
        self.assertIn("action: 'ai_undo_proposal'", ai_ui)
        self.assertIn("restoreProposalEditorContext", ai_ui)
        self.assertNotIn("old_content:", ai_ui.split("function ensureProposalHistory", 1)[1].split("function updateProposalHistory", 1)[0])

    def test_ai_execution_and_proposal_mutations_use_persistent_operations(self):
        ai_ui = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "ai-ui.js"
        ).read_text(encoding="utf-8")

        for contract in (
            "import { startOperationFeedback } from './feedback-service.js?v=2.5.188'",
            "label: 'Generate AI response'",
            "scope: 'AI generation request'",
            "target: aiRequestTarget(requestPayload)",
            "retry: () => sendAIChatMessage(requestPayload)",
            "runningActions: [{ label: 'Cancel'",
            "request.operation.update({ message: 'Provider response received; validating output...', percent: 80 })",
            "request.operation.finish(result.proposal ? 'AI proposal ready for review' : 'AI response complete'",
            "request.operation.fail('AI generation request failed'",
            "request.operation.cancel('AI generation request cancelled'",
            "Provider cancellation was confirmed.",
            "provider cancellation was not confirmed",
            "export async function runAiConfigurationCheck",
            "label: 'Check configuration from AI review'",
            "scope: 'Home Assistant instance'",
            "retry: runAiConfigurationCheck",
            "operation.fail('Home Assistant configuration check failed'",
            "label: 'Apply reviewed AI proposal'",
            "scope: 'Reviewed AI proposal'",
            "retry: () => apply(selectedOnly, immutablePaths)",
            "operation.fail('AI proposal conflicts with current files'",
            "operation.fail('Reviewed AI proposal could not be applied'",
            "export async function undoAiProposal",
            "retry: () => undoAiProposal(immutableRequest)",
            "operation.fail('AI proposal apply could not be undone'",
            "Retry preserves the original undo identifier and file scope.",
        ):
            self.assertIn(contract, ai_ui)
        target_helper = ai_ui[
            ai_ui.index("function aiRequestTarget"):
            ai_ui.index("function startAiOperation")
        ]
        self.assertNotIn("request.query", target_helper)
        self.assertNotIn("file_content", target_helper)
        self.assertIn("sftp|ssh", target_helper)

    def test_ai_sidebar_has_deterministic_visibility_and_persisted_resizing(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        ai_ui = (modules / "ai-ui.js").read_text(encoding="utf-8")
        state_source = (modules / "state.js").read_text(encoding="utf-8")
        settings = (modules / "settings.js").read_text(encoding="utf-8")
        ai_styles = AI_STYLES.read_text(encoding="utf-8")
        responsive = (STYLE_MODULES / "responsive.css").read_text(encoding="utf-8")

        self.assertIn(
            'class="ai-sidebar hidden" id="ai-sidebar" aria-label="AI Studio Copilot" aria-hidden="true"',
            self.panel,
        )
        self.assertIn(
            'id="ai-sidebar-resize-handle" role="separator" tabindex="0"', self.panel
        )
        self.assertIn("export function toggleAISidebar(forceVisible)", ai_ui)
        self.assertIn("sidebar.classList.toggle('visible', show)", ai_ui)
        self.assertIn("sidebar.classList.toggle('hidden', !show)", ai_ui)
        self.assertIn("sidebar.setAttribute('aria-hidden', String(!show))", ai_ui)
        self.assertIn("button?.setAttribute('aria-expanded', String(show))", ai_ui)
        self.assertIn("typeof forceVisible === 'boolean'", ai_ui)
        self.assertIn("handle.addEventListener('pointerdown'", ai_ui)
        self.assertIn("handle.addEventListener('keydown'", ai_ui)
        for key in ("ArrowLeft", "ArrowRight", "Home", "End"):
            self.assertIn(f"event.key === '{key}'", ai_ui)
        self.assertIn("state.aiSidebarWidth = Math.round", ai_ui)
        self.assertIn("aiSidebarWidth: 350", state_source)
        self.assertIn(
            "workspaceLayout.aiSidebarWidth ?? settings.aiSidebarWidth", settings
        )
        self.assertIn("aiSidebarWidth: state.aiSidebarWidth", settings)
        self.assertRegex(
            ai_styles, r"\.ai-sidebar-resize-handle\s*\{[^}]*cursor:\s*col-resize;"
        )
        self.assertRegex(
            responsive,
            r"@media \(max-width:\s*768px\)[\s\S]*\.ai-sidebar-resize-handle\s*\{[^}]*display:\s*none;",
        )

        manifest = json.loads(
            (
                ROOT / "custom_components" / "blueprint_studio" / "manifest.json"
            ).read_text(encoding="utf-8")
        )
        for consumer in (
            modules / "coordinators" / "index.js",
            modules / "coordinators" / "UICoordinator.js",
        ):
            self.assertIn(
                f"ai-ui.js?v={manifest['version']}",
                consumer.read_text(encoding="utf-8"),
            )

    def test_workspace_panel_proportions_are_constrained_and_persisted(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        layout = (modules / "workspace-layout.js").read_text(encoding="utf-8")
        resize = (modules / "resize.js").read_text(encoding="utf-8")
        split_view = (modules / "split-view.js").read_text(encoding="utf-8")
        terminal = (modules / "terminal.js").read_text(encoding="utf-8")
        settings = (modules / "settings.js").read_text(encoding="utf-8")
        main = (modules / "main.js").read_text(encoding="utf-8")
        app = (modules / "app.js").read_text(encoding="utf-8")

        for contract in (
            "SIDEBAR_MIN_WIDTH = 248",
            "SIDEBAR_MAX_WIDTH = 500",
            "AI_SIDEBAR_MIN_WIDTH = 280",
            "AI_SIDEBAR_MAX_WIDTH = 600",
            "TERMINAL_MIN_HEIGHT = 140",
            "SPLIT_MIN_PERCENT = 25",
            "SPLIT_MAX_PERCENT = 75",
        ):
            self.assertIn(contract, layout)

        self.assertIn('id="resize-handle" role="separator" tabindex="0"', self.panel)
        self.assertIn(
            'id="split-resize-handle" role="separator" tabindex="0"', self.panel
        )
        self.assertIn("elements.resizeHandle.addEventListener('keydown'", resize)
        self.assertIn("handle.addEventListener('keydown', handleKeyDown)", split_view)
        self.assertIn("resizeHandle.addEventListener('keydown'", terminal)
        self.assertIn("state.terminalPanelHeight = Math.round", terminal)
        self.assertIn("workspaceLayout: {", settings)
        for field in (
            "sidebarWidth: state.sidebarWidth",
            "aiSidebarWidth: state.aiSidebarWidth",
            "terminalPanelHeight: state.terminalPanelHeight",
            "splitPrimaryPercent: state.splitView?.primaryPaneSize",
        ):
            self.assertIn(field, settings)

        self.assertIn("window.state = appMod.state", main)
        self.assertNotIn("import('./state.js?v='", main)
        self.assertRegex(app, r"export\s*\{\s*state,\s*elements,")

        manifest = json.loads(
            (
                ROOT / "custom_components" / "blueprint_studio" / "manifest.json"
            ).read_text(encoding="utf-8")
        )
        layout_import = re.compile(
            r"(?:settings|resize|split-view|terminal)\.js\?v=([0-9.]+)"
        )
        imports = []
        for source_path in modules.rglob("*.js"):
            source = source_path.read_text(encoding="utf-8")
            self.assertNotRegex(
                source,
                r"(?:settings|resize|split-view|terminal)\.js['\"]",
                str(source_path),
            )
            imports.extend(
                (source_path, version) for version in layout_import.findall(source)
            )
        self.assertTrue(imports)
        for source_path, version in imports:
            self.assertEqual(manifest["version"], version, str(source_path))

    def test_structural_yaml_parser_is_packaged_for_haos_and_offline_use(self):
        integration = ROOT / "custom_components" / "blueprint_studio"
        modules = integration / "www" / "modules"
        vendor = integration / "www" / "vendor" / "yaml"
        manifest = json.loads(
            (integration / "manifest.json").read_text(encoding="utf-8")
        )
        context_source = (modules / "yaml-context.js").read_text(encoding="utf-8")
        parser_source = (vendor / "yaml.js").read_text(encoding="utf-8")
        init_source = (integration / "__init__.py").read_text(encoding="utf-8")

        self.assertGreater((vendor / "yaml.js").stat().st_size, 50_000)
        self.assertTrue((vendor / "LICENSE").is_file())
        self.assertIn(
            "eemeli aro", (vendor / "LICENSE").read_text(encoding="utf-8").lower()
        )
        self.assertIn(f"../vendor/yaml/yaml.js?v={manifest['version']}", context_source)
        self.assertNotRegex(context_source + parser_source, r"https?://|cdn\.")
        self.assertIn(
            'hass.config.path("custom_components", DOMAIN, "www")', init_source
        )
        self.assertIn(
            "StaticPathConfig(url_path=url_path, path=path_on_disk", init_source
        )

        for consumer_name in (
            "completion-details.js",
            "dev-tools.js",
            "editor.js",
            "global-search.js",
            "initialization.js",
        ):
            consumer = (modules / consumer_name).read_text(encoding="utf-8")
            self.assertIn(
                f"ha-autocomplete.js?v={manifest['version']}", consumer, consumer_name
            )

    def test_blueprint_form_supports_current_and_legacy_haos_addon_selectors(self):
        form = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "blueprint-form.js"
        ).read_text(encoding="utf-8")
        constants = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "constants.js"
        ).read_text(encoding="utf-8")

        self.assertIn("'app' in i.selector || 'addon' in i.selector", form)
        self.assertRegex(form, r"case 'app':\s*case 'addon':")
        self.assertIn("action=get_addons", form)
        self.assertIn('"addon", "app"', constants)
        self.assertIn("Blueprint domain: automation, script, or template", constants)

    def test_terminal_panel_exposes_scope_connection_and_reconnect_state(self):
        terminal = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "terminal.js"
        ).read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")

        self.assertIn(
            "function setTerminalConnectionState(status, label, scope", terminal
        )
        self.assertIn("terminalContainer.dataset.connectionState = status", terminal)
        self.assertIn("terminalStatus.setAttribute('aria-live', 'polite')", terminal)
        self.assertIn(
            "reconnectBtn.setAttribute('aria-label', 'Reconnect terminal')", terminal
        )
        self.assertIn(
            "sshSelect.setAttribute('aria-label', 'Connect to SSH host')", terminal
        )
        self.assertIn("`SSH: ${host.name || host.host}`", terminal)
        self.assertIn(
            "if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }",
            terminal,
        )
        self.assertIn("socket.onclose = null", terminal)
        self.assertIn("const wasInitialized = Boolean(term)", terminal)
        self.assertIn("const nextVisible = forceState !== null", terminal)
        self.assertIn("wasInitialized || !state.terminalVisible ? !state.terminalVisible", terminal)
        self.assertNotIn("terminalContainer.style.cssText", terminal)
        self.assertNotIn("sshSelect.style.cssText", terminal)

        self.assertIn("function trackTerminalInput(data)", terminal)
        self.assertIn("function trackTerminalOutput(data)", terminal)
        self.assertIn("async function confirmTerminalHide()", terminal)
        self.assertIn("if (!nextVisible && state.terminalVisible && !await confirmTerminalHide()) return", terminal)
        self.assertIn("Hiding the terminal will keep the session connected", terminal)
        self.assertIn("const restoreTerminalFocus = isTerminalFocused()", terminal)
        self.assertIn("if (restoreTerminalFocus) term.focus()", terminal)

        self.assertRegex(styles, r"\.terminal-panel\s*\{[^}]*height:\s*300px;")
        self.assertRegex(styles, r"\.terminal-header\s*\{[^}]*display:\s*grid;")
        self.assertIn('.terminal-panel[data-connection-state="connected"]', styles)
        self.assertIn(".terminal-panel--tab", styles)
        self.assertRegex(
            styles, r"@media \(max-width:\s*600px\)[\s\S]*\.terminal-header\s*\{"
        )

    def test_workspace_context_indicators_cover_repositories_and_sftp(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        indicators = (modules / "context-indicators.js").read_text(encoding="utf-8")
        git_ui = (modules / "git-ui.js").read_text(encoding="utf-8")
        gitea_ui = (modules / "gitea-ui.js").read_text(encoding="utf-8")
        sftp = (modules / "sftp.js").read_text(encoding="utf-8")
        git_styles = (STYLE_MODULES / "git.css").read_text(encoding="utf-8")
        sftp_styles = (STYLE_MODULES / "sftp.css").read_text(encoding="utf-8")
        responsive_styles = (STYLE_MODULES / "responsive.css").read_text(
            encoding="utf-8"
        )
        component_styles = UI_COMPONENTS.read_text(encoding="utf-8")

        self.assertIn("export function renderRepositoryContext", indicators)
        self.assertIn("export function renderSftpConnectionContext", indicators)
        self.assertIn("header.appendChild(context)", indicators)
        for state in ("connected", "local", "inactive", "connecting"):
            self.assertIn(f"'{state}'", indicators)
        self.assertIn("context.setAttribute('aria-label', description)", indicators)
        self.assertIn("context.setAttribute('role', 'status')", indicators)
        self.assertIn(
            "connection.username ? `${connection.username}@` : ''", indicators
        )
        self.assertIn("renderRepositoryContext(panel, 'GitHub', gitState", git_ui)
        self.assertIn("renderRepositoryContext(panel, 'Gitea', giteaState", gitea_ui)
        self.assertIn("renderSftpConnectionContext(", sftp)
        self.assertNotIn("git-branch-chip", git_ui)
        self.assertNotIn("git-branch-chip", gitea_ui)
        self.assertRegex(
            component_styles, r"\.workspace-context\s*\{[^}]*max-width:\s*100%;"
        )
        self.assertRegex(
            component_styles,
            r"\.workspace-context-label\s*\{[^}]*text-overflow:\s*ellipsis;",
        )
        self.assertRegex(
            git_styles, r"\.repository-context\s*\{[^}]*overflow:\s*hidden;"
        )
        self.assertRegex(git_styles, r"\.git-panel-header\s*\{[^}]*flex-wrap:\s*wrap;")
        self.assertRegex(
            responsive_styles,
            r"\.git-panel-header\s*\{[^}]*flex-wrap:\s*wrap;",
        )
        self.assertRegex(
            sftp_styles,
            r"\.sftp-connection-selector\s*\{[^}]*flex-direction:\s*column;",
        )

        manifest = json.loads(
            (
                ROOT / "custom_components" / "blueprint_studio" / "manifest.json"
            ).read_text(encoding="utf-8")
        )
        for consumer in (
            modules / "git-ui.js",
            modules / "gitea-ui.js",
            modules / "sftp.js",
        ):
            self.assertIn(
                f"context-indicators.js?v={manifest['version']}",
                consumer.read_text(encoding="utf-8"),
            )
        for consumer in (
            modules / "coordinators" / "index.js",
            modules / "coordinators" / "GitCoordinator.js",
            modules / "initialization.js",
            modules / "gitea-ui.js",
        ):
            self.assertIn(
                f"gitea-integration.js?v={manifest['version']}",
                consumer.read_text(encoding="utf-8"),
            )
        self.assertIn(
            f"gitea-ui.js?v={manifest['version']}",
            (modules / "gitea-integration.js").read_text(encoding="utf-8"),
        )
        self.assertIn(
            f"git-ui.js?v={manifest['version']}",
            (modules / "coordinators" / "index.js").read_text(encoding="utf-8"),
        )

    def test_long_workspace_values_use_accessible_overflow_tooltips(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        tooltip = (modules / "tooltip.js").read_text(encoding="utf-8")
        panel = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "panels"
            / "panel_custom.html"
        ).read_text(encoding="utf-8")
        editor_styles = (STYLE_MODULES / "editor.css").read_text(encoding="utf-8")
        file_tree_styles = (STYLE_MODULES / "file-tree.css").read_text(encoding="utf-8")
        sftp_styles = (STYLE_MODULES / "sftp.css").read_text(encoding="utf-8")
        layout_styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")

        self.assertIn("export function setOverflowTooltip", tooltip)
        self.assertIn(
            'target.closest("[data-tooltip], [data-overflow-tooltip]")', tooltip
        )
        self.assertIn(
            "overflowTarget.scrollWidth > overflowTarget.clientWidth + 1", tooltip
        )
        self.assertIn(
            "overflowTarget.scrollHeight > overflowTarget.clientHeight + 1", tooltip
        )
        for consumer, value in (
            ("tabs.js", "setOverflowTooltip(tabEl, tab.path, tabName)"),
            ("file-tree.js", "setOverflowTooltip(item, itemPath, label)"),
            ("breadcrumb.js", "setOverflowTooltip(link, fullPath)"),
            (
                "context-indicators.js",
                "setOverflowTooltip(context, description, contextLabel)",
            ),
            ("terminal.js", "setOverflowTooltip(terminalScope, activeTerminalScope)"),
        ):
            source = (modules / consumer).read_text(encoding="utf-8")
            self.assertIn(value, source)

        breadcrumb = (modules / "breadcrumb.js").read_text(encoding="utf-8")
        self.assertIn("`sftp://${connId}/${currentPath}`", breadcrumb)
        self.assertIn("`terminal://${currentPath.replace(/^\\/+/, '')}`", breadcrumb)

        sftp = (modules / "sftp.js").read_text(encoding="utf-8")
        self.assertIn("setOverflowTooltip(el, folder.path, label)", sftp)
        self.assertIn("setOverflowTooltip(el, file.path, nameEl)", sftp)
        self.assertIn("setOverflowTooltip(crumb, `sftp://${connId}${p}`)", sftp)
        self.assertIn("event.key === 'Enter' || event.key === ' '", sftp)
        self.assertRegex(editor_styles, r"\.tab\s*\{[^}]*max-width:\s*220px;")
        self.assertRegex(
            file_tree_styles, r"\.breadcrumb-link\s*\{[^}]*text-overflow:\s*ellipsis;"
        )
        self.assertRegex(
            sftp_styles, r"\.sftp-crumb\s*\{[^}]*text-overflow:\s*ellipsis;"
        )
        self.assertRegex(
            layout_styles, r"\.terminal-scope\s*\{[^}]*text-overflow:\s*ellipsis;"
        )
        self.assertGreaterEqual(panel.count("data-overflow-tooltip"), 6)

        manifest = json.loads(
            (
                ROOT / "custom_components" / "blueprint_studio" / "manifest.json"
            ).read_text(encoding="utf-8")
        )
        for consumer in (
            "initialization.js",
            "context-indicators.js",
            "tabs.js",
            "file-tree.js",
            "breadcrumb.js",
            "sftp.js",
            "terminal.js",
        ):
            source = (modules / consumer).read_text(encoding="utf-8")
            self.assertIn(f"tooltip.js?v={manifest['version']}", source)

    def test_developer_tools_use_keyboard_tab_semantics(self):
        dev_tools = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "dev-tools.js"
        ).read_text(encoding="utf-8")
        styles = UI_COMPONENTS.read_text(encoding="utf-8")

        self.assertIn('role="tablist" aria-label="Developer Tool views"', dev_tools)
        for tab in ("states", "actions", "template", "config", "reload"):
            self.assertIn(
                f'id="bdt-tab-{tab}" data-tab="{tab}" type="button" role="tab"',
                dev_tools,
            )
            self.assertIn(
                f'id="bdt-pane-{tab}" data-pane="{tab}" role="tabpanel" aria-labelledby="bdt-tab-{tab}"',
                dev_tools,
            )
        self.assertIn("['ArrowLeft', 'ArrowRight', 'Home', 'End']", dev_tools)
        self.assertIn(
            "button.setAttribute('aria-selected', String(selected))", dev_tools
        )
        self.assertIn("button.tabIndex = selected ? 0 : -1", dev_tools)
        self.assertIn('aria-label="Close Developer Tools"', dev_tools)
        for label in (
            "Search actions",
            "Action YAML",
            "Action targets",
            "Template input",
            "Filter states",
            "Filter states by domain",
        ):
            self.assertIn(f'aria-label="{label}"', dev_tools)
        self.assertRegex(
            styles, r"\.bdt-tab-btn:focus-visible[\s\S]*var\(--focus-color\)"
        )

    def test_developer_tools_expose_bounded_searchable_raw_results(self):
        dev_tools = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "dev-tools.js"
        ).read_text(encoding="utf-8")

        self.assertIn("const MAX_RAW_RESULT_LENGTH = 200000", dev_tools)
        self.assertIn('class="bdt-result-inspector"', dev_tools)
        self.assertIn('aria-label="Search raw developer tool result"', dev_tools)
        self.assertIn('aria-label="Copy raw result"', dev_tools)
        for source in ("Actions", "Templates", "States", "Configuration", "Reload"):
            self.assertIn(f"_recordRawResult(panel, '{source}'", dev_tools)

    def test_developer_tool_instance_operations_remain_observable(self):
        dev_tools = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "dev-tools.js"
        ).read_text(encoding="utf-8")

        self.assertIn("startOperationFeedback", dev_tools)
        self.assertIn("label: 'Check Home Assistant configuration'", dev_tools)
        self.assertIn("label: `Reload ${label}`", dev_tools)
        self.assertGreaterEqual(dev_tools.count("scope: 'Home Assistant instance'"), 2)
        self.assertIn("retry: () => _runConfigurationCheck()", dev_tools)
        self.assertIn("retry: () => _runYamlReload(domain)", dev_tools)
        self.assertIn("open: () => _revealDevTools('config')", dev_tools)
        self.assertIn("open: () => _revealDevTools('reload')", dev_tools)
        self.assertIn("errorDetail || result.output", dev_tools)
        self.assertIn("operation.fail(`${label} reload failed`", dev_tools)

    def test_remaining_developer_tool_producers_use_quiet_scoped_operations(self):
        dev_tools = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "dev-tools.js"
        ).read_text(encoding="utf-8")

        for contract in (
            "export async function runDeveloperAction",
            "serviceData: cloneOperationInput(request.serviceData || {})",
            "target: cloneOperationInput(request.target || {})",
            "scope: 'Home Assistant action'",
            "target: `${serviceName} -> ${actionTargetLabel(immutableRequest.target)}`",
            "retry: () => runDeveloperAction(immutableRequest)",
            "operation.fail(`${serviceName} failed`, message)",
            "export async function renderDeveloperTemplate",
            "scope: 'Home Assistant template engine'",
            "target: `${immutableTemplate.length} character template`",
            "retry: () => renderDeveloperTemplate(immutableTemplate)",
            "operation?.fail('Template rendering failed'",
            "timer = setTimeout(() => render(false), 600)",
            "renderBtn.addEventListener('click', () => render(true))",
            "label: 'Refresh Home Assistant states'",
            "target: 'Entity state registry'",
            "operation?.finish(`${allEntities.length} entity state",
            "operation?.fail('Home Assistant states could not be loaded'",
            "refreshBtn.addEventListener('click', () => { allEntities = []; load(true); })",
            "load(false)",
        ):
            self.assertIn(contract, dev_tools)
        action_operation = dev_tools[
            dev_tools.index("export async function runDeveloperAction"):
            dev_tools.index("function _showActionResult")
        ]
        self.assertNotIn("serviceData)", action_operation.split("target:", 1)[1].split("retry:", 1)[0])
        template_operation = dev_tools[
            dev_tools.index("export async function renderDeveloperTemplate"):
            dev_tools.index("function _destroyPanel")
        ]
        self.assertNotIn("target: immutableTemplate", template_operation)

    def test_sftp_file_opening_uses_persistent_operation_feedback(self):
        sftp = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "sftp.js"
        ).read_text(encoding="utf-8")

        self.assertIn("startOperationFeedback", sftp)
        self.assertIn("label: `Open ${fileName}`", sftp)
        self.assertIn("scope: `SFTP ${conn.name || connId}`", sftp)
        self.assertIn("target: remotePath", sftp)
        self.assertIn("retry: () => openSftpFile(connId, remotePath, noActivate)", sftp)
        self.assertIn("open: showSource", sftp)
        self.assertIn("await connectToServer(connId)", sftp)
        self.assertIn("await navigateSftp(connId, parentRemotePath(remotePath))", sftp)
        self.assertIn("operation.finish(`${fileName} opened`)", sftp)
        self.assertIn("operation.finish(`${fileName} is ready to stream`)", sftp)
        self.assertGreaterEqual(sftp.count("operation.fail(`Could not open ${fileName}`"), 3)

    def test_global_replace_uses_persistent_operation_feedback(self):
        global_search = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "global-search.js"
        ).read_text(encoding="utf-8")

        self.assertIn("startOperationFeedback", global_search)
        self.assertIn('scope: "Workspace search"', global_search)
        self.assertIn("retry: () => runGlobalReplace(request)", global_search)
        self.assertIn("retry: () => runReplaceInFile(request)", global_search)
        self.assertGreaterEqual(global_search.count("open: () => openGlobalSearchRequest("), 2)
        self.assertGreaterEqual(global_search.count("Object.freeze({"), 2)
        self.assertIn('eventBus.emit("ui:switch-sidebar-view", "search")', global_search)
        self.assertIn('elements.globalReplaceContainer?.classList.add("expanded")', global_search)
        self.assertIn('elements.globalPatternsContainer?.classList.add("expanded")', global_search)
        self.assertIn('button?.setAttribute("aria-pressed"', global_search)
        self.assertIn('operation.finish(`${response.files_updated || 0} files updated`', global_search)
        self.assertIn('operation.fail("Workspace replace failed"', global_search)
        self.assertIn('operation.fail("File replace failed"', global_search)
        self.assertNotIn("showGlobalLoading", global_search)

    def test_home_assistant_restart_confirmation_names_workspace_impact(self):
        api = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "api.js"
        ).read_text(encoding="utf-8")
        feedback = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "feedback-service.js"
        ).read_text(encoding="utf-8")

        self.assertIn("const unsavedTabs = state.openTabs.filter(tab => tab.modified)", api)
        self.assertIn("const activeOperations = getActiveOperationSummary()", api)
        self.assertIn("Home Assistant instance", api)
        self.assertIn("Instance-wide restart", api)
        self.assertIn("Terminal sessions and in-progress work may disconnect", api)
        self.assertIn("export function getActiveOperationSummary()", feedback)

    def test_locale_bundles_are_versioned_and_cover_primary_activity_labels(self):
        translations = TRANSLATIONS_MODULE.read_text(encoding="utf-8")
        self.assertIn(
            "url.searchParams.set('v', window.__BS_VERSION__ || '0')", translations
        )
        self.assertIn("fetch(localeUrl('en'))", translations)
        self.assertIn("fetch(localeUrl(currentLang))", translations)
        self.assertIn(
            "translatedLabel === key ? fallback : translatedLabel", translations
        )
        self.assertIn(
            "\"#sftp-connection-selector-container > span, #sftp-connection-selector-container option[value='']\"",
            translations,
        )
        self.assertNotIn(
            'document.querySelector("#view-sftp .sidebar-header span:first-child")',
            translations,
        )

        locale_dir = ROOT / "custom_components" / "blueprint_studio" / "www" / "locales"
        for locale in locale_dir.glob("*.json"):
            bundle = json.loads(locale.read_text(encoding="utf-8"))
            for key in ("sidebar.source_control", "sidebar.sftp", "github.auth_title"):
                self.assertTrue(bundle.get(key), f"{locale.name}: {key}")

    def test_github_device_flow_uses_provider_specific_title(self):
        github = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "github-integration.js"
        ).read_text(encoding="utf-8")
        device_flow = github.split(
            "export async function showGithubDeviceFlowLogin()", 1
        )[1].split("// Git Settings Dialog", 1)[0]
        self.assertEqual(device_flow.count('t("github.auth_title")'), 2)
        self.assertNotIn('t("gitea.auth_title")', device_flow)

    def test_github_device_flow_has_persistent_truthful_operation_states(self):
        github = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "github-integration.js"
        ).read_text(encoding="utf-8")
        api = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "api.js"
        ).read_text(encoding="utf-8")
        device_flow = github.split(
            "export async function showGithubDeviceFlowLogin()", 1
        )[1].split("// Git Exclusions Management", 1)[0]

        for contract in (
            "label: 'Sign in to GitHub'",
            "scope: 'GitHub account'",
            "target: 'Device authorization'",
            "retry: () => showGithubDeviceFlowLogin()",
            "label: 'Cancel'",
            "runningActions: [{",
            "operation.cancel(cancelMessage)",
            "operation.finish('GitHub account connected'",
            "operation.fail('Could not start GitHub sign-in', message)",
            "operation.fail('GitHub sign-in failed', message)",
            "if (!handlePollResult(result)) schedulePoll();",
            "if (closed) return true;",
            "if (candidate.protocol === 'https:') verificationUri = candidate.href;",
            "statusMessage.textContent = String(message || '')",
        ):
            self.assertIn(contract, device_flow)
        self.assertNotIn("statusDiv.innerHTML", device_flow)
        self.assertIn("status: result.status ?? response.status", api)
        self.assertIn("httpStatus: response.status", api)
        self.assertIn("actions: runningActions, ...next", self.feedback_service)

    def test_source_control_panels_share_groups_staging_and_inline_commit_contracts(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        shared = (modules / "source-control-view.js").read_text(encoding="utf-8")
        git_ui = (modules / "git-ui.js").read_text(encoding="utf-8")
        gitea_ui = (modules / "gitea-ui.js").read_text(encoding="utf-8")
        coordinator = (modules / "coordinators" / "GitCoordinator.js").read_text(encoding="utf-8")
        palette = (modules / "command-palette.js").read_text(encoding="utf-8")
        diff = (modules / "git-diff.js").read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "git.css").read_text(encoding="utf-8")

        for consumer in (git_ui, gitea_ui):
            self.assertIn("source-control-view.js", consumer)
            self.assertIn("renderSourceControlFiles", consumer)
        for group in ("conflicted", "staged", "unstaged", "untracked", "ignored"):
            self.assertIn(f"key: '{group}'", shared)
        self.assertIn("MAX_IGNORED_STATUS_PATHS = 200", (ROOT / "custom_components" / "blueprint_studio" / "backend" / "git_manager.py").read_text(encoding="utf-8"))
        self.assertIn("btn-source-control-stage", shared)
        self.assertIn("git-file-actions", shared)
        self.assertNotIn("source-control-group-action", shared)
        self.assertNotIn("source-control-group-action", coordinator)
        self.assertIn("source-control:change-stage", coordinator)
        self.assertIn("diff-change-stage", diff)
        for command in ("source_stage_file", "source_unstage_file", "source_stage_selected"):
            self.assertIn(f"id: '{command}'", palette)

        for control in (
            'id="commit-message"',
            'id="commit-summary"',
            'id="commit-validation"',
            'id="gitea-commit-message"',
            'id="gitea-commit-summary"',
            'id="gitea-commit-validation"',
        ):
            self.assertIn(control, self.panel)
        self.assertIn("getCommitMessage('git')", git_ui)
        self.assertIn("getCommitMessage('gitea')", (modules / "gitea-integration.js").read_text(encoding="utf-8"))
        self.assertIn(".source-control-commit-composer", styles)
        self.assertIn(".source-control-group-empty", styles)
        self.assertNotIn(".source-control-group-action", styles)
        self.assertRegex(styles, r"\.git-file-item \.ui-icon-button\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*24px;[^}]*padding:\s*0;")
        layout_styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")
        self.assertIn(".source-control-panels > .git-panel.visible", layout_styles)
        self.assertIn("max-height: none", layout_styles)
        self.assertNotIn("old_content", shared)

    def test_repository_sync_state_is_shared_by_headers_and_status_bar(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        indicators = (modules / "context-indicators.js").read_text(encoding="utf-8")
        status_bar = (modules / "status-bar.js").read_text(encoding="utf-8")
        coordinator = (modules / "coordinators" / "GitCoordinator.js").read_text(encoding="utf-8")
        git_styles = (STYLE_MODULES / "git.css").read_text(encoding="utf-8")
        layout_styles = (STYLE_MODULES / "layout.css").read_text(encoding="utf-8")

        self.assertIn("export function getRepositoryStatus", indicators)
        self.assertIn("export function renderRepositoryStatusBar", indicators)
        for label in ("Push ${ahead}", "Pull ${behind}", "Detached", "Dirty", "Offline", "Synced"):
            self.assertIn(label, indicators)
        self.assertIn("renderRepositoryStatusBar(elements.statusRepository", status_bar)
        self.assertIn("window.addEventListener('online'", status_bar)
        self.assertIn("window.addEventListener('offline'", status_bar)
        self.assertIn("source-control:connectivity-change", coordinator)
        self.assertIn('id="status-repository"', self.panel)
        self.assertIn(".repository-state-badge", git_styles)
        self.assertIn("#status-repository", layout_styles)

    def test_diff_review_surfaces_share_toolbar_and_text_renderer_contracts(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        shared = (modules / "diff-review.js").read_text(encoding="utf-8")
        git_diff = (modules / "git-diff.js").read_text(encoding="utf-8")
        ai_ui = (modules / "ai-ui.js").read_text(encoding="utf-8")
        source_control = (modules / "source-control-view.js").read_text(encoding="utf-8")
        git_styles = (STYLE_MODULES / "git.css").read_text(encoding="utf-8")

        for symbol in ("createDiffReviewToolbar", "getRawDiffRows", "renderTextDiff"):
            self.assertIn(f"export function {symbol}", shared)
        self.assertIn("createTextDiffReview(document.getElementById('commit-diff-content')", git_diff)
        self.assertIn("getRawDiffRows(data.diff)", git_diff)
        self.assertIn("createDiffReviewToolbar({", ai_ui)
        self.assertIn("renderTextDiff(target, visibleRows", ai_ui)
        self.assertIn("Review conflict in", source_control)
        for selector in (".diff-text-viewer", ".diff-text-line", ".diff-text-line--added", ".diff-text-line--removed"):
            self.assertIn(selector, git_styles)

    def test_diff_review_navigation_display_controls_file_list_and_large_fallback(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        shared = (modules / "diff-review.js").read_text(encoding="utf-8")
        git_diff = (modules / "git-diff.js").read_text(encoding="utf-8")
        ai_ui = (modules / "ai-ui.js").read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "git.css").read_text(encoding="utf-8")

        self.assertIn("export const DEFAULT_DIFF_RENDER_LIMIT", shared)
        for symbol in ("createDiffToggle", "markWhitespaceOnlyChanges", "createTextDiffReview"):
            self.assertIn(f"export function {symbol}", shared)
        for contract in (
            "Previous change",
            "Next change",
            "Hide whitespace-only changes",
            "Wrap long lines",
            "diff-file-list",
            "diff-large-fallback",
            "Show more",
        ):
            self.assertIn(contract, shared)
        self.assertIn("setupMergeViewDisplayControls", git_diff)
        self.assertIn("ignoreWhitespace", git_diff)
        self.assertIn("collapseIdentical: largeDiff ? 4 : false", git_diff)
        self.assertIn("createDiffToggle('space_bar'", ai_ui)
        self.assertIn("createDiffToggle('wrap_text'", ai_ui)
        for selector in (
            ".diff-review-layout",
            ".diff-file-list-item",
            ".diff-text-line--active",
            ".diff-large-fallback",
        ):
            self.assertIn(selector, styles)

    def test_git_actions_share_scoped_consequence_confirmations(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        confirmation = (modules / "git-action-confirmation.js").read_text(encoding="utf-8")
        git_operations = (modules / "git-operations.js").read_text(encoding="utf-8")
        gitea = (modules / "gitea-integration.js").read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "ui-components.css").read_text(encoding="utf-8")

        for kind in (
            "discard",
            "hard-reset",
            "force-push",
            "delete-local-branch",
            "force-delete-local-branch",
            "delete-remote-branch",
            "merge",
        ):
            self.assertIn(f"case '{kind}'", confirmation)
        for label in ("Scope", "Target", "Consequence", "Recovery"):
            self.assertIn(f"row('{label}'", confirmation)
        for command in (
            "Discard Changes",
            "Reset Local Branch",
            "Force Push",
            "Delete Local Branch",
            "Delete Remote Branch",
            "Merge into Current Branch",
        ):
            self.assertIn(command, confirmation)
        self.assertGreaterEqual(git_operations.count("getGitActionConfirmation("), 7)
        self.assertEqual(gitea.count("getGitActionConfirmation("), 2)
        self.assertIn(".git-action-confirmation__row", styles)

    def test_git_repository_recovery_actions_use_persistent_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "git-operations.js"
        ).read_text(encoding="utf-8")

        for label in (
            "Initialize Git repository",
            "Abort Git operation",
            "Force push to GitHub",
            "Reset from GitHub",
        ):
            self.assertIn(label, source)
        for target in (
            "Configuration workspace -> main",
            "${branch} -> origin/${branch}",
            "origin/${branch} -> ${branch}",
        ):
            self.assertIn(target, source)
        self.assertIn("gitState.isInitialized = true", source)
        self.assertNotIn("gitState.isInitialized = True", source)
        self.assertIn("if (skipConfirm !== true)", source)
        self.assertIn("() => confirmAbortGitOperation(branch)", source)
        self.assertIn("() => confirmForcePush(branch)", source)
        self.assertIn("() => confirmHardReset(branch)", source)
        self.assertIn("operation.fail('Could not initialize repository', message)", source)
        self.assertIn("showToast(t(\"toast.git_init_started\"), \"info\")", source)
        self.assertIn("detail: 'Initial branch: main'", source)
        self.assertIn("operation.fail('Could not abort Git operation', message)", source)
        self.assertIn("operation.fail('Force push failed', message)", source)
        self.assertIn("operation.fail('Hard reset failed', message)", source)
        recovery_slice = source[
            source.index("export async function gitInit"):
            source.index("export async function deleteRemoteBranch")
        ]
        self.assertNotIn("showGlobalLoading", recovery_slice)
        self.assertNotIn("hideGlobalLoading", recovery_slice)
        init_slice = source[
            source.index("export async function gitInit"):
            source.index("export async function abortGitOperation")
        ]
        self.assertNotIn("git_rename_branch", init_slice)

    def test_gitea_initialization_uses_shared_truthful_local_git_workflow(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "gitea-integration.js"
        ).read_text(encoding="utf-8")
        init_slice = source[
            source.index("export async function giteaInit"):
            source.index("// ============================================\n// Gitea Push Operation")
        ]

        self.assertIn("gitInit,", source)
        self.assertIn("const initialized = await gitInit(skipConfirm)", init_slice)
        self.assertIn("if (!initialized) return false", init_slice)
        self.assertIn("await giteaStatus(false, true)", init_slice)
        self.assertNotIn("git_rename_branch", init_slice)
        self.assertNotIn("toast.git_init_success", init_slice)

    def test_git_index_mutations_use_scoped_truthful_operations(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        source = (modules / "git-operations.js").read_text(encoding="utf-8")
        confirmations = (modules / "git-action-confirmation.js").read_text(encoding="utf-8")
        mutation_slice = source[
            source.index("export async function gitStage"):
            source.index("export async function gitPull")
        ]

        for contract in (
            "Object.freeze(Array.from(new Set(files)))",
            "`Stage ${request.length}",
            "retry = () => handleGitLockAndRetry(request)",
            "'Clean Git state and retry staging'",
            "detail: 'Step 1 of 2'",
            "detail: 'Step 2 of 2'",
            "'Git recovery state was removed. The selected files were not staged.'",
            "getGitActionConfirmation('repair-index'",
            "'Repair Git index'",
            "operation.fail('Could not repair Git index', message)",
            "`Unstage ${request.length}",
            "operation.fail('Could not unstage files', message)",
            "`Discard changes in ${request.length}",
            "operation.fail('Could not discard working changes', message)",
        ):
            self.assertIn(contract, mutation_slice)
        for action in ("git_stage", "git_clean_locks", "git_repair_index", "git_unstage", "git_reset"):
            self.assertIn(action, mutation_slice)
        self.assertIn("case 'repair-index':", confirmations)
        self.assertIn("Working file content is retained, but staged selections are cleared.", confirmations)

        conflict_slice = source[
            source.index("export async function gitResolveConflict"):
            source.index("export async function gitGetConflictFiles")
        ]
        for contract in (
            "`Resolve conflict in ${targetPath.split('/').pop()}`",
            "`${targetPath} -> ${resolutionLabel}`",
            "() => gitResolveConflict(targetPath, resolution)",
            "operation.fail('Could not resolve conflict', message)",
            "await gitStatus(false, true)",
        ):
            self.assertIn(contract, conflict_slice)

    def test_git_exclusion_load_save_and_index_update_use_persistent_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "github-integration.js"
        ).read_text(encoding="utf-8")
        exclusions = source[
            source.index("export async function saveGitExclusions"):
            source.index("// ============================================\n// Git Settings Dialog")
        ]

        for contract in (
            "Object.freeze(Array.from(new Set(ignoredPaths.filter(Boolean))).sort())",
            "label: 'Save Git exclusions'",
            "target: `.gitignore; ${request.ignoredPaths.length}",
            "retry: () => saveGitExclusions(request.content, request.ignoredPaths)",
            "detail: 'Step 1 of 2'",
            "detail: 'Step 2 of 2'",
            "if (!writeResponse.success)",
            "if (!indexResponse.success)",
            "operation.fail(gitignoreSaved ? '.gitignore saved; index update failed'",
            "Some paths may still be tracked until Retry succeeds.",
            "label: 'Load Git exclusions'",
            "retry: showGitExclusions",
            "loadOperation.fail('Could not load Git exclusions', error.message)",
            "const saved = await saveGitExclusions(newContent, optimizedIgnoreList)",
            "setButtonLoading(btnConfirm, true)",
        ):
            self.assertIn(contract, exclusions)
        self.assertNotIn("showGlobalLoading", exclusions)
        self.assertNotIn("hideGlobalLoading", exclusions)

    def test_provider_remote_configuration_uses_persistent_credential_safe_operations(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        github = (modules / "github-integration.js").read_text(encoding="utf-8")
        gitea = (modules / "gitea-integration.js").read_text(encoding="utf-8")
        github_remote = github[
            github.index("function remoteEndpointLabel"):
            github.index("// ============================================\n// GitHub Repository Creation")
        ]
        gitea_remote = gitea[
            gitea.index("export async function giteaAddRemote"):
            gitea.index("export async function showGiteaSettings")
        ]

        for contract in (
            "return `${parsed.host}${parsed.pathname}`",
            "Object.freeze({ name: String(name || 'origin'), url: String(url || '') })",
            "label: `Configure ${request.name} remote`",
            "retry: () => gitAddRemote(request.name, request.url)",
            "operation.fail(`Could not configure ${request.name} remote`, message)",
            "export async function gitRemoveRemote(name)",
            "retry: () => gitRemoveRemote(remoteName)",
            "operation.fail(`Could not remove ${remoteName} remote`, error.message)",
        ):
            self.assertIn(contract, github_remote)
        self.assertNotIn("parsed.username", github_remote)
        self.assertNotIn("parsed.password", github_remote)

        for contract in (
            "export async function giteaAddRemote(url)",
            "target: `gitea -> ${giteaEndpointLabel(remoteUrl)}`",
            "retry: () => giteaAddRemote(remoteUrl)",
            "operation.fail('Could not configure Gitea remote', error.message)",
            "export async function giteaRemoveRemote(name)",
            "retry: () => giteaRemoveRemote(remoteName)",
            "body: JSON.stringify({ action: 'git_remove_remote', name: remoteName })",
        ):
            self.assertIn(contract, gitea_remote)
        self.assertNotIn("gitea_remove_remote", gitea_remote)

    def test_provider_credentials_and_connection_checks_use_secret_safe_operations(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        git_operations = (modules / "git-operations.js").read_text(encoding="utf-8")
        github = (modules / "github-integration.js").read_text(encoding="utf-8")
        gitea = (modules / "gitea-integration.js").read_text(encoding="utf-8")
        github_save = git_operations[
            git_operations.index("export async function gitSetCredentials"):
            git_operations.index("export async function gitStage")
        ]
        github_auth = github[
            github.index("export async function gitTestConnection"):
            github.index("// ============================================\n// GitHub OAuth Device Flow")
        ]
        gitea_auth = gitea[
            gitea.index("export async function giteaSaveCredentials"):
            gitea.index("export async function showGiteaSettings")
        ]

        for contract in (
            "label: 'Save GitHub credentials'",
            "scope: 'GitHub authentication'",
            "open: () => eventBus.emit('git:show-settings')",
            "operation.fail('Could not save GitHub credentials', message",
            "The token was not retained for Retry.",
        ):
            self.assertIn(contract, github_save)
        self.assertNotIn("retry:", github_save)
        self.assertNotIn("target: token", github_save)

        for contract in (
            "label: 'Test GitHub connection'",
            "retry: gitTestConnection",
            "operation.fail('GitHub connection failed', message)",
            "label: 'Sign out from GitHub'",
            "retry: gitClearCredentials",
            "Saved GitHub credentials will be removed.",
        ):
            self.assertIn(contract, github_auth)

        for contract in (
            "label: 'Save Gitea credentials'",
            "open: () => eventBus.emit('git:show-gitea-settings')",
            "The token was not retained for Retry.",
            "label: 'Sign out from Gitea'",
            "retry: giteaClearCredentials",
            "label: 'Test Gitea connection'",
            "retry: giteaTestConnection",
            "operation.fail('Gitea connection failed', error.message)",
        ):
            self.assertIn(contract, gitea_auth)
        gitea_save = gitea_auth[:gitea_auth.index("export async function giteaClearCredentials")]
        self.assertNotIn("retry:", gitea_save)
        self.assertNotIn("target: token", gitea_save)

    def test_application_reset_uses_resumable_truthful_multi_step_operation(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "settings-ui.js"
        ).read_text(encoding="utf-8")
        reset = source[
            source.index("export async function resetApplicationData"):
            source.index("const AI_MODEL_PRESETS")
        ]

        for contract in (
            "Object.freeze({",
            "action: 'git_clear_credentials'",
            "action: 'gitea_clear_credentials'",
            "action: 'git_delete_repo'",
            "action: 'save_settings'",
            "label: 'Reset Blueprint Studio'",
            "scope: 'Blueprint Studio application data'",
            "retry: () => resetApplicationData(request, resumeStep)",
            "detail: `Step ${index + 1} of ${steps.length}`",
            "if (!data.success) throw new Error",
            "Completed steps remain applied.",
            "Browser settings were not cleared and the page was not reloaded.",
            "localStorage.clear()",
            "setTimeout(() => window.location.reload(), 800)",
        ):
            self.assertIn(contract, reset)
        self.assertLess(reset.index("operation.finish('Application reset complete; reloading...'"), reset.index("localStorage.clear()"))

        handler = source[
            source.index("const handleConfirm = async () =>", source.index("// Handle Reset Application button")):
            source.index("// One-time listener for this specific modal instance")
        ]
        self.assertIn("await resetApplicationData({", handler)
        self.assertNotIn("fetchWithAuth", handler)
        self.assertNotIn("localStorage.clear", handler)

    def test_shared_git_recovery_cleanup_uses_confirmed_persistent_operation(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "git-operations.js"
        ).read_text(encoding="utf-8")
        cleanup = source[
            source.index("export async function gitCleanLocks"):
            source.index("export async function gitRepairIndex")
        ]

        for contract in (
            "getGitActionConfirmation('clean-locks'",
            "'Clean Git recovery state'",
            "`${branch} -> .git recovery metadata`",
            "gitCleanLocks,",
            "Array.isArray(data.removed)",
            "operation.finish('Git recovery state cleaned'",
            "operation.fail('Could not clean Git recovery state', message)",
            "operation.fail('Could not clean Git recovery state', error.message)",
            "await gitStatus(false, true)",
        ):
            self.assertIn(contract, cleanup)

    def test_ai_model_and_hass_agent_discovery_use_persistent_safe_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "settings-ui.js"
        ).read_text(encoding="utf-8")
        discovery = source[
            source.index("function aiDiscoveryTarget"):
            source.index("/**\n * Show the application settings modal")
        ]

        for contract in (
            "export async function refreshModelList",
            "scope: 'AI provider model discovery'",
            "target: aiDiscoveryTarget(sourceKey)",
            "retry: () => refreshModelList(sourceKey)",
            "operation?.finish(`${unique.length} model",
            "operation?.fail('Model discovery failed'",
            "Provider returned no models",
            "export async function refreshHassAgents",
            "label: 'Discover Home Assistant agents'",
            "scope: 'Local Home Assistant instance'",
            "retry: refreshHassAgents",
            "operation?.fail('Conversation-agent discovery failed'",
            "escapeHtml(agent.id)",
            "escapeHtml(agent.name)",
            "escapeHtml(agent.platform)",
        ):
            self.assertIn(contract, discovery)
        self.assertIn("const endpoint = `${parsed.host}${parsed.pathname}`", source)
        self.assertNotIn("parsed.username", discovery)
        self.assertNotIn("parsed.password", discovery)
        self.assertIn("silent ? null : startOperationFeedback", discovery)
        self.assertIn("void refreshHassAgents({ silent: true })", source)
        self.assertNotIn("_refreshHassAgents", source)

    def test_blueprint_automation_validate_and_save_use_truthful_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "blueprint-form.js"
        ).read_text(encoding="utf-8")
        workflow = source[source.index("export async function validateBlueprintAutomation"):]

        for contract in (
            "label: 'Validate blueprint automation'",
            "message: 'Step 1 of 2: generating automation YAML...'",
            "retry: () => validateBlueprintAutomation(immutableRequest)",
            "operation.fail('Generated YAML is invalid', message)",
            "export async function saveBlueprintAutomation",
            "scope: 'Home Assistant configuration'",
            "retry: () => saveBlueprintAutomation(immutableRequest)",
            "existingContent.trimEnd().endsWith(desiredYaml)",
            "exact automation already present; skipping write",
            "immutableRequest.mode === 'new' || alreadyWritten",
            "Retry will skip the write and retry only the reload.",
            "operation.fail('File saved, but automations could not be reloaded'",
            "operation.fail('Automation could not be saved'",
            "open: () => revealAutomationPath(immutableRequest.path)",
        ):
            self.assertIn(contract, workflow)
        self.assertIn("if (saved) closeBlueprintForm()", source)
        self.assertNotIn("async function _appendToAutomations", source)
        self.assertNotIn("async function _saveNewFile", source)

    def test_home_assistant_restart_uses_confirmed_persistent_operation(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "api.js"
        ).read_text(encoding="utf-8")
        restart = source[source.index("export async function restartHomeAssistant"):]

        for contract in (
            'label: "Restart Home Assistant"',
            'scope: "Home Assistant instance"',
            'target: "Instance-wide restart"',
            "retry: restartHomeAssistant",
            'open: () => eventBus.emit("ha:dev-tools", { tab: "config" })',
            'operation.update({ message: "Requesting Home Assistant restart...", percent: 20 })',
            'operation.fail("Restart request was rejected", message)',
            'operation.update({ message: "Home Assistant is restarting...", percent: 70 })',
            'throw new Error("Home Assistant did not become ready within 2 minutes")',
            'operation.finish("Home Assistant is online; reloading Blueprint Studio"',
            'operation.fail("Home Assistant restart could not be confirmed", error.message)',
        ):
            self.assertIn(contract, restart)
        self.assertIn("getActiveOperationSummary()", restart)
        self.assertNotIn("showGlobalLoading", restart)

    def test_gitea_recovery_actions_use_persistent_truthful_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "gitea-integration.js"
        ).read_text(encoding="utf-8")
        recovery = source[
            source.index("export async function giteaAbort"):
            source.index("// ============================================\n// Gitea Settings Modal")
        ]

        for contract in (
            "'Abort Gitea Git operation'",
            "'Force push to Gitea'",
            "'Reset from Gitea'",
            "`${branch} -> gitea/${branch}`",
            "`gitea/${branch} -> ${branch}`",
            "operation.fail('Could not abort Gitea Git operation', message)",
            "operation.fail('Force push to Gitea failed', message)",
            "operation.fail('Reset from Gitea failed', message)",
            "body: JSON.stringify({ action: \"git_hard_reset\", remote: \"gitea\", branch })",
            "await giteaStatus(false, true)",
        ):
            self.assertIn(contract, recovery)
        self.assertGreaterEqual(recovery.count("if (!data.success)"), 3)
        self.assertIn("giteaAbort,", recovery)
        self.assertIn("giteaForcePush,", recovery)
        self.assertIn("giteaHardReset,", recovery)
        self.assertNotIn("showGlobalLoading", recovery)
        self.assertNotIn("hideGlobalLoading", recovery)

    def test_branch_mismatch_repair_is_persistent_resumable_and_truthful(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        source = (modules / "github-integration.js").read_text(encoding="utf-8")
        confirmations = (modules / "git-action-confirmation.js").read_text(encoding="utf-8")
        repair = source[
            source.index("export async function repairBranchMismatch"):
            source.index("// ============================================\n// Connection Testing")
        ]

        for contract in (
            "getGitActionConfirmation('repair-branch-mismatch'",
            "label: 'Repair GitHub branch mismatch'",
            "scope: 'Local Git repository and GitHub'",
            "target: 'master -> main; origin/main -> main'",
            "retry: () => confirmBranchMismatchRepair(resumeStep)",
            "detail: `Step ${index + 1} of ${steps.length}`",
            "if (!data.success)",
            "Completed steps remain applied.",
            "operation.fail(",
            "await gitStatus(false, true)",
        ):
            self.assertIn(contract, repair)
        self.assertIn("case 'repair-branch-mismatch':", confirmations)
        self.assertIn("Earlier completed steps remain applied.", confirmations)
        self.assertNotIn("showGlobalLoading", repair)
        self.assertNotIn("hideGlobalLoading", repair)

    def test_remote_branch_deletion_uses_persistent_recoverable_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "git-operations.js"
        ).read_text(encoding="utf-8")
        confirmations = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "git-action-confirmation.js"
        ).read_text(encoding="utf-8")
        remote_delete = source[
            source.index("export async function deleteRemoteBranch"):
            source.index("export async function gitGetRemotes")
        ]

        for contract in (
            "Delete GitHub branch",
            "Change default branch and delete",
            "origin/${branchName}",
            "default: ${branchName} -> main; delete origin/${branchName}",
            "operation.fail('Could not delete remote branch', message)",
            "operation.fail('Could not change GitHub default branch', patchMessage)",
            "operation.fail('Default changed, but branch deletion failed', deleteMessage)",
            "defaultBranchChanged",
            "? 'Default changed, but branch deletion failed'",
            "() => confirmDeleteRemoteBranch(branchName)",
            "() => offerDefaultBranchRepair(branchName",
        ):
            self.assertIn(contract, remote_delete)
        self.assertIn("case 'change-default-and-delete':", confirmations)
        self.assertNotIn("showGlobalLoading", remote_delete)
        self.assertNotIn("hideGlobalLoading", remote_delete)

    def test_bulk_delete_uses_persistent_partial_outcome_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "selection.js"
        ).read_text(encoding="utf-8")
        delete_slice = source[source.index("export async function deleteSelectedItems"):]

        for contract in (
            "startOperationFeedback({",
            "Object.freeze(Array.from(state.selectedItems))",
            "retry: () => confirmDeleteSelectedItems(paths)",
            "openLabel: 'Browse'",
            "operation.fail('Deletion incomplete', detail)",
            "Items in accepted groups may already be deleted. No changes were rolled back.",
            "completedPaths.forEach(path => state.selectedItems.delete(path))",
            "state.selectedItems.size === 0",
        ):
            self.assertIn(contract, delete_slice)
        self.assertNotIn("showGlobalLoading", delete_slice)
        self.assertNotIn("hideGlobalLoading", delete_slice)

    def test_git_lock_cleanup_uses_scoped_persistent_operation(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        source = (modules / "command-palette.js").read_text(encoding="utf-8")
        confirmations = (modules / "git-action-confirmation.js").read_text(encoding="utf-8")
        cleanup = source[
            source.index("export async function cleanGitLocks"):
            source.index("function paletteOnlyCommands")
        ]

        for contract in (
            "getGitActionConfirmation('clean-locks'",
            "label: 'Clean Git recovery state'",
            "scope: 'Local Git repository'",
            "${branch} -> .git locks and operation state",
            "retry: () => confirmCleanGitLocks(branch)",
            "openLabel: 'Source Control'",
            "operation.fail('Could not clean Git recovery state', message)",
            "operation.fail('Could not clean Git recovery state', error.message)",
            "response.removed",
        ):
            self.assertIn(contract, cleanup)
        self.assertIn("case 'clean-locks':", confirmations)
        self.assertIn("Do not continue if another Git process is active.", confirmations)
        self.assertNotIn("showGlobalLoading", source)
        self.assertNotIn("hideGlobalLoading", source)

    def test_git_history_and_commit_diff_use_persistent_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "git-diff.js"
        ).read_text(encoding="utf-8")
        history_slice = source[source.index("export async function showGitHistory"):]

        for contract in (
            "label: 'Load Git history'",
            "${branch} -> latest 30 commits",
            "retry: () => showGitHistory()",
            "${data.commits.length === 1 ? 'commit' : 'commits'} loaded",
            "operation.fail('Could not load Git history', message)",
            "Object.freeze({ ...commit })",
            "label: `Load commit ${shortHash}`",
            "retry: () => loadGitCommitDiff(commit)",
            "operation.fail('Could not load commit diff', message)",
            "openLabel: 'History'",
        ):
            self.assertIn(contract, source)
        for unsafe in (
            "${commit.message}</div>",
            "by ${commit.author}</div>",
            "<strong>Author:</strong> ${commit.author}",
        ):
            self.assertNotIn(unsafe, history_slice)
        self.assertNotIn("showGlobalLoading", history_slice)
        self.assertNotIn("hideGlobalLoading", history_slice)

    def test_working_file_diff_uses_persistent_operation_feedback(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "git-diff.js"
        ).read_text(encoding="utf-8")
        diff_slice = source[
            source.index("export async function showDiffModal"):
            source.index("export async function showGitHistory")
        ]

        for contract in (
            "label: `Load diff for ${path.split('/').pop()}`",
            "scope: `Local Git repository (${providerLabel})`",
            "target: `HEAD -> ${path}`",
            "retry: () => showDiffModal(path, provider)",
            "openLabel: 'Open File'",
            "operation.update({ message: `Loading HEAD and working content for ${path}...` })",
            "throw new Error(headData.message || headData.error",
            "operation.finish(`Diff ready for ${path.split('/').pop()}`",
            "operation.fail(`Could not load diff for ${path.split('/').pop()}`",
            "resetFailedWorkingDiffModal(path)",
        ):
            self.assertIn(contract, diff_slice)
        self.assertNotIn("showGlobalLoading", source)
        self.assertNotIn("hideGlobalLoading", source)

    def test_local_move_flows_use_persistent_partial_outcome_operations(self):
        source = (
            ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "file-tree.js"
        ).read_text(encoding="utf-8")
        backend = (
            ROOT / "custom_components" / "blueprint_studio" / "backend" / "file_manager.py"
        ).read_text(encoding="utf-8")
        move_slice = source[
            source.index("export async function handleFileDropMulti"):
            source.index("export function folderMatchesSearch")
        ]

        for contract in (
            "Object.freeze([...pathsToMove])",
            "label: `Move ${request.paths.length} selected",
            "scope: 'Local Home Assistant workspace'",
            "retry: () => confirmFileDropMulti",
            "singleItem ? \"modal.move_item_title\" : \"modal.move_multi_title\"",
            "paths: Object.freeze([...retryPaths])",
            "openLabel: 'Open Destination'",
            "operation.fail(`Moved ${moved.length} of ${request.paths.length} items`, detail)",
            "Completed moves were not rolled back.",
            "moved.forEach(entry => state.selectedItems.delete(entry.source))",
            "updateMovedTabs(moved)",
            "retry: () => confirmFileDrop(request)",
            "operation.fail('Could not move item', message)",
        ):
            self.assertIn(contract, move_slice)
        for contract in (
            'moved = []',
            'skipped = []',
            '"reason": "Protected path"',
            '"reason": "Destination already exists"',
            '"success": True, "moved": moved, "skipped": skipped',
        ):
            self.assertIn(contract, backend)
        self.assertNotIn("showGlobalLoading", source)
        self.assertNotIn("hideGlobalLoading", source)

    def test_document_saves_use_one_scoped_recoverable_operation_path(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        files = (modules / "file-operations.js").read_text(encoding="utf-8")
        coordinator = (modules / "coordinators" / "FileCoordinator.js").read_text(encoding="utf-8")
        sftp = (modules / "sftp.js").read_text(encoding="utf-8")
        autosave = (modules / "autosave.js").read_text(encoding="utf-8")

        save_wrapper = coordinator[
            coordinator.index("export async function saveFile"):
            coordinator.index("export async function loadFiles")
        ]
        self.assertIn("return saveFileImpl(path, content, options)", save_wrapper)
        self.assertNotIn('action: "write_file"', save_wrapper)

        for contract in (
            "scope: 'Local Home Assistant'",
            "target: request.path",
            "retry: () => saveFile(request.path, request.content)",
            "open: () => revealSavedFile(request.path)",
            "if (!response?.success) throw new Error",
            "options.onResult?.({ success: false, message: error.message })",
            "silentOperation ? null : startOperationFeedback",
        ):
            self.assertIn(contract, files)
        self.assertIn("state.openTabs.find(t => t.path === request.path) || {", files)

        for contract in (
            "scope: `SFTP ${conn?.name || connId}`",
            "target: remotePath",
            "retry: () => saveSftpFile(",
            "open: () => _browseSftpMutation(connId, remotePath)",
            "Remote server rejected the file write",
            "options.onResult?.({ success: false, message })",
            "if (tab.content === request.content) tab.modified = false",
        ):
            self.assertIn(contract, sftp)

        for contract in (
            "scope: 'Workspace documents'",
            "retry: () => saveAllFiles(retryRequests)",
            "Saving file ${index + 1} of ${requests.length}",
            "silentErrorToast: true",
            "silentOperation: true",
            "const unchangedSinceRequest = tab.content === request.content",
            "retryRequests = failed.map(result => ({ path: result.path, content: result.content }))",
            "operation.fail(`${succeeded} saved, ${failed.length} failed`, details",
            "eventBus.emit('file:save-all-complete', { results })",
        ):
            self.assertIn(contract, autosave)
        self.assertIn("silentOperation: reallyAutoSave", coordinator)

    def test_workspace_create_and_rename_mutations_are_scoped_and_recoverable(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        files = (modules / "file-operations.js").read_text(encoding="utf-8")
        sftp = (modules / "sftp.js").read_text(encoding="utf-8")
        coordinator = (modules / "coordinators" / "FileCoordinator.js").read_text(encoding="utf-8")

        create_slice = files[
            files.index("async function confirmCreateFileRetry"):
            files.index("/**\n * Delete a file or folder")
        ]
        for contract in (
            "async function runCreateFile(request, options = {})",
            "label: `Create local file`",
            "scope: 'Local Home Assistant workspace'",
            "target: request.path",
            "retry: () => confirmCreateFileRetry(request)",
            "open: () => browseLocalPath(request.path, true)",
            "if (!response?.success) throw new Error",
            "if (!request.noOpen) eventBus.emit('file:open'",
            "async function runCreateFolder(request)",
            "label: 'Create local folder'",
            "retry: () => runCreateFolder(request)",
            "open: () => browseLocalPath(request.path)",
        ):
            self.assertIn(contract, create_slice)
        self.assertIn(
            'createFileImpl(data.path, data.content, data.noOpen, data.overwrite)',
            coordinator,
        )
        self.assertIn(
            'export async function createFile(path, content = "", noOpen = false, overwrite = false, is_base64 = false, options = {})',
            files,
        )

        rename_slice = files[
            files.index("async function confirmRenameItemRetry"):
            files.index("function fixYamlIndentation")
        ]
        for contract in (
            "async function runRenameItem(request)",
            "label: 'Rename local item'",
            "target: `${request.source} -> ${request.destination}`",
            "retry: () => confirmRenameItemRetry(request)",
            "open: () => browseLocalPath(localParentPath(request.destination))",
            "if (!response?.success) throw new Error",
            "tab.path.startsWith(sourcePrefix)",
            "operation.finish(`Renamed to ${request.destination}`",
        ):
            self.assertIn(contract, rename_slice)

        remote_create = sftp[
            sftp.index("async function _promptNewFile"):
            sftp.index("async function _promptRename")
        ]
        for contract in (
            "async function _runSftpCreate(request)",
            "label: `Create remote ${item}`",
            "scope: `SFTP ${request.connectionName}`",
            "target: request.remotePath",
            "retry: () => _confirmSftpCreateRetry(request)",
            "_openSftpFolder(request.connId, request.remotePath)",
            "if (!result?.success) throw new Error",
            "operation.finish(`Created ${request.remotePath}`)",
        ):
            self.assertIn(contract, remote_create)

    def test_manual_remote_status_and_sftp_connectivity_use_operation_feedback(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        git = (modules / "git-operations.js").read_text(encoding="utf-8")
        gitea = (modules / "gitea-integration.js").read_text(encoding="utf-8")
        sftp = (modules / "sftp.js").read_text(encoding="utf-8")
        coordinator = (modules / "coordinators" / "GitCoordinator.js").read_text(encoding="utf-8")

        git_status = git[
            git.index("export async function gitStatus"):
            git.index("/**\n * Initialize a new Git repository")
        ]
        for contract in (
            "const operation = silent ? null : startGitOperation(",
            "shouldFetch ? 'Fetch GitHub status' : 'Refresh GitHub status'",
            "() => gitStatus(shouldFetch)",
            "operation?.finish(data.has_changes",
            "operation?.fail('Could not refresh GitHub status'",
            "return false",
        ):
            self.assertIn(contract, git_status)

        gitea_status = gitea[
            gitea.index("export async function giteaStatus"):
            gitea.index("// ============================================\n// Gitea Panel UI Update")
        ]
        for contract in (
            "const operation = silent ? null : startOperationFeedback({",
            "scope: 'Gitea repository'",
            "retry: () => giteaStatus(shouldFetch)",
            "operation?.finish(data.has_changes",
            "operation?.fail('Could not refresh Gitea status'",
        ):
            self.assertIn(contract, gitea_status)
        self.assertIn("gitStatusImpl(true)", coordinator)
        self.assertNotIn("checkGitStatusIfEnabledImpl(true)", coordinator)

        connect_slice = sftp[
            sftp.index("export async function connectToServer"):
            sftp.index("export async function navigateSftp")
        ]
        for contract in (
            "options.silentOperation ? null : startOperationFeedback({",
            "scope: `SFTP ${conn.name || connId}`",
            "retry: () => connectToServer(connId)",
            "operation?.finish(`Connected to ${conn.name || connId}`",
            "operation?.fail(`Could not connect to ${conn.name || connId}`",
        ):
            self.assertIn(contract, connect_slice)

        test_slice = sftp[
            sftp.index("async function _testAndSaveSftpConnection"):
            sftp.index("async function _downloadFile")
        ]
        for contract in (
            "label: 'Test SFTP connection'",
            "target,",
            "open: () => _openSftpConnectionSettings(editingConnId)",
            "operation.finish('SFTP connection verified'",
            "Credentials are not stored in operation history",
        ):
            self.assertIn(contract, test_slice)
        self.assertNotIn("retry:", test_slice)
        self.assertNotIn("password", test_slice)
        self.assertNotIn("privateKey", test_slice)

        refresh_slice = sftp[
            sftp.index("export async function refreshSftp"):
            sftp.index("/** Update static UI strings")
        ]
        for contract in (
            "label: 'Refresh SFTP workspace'",
            "retry: () => refreshSftp()",
            "const result = await _refreshCurrentDir(connId)",
            "operation?.finish(`Refreshed ${path}`",
            "operation?.fail(`Could not refresh ${path}`",
        ):
            self.assertIn(contract, refresh_slice)
        self.assertIn("connectToServer(connId, { silentOperation: true })", sftp)

    def test_formatting_and_github_support_actions_use_recoverable_operations(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        files = (modules / "file-operations.js").read_text(encoding="utf-8")
        ui = (modules / "coordinators" / "UICoordinator.js").read_text(encoding="utf-8")

        formatter = files[
            files.index("export async function formatCode"):
            files.index("/**\n * Validate Python using Pyodide")
        ]
        for contract in (
            "const editor = state.editor",
            "label: `Format ${fileName}`",
            "scope: 'Document'",
            "target: filePath",
            "retry: retryFormatting",
            "open: openFormattedFile",
            "operation.update({ message: 'Loading formatting libraries...', percent: 20 })",
            "const documentChanged = state.activeTab !== activeTab",
            "|| editor.getValue() !== content",
            "No formatted text was applied; Retry uses the current document content.",
            "operation.finish(`Formatted ${fileName}`",
            "operation.fail(`Could not format ${fileName}`",
        ):
            self.assertIn(contract, formatter)
        self.assertLess(
            formatter.index("if (documentChanged)"),
            formatter.index("editor.setValue(formatted)"),
        )
        self.assertNotIn("retry: () => formatCode(content", formatter)

        support = ui[
            ui.index("async function runGithubSupportAction"):
            ui.index("/**\n * Performs validation")
        ]
        for contract in (
            "scope: 'GitHub account'",
            "retry: () => runGithubSupportAction({ action, label, target, successToast, fallbackUrl })",
            "if (!response?.success) throw new Error",
            "operation.finish(response.message",
            "operation.fail(`${label} failed`, message)",
            "window.open(fallbackUrl, '_blank')",
        ):
            self.assertIn(contract, support)
        self.assertIn("action: 'github_star'", ui)
        self.assertIn("target: 'ha-china/blueprint-studio'", ui)
        self.assertIn("action: 'github_follow'", ui)
        self.assertIn("target: 'soulripper13'", ui)
        self.assertIn("import { fetchWithAuth } from '../api.js';", ui)
        self.assertIn("import { API_BASE } from '../constants.js';", ui)

    def test_blueprint_conversion_is_one_truthful_recoverable_operation(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        files = (modules / "file-operations.js").read_text(encoding="utf-8")
        coordinator = (modules / "coordinators" / "FileCoordinator.js").read_text(encoding="utf-8")

        conversion = coordinator[
            coordinator.index("async function confirmBlueprintConversionRetry"):
            coordinator.index("/**\n * Saves a file to the backend")
        ]
        for contract in (
            "async function runBlueprintConversion(request)",
            "label: 'Convert to blueprint'",
            "scope: request.sourceKind",
            "target: `${request.sourcePath} -> ${request.destinationPath}`",
            "retry: () => confirmBlueprintConversionRetry(request)",
            "percent: 20",
            "percent: 65",
            "if (!response?.success",
            "const saved = await createFileImpl(",
            "silentOperation: true",
            "silentToast: true",
            "silentErrorToast: true",
            "Blueprint converted but could not be saved",
            "operation.finish(`Created ${request.destinationPath}`",
        ):
            self.assertIn(contract, conversion)
        self.assertNotIn("content: request.content", conversion[conversion.index("startOperationFeedback"):conversion.index("fetchWithAuth")])
        self.assertIn("await runBlueprintConversion(Object.freeze({", coordinator)
        self.assertNotIn("eventBus.emit('file:create', { path: newPath", coordinator)

        create = files[
            files.index("async function confirmCreateFileRetry"):
            files.index("/**\n * Create a new folder")
        ]
        for contract in (
            "async function runCreateFile(request, options = {})",
            "options.silentOperation ? null : startOperationFeedback",
            "if (!options.silentToast) showToast",
            "options.onResult?.({ success: true, response })",
            "options.onResult?.({ success: false, message: error.message })",
            "if (!options.silentErrorToast) showToast",
            "is_base64 = false, options = {}",
        ):
            self.assertIn(contract, create)

    def test_source_control_refreshes_preserve_list_selection_and_diff_position(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        shared = (modules / "source-control-view.js").read_text(encoding="utf-8")
        git_ui = (modules / "git-ui.js").read_text(encoding="utf-8")
        gitea_ui = (modules / "gitea-ui.js").read_text(encoding="utf-8")
        git_diff = (modules / "git-diff.js").read_text(encoding="utf-8")

        for symbol in (
            "captureSourceControlView",
            "scheduleSourceControlViewRestore",
        ):
            self.assertIn(f"export function {symbol}", shared)
            self.assertIn(symbol, git_ui)
            self.assertIn(symbol, gitea_ui)
        for contract in (
            "anchorPath",
            "anchorOffset",
            "focusedPath",
            "container.scrollTop",
            "reconcileSelection",
        ):
            self.assertIn(contract, shared)
        self.assertNotIn("gitState.selectedFiles.clear()", git_ui)
        self.assertNotIn("giteaState.selectedFiles.clear()", gitea_ui)
        for contract in (
            "workingDiffViewContexts",
            "captureMergeViewContext",
            "scheduleMergeViewContextRestore",
            "getActiveIndex",
            "editor.scrollTo(scroll.left, scroll.top)",
        ):
            self.assertIn(contract, git_diff)

    def test_source_control_recovery_states_are_shared_and_actionable(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        recovery = (modules / "source-control-recovery.js").read_text(encoding="utf-8")
        git_ui = (modules / "git-ui.js").read_text(encoding="utf-8")
        gitea_ui = (modules / "gitea-ui.js").read_text(encoding="utf-8")
        git_operations = (modules / "git-operations.js").read_text(encoding="utf-8")
        gitea = (modules / "gitea-integration.js").read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "git.css").read_text(encoding="utf-8")

        for kind in ("authentication", "remote-missing", "remote", "diverged", "conflict", "network"):
            self.assertIn(kind, recovery)
        for action in ("configure", "retry", "pull", "force-push", "hard-reset", "abort"):
            self.assertIn(f"action('{action}'", recovery)
        for provider_ui in (git_ui, gitea_ui):
            self.assertIn("renderSourceControlRecovery", provider_ui)
            self.assertIn("bindSourceControlRecovery", provider_ui)
        self.assertIn('gitState.lastError = error.message', git_operations)
        self.assertIn('giteaState.lastError = error.message', gitea)
        self.assertIn('.source-control-recovery', styles)
        self.assertIn('.source-control-conflict-row', styles)

    def test_asset_previews_have_loading_error_and_text_fallback_states(self):
        modules = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules"
        preview = (modules / "asset-preview.js").read_text(encoding="utf-8")
        files = (modules / "coordinators" / "FileCoordinator.js").read_text(encoding="utf-8")
        styles = (STYLE_MODULES / "previews.css").read_text(encoding="utf-8")

        for label in (
            "Loading preview",
            "Preview unavailable",
            "Preview failed",
            "Image could not be decoded",
            "PDF could not be decoded",
            "Video preview unavailable",
            "Audio preview unavailable",
        ):
            self.assertIn(label, preview)
        self.assertIn("Open as text", preview)
        self.assertIn("forceText: true", preview)
        self.assertIn("data.forceText", files)
        self.assertIn("atob(tab.content || '')", files)
        self.assertIn("Unknown binary files get a recoverable preview", files)
        self.assertIn(".asset-preview-state", styles)
        self.assertIn(".asset-preview-state-actions", styles)


if __name__ == "__main__":
    unittest.main()
