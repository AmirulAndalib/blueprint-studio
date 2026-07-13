import pathlib
import re
import shutil
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
PANEL = ROOT / "custom_components" / "blueprint_studio" / "www" / "panels" / "panel_custom.html"
UI_MODULE = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "ui.js"
PARITY_MATRIX = ROOT / "FRONTEND_FUNCTIONAL_PARITY.md"


class FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.panel = PANEL.read_text(encoding="utf-8")
        cls.ui_module = UI_MODULE.read_text(encoding="utf-8")
        cls.parity_matrix = PARITY_MATRIX.read_text(encoding="utf-8")

    def test_shared_modal_has_accessible_dialog_contract(self):
        modal = re.search(r'<div class="modal" id="modal"(?P<attrs>[^>]*)>', self.panel)
        self.assertIsNotNone(modal)
        attrs = modal.group("attrs")
        self.assertIn('role="dialog"', attrs)
        self.assertIn('aria-modal="true"', attrs)
        self.assertIn('aria-labelledby="modal-title"', attrs)
        self.assertIn('aria-describedby="modal-hint"', attrs)

        close = re.search(r'<button class="modal-close" id="modal-close"(?P<attrs>[^>]*)>', self.panel)
        self.assertIsNotNone(close)
        self.assertIn('aria-label="Close dialog"', close.group("attrs"))

    def test_shared_status_surfaces_are_announced(self):
        self.assertRegex(
            self.panel,
            r'class="toast-container"[^>]*role="region"[^>]*aria-live="polite"',
        )
        self.assertRegex(
            self.panel,
            r'class="loading-overlay visible"[^>]*role="status"[^>]*aria-live="polite"',
        )

    def test_material_icon_font_is_preloaded(self):
        self.assertRegex(
            self.panel,
            r'<link rel="preload"[^>]*material-icons\.woff2[^>]*as="font"[^>]*type="font/woff2"',
        )

    def test_shared_modal_restores_previous_focus(self):
        self.assertIn("function rememberModalFocus()", self.ui_module)
        self.assertIn("function restoreModalFocus()", self.ui_module)
        self.assertGreaterEqual(self.ui_module.count("restoreModalFocus();"), 3)

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
            line for line in self.parity_matrix.splitlines()
            if line.startswith("| ") and "---" not in line and "Capability" not in line
        ]
        self.assertGreaterEqual(len(rows), 60)

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


if __name__ == "__main__":
    unittest.main()
