import ast
import importlib.util
import pathlib
import sys
import types
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INIT_PATH = ROOT / "custom_components" / "blueprint_studio" / "__init__.py"
RUNTIME_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend" / "runtime.py"
STORAGE_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend" / "storage.py"
SETTINGS_PATH = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "settings.js"
CONSTANTS_PATH = ROOT / "custom_components" / "blueprint_studio" / "www" / "modules" / "constants.js"


def _module_constant(path: pathlib.Path, name: str):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError(f"Missing module constant {name}")


def _load_storage_module():
    """Load the pure migration module without installing Home Assistant."""
    homeassistant = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    helpers = types.ModuleType("homeassistant.helpers")
    storage = types.ModuleType("homeassistant.helpers.storage")

    class FakeStore:
        @classmethod
        def __class_getitem__(cls, item):
            return cls

        def __init__(self, *args, **kwargs):
            pass

    core.HomeAssistant = object
    storage.Store = FakeStore
    modules = {
        "homeassistant": homeassistant,
        "homeassistant.core": core,
        "homeassistant.helpers": helpers,
        "homeassistant.helpers.storage": storage,
    }
    previous = {name: sys.modules.get(name) for name in modules}
    sys.modules.update(modules)
    try:
        spec = importlib.util.spec_from_file_location("blueprint_studio_storage_test", STORAGE_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module
    finally:
        for name, old_module in previous.items():
            if old_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old_module


class StorageContractTests(unittest.TestCase):
    def test_home_assistant_store_identity_is_stable(self):
        source = INIT_PATH.read_text(encoding="utf-8")
        self.assertIn("STORAGE_VERSION = CURRENT_STORAGE_VERSION", source)
        self.assertIn('STORAGE_KEY = f"{DOMAIN}.credentials"', source)
        runtime_source = RUNTIME_PATH.read_text(encoding="utf-8")
        self.assertIn("BlueprintStudioStore(hass, storage_key)", runtime_source)

    def test_version_one_migration_preserves_workspace_and_unknown_fields(self):
        module = _load_storage_module()
        original = {
            "username": "octocat",
            "token": "encoded",
            "settings": {
                "openTabs": [{"path": "empty.yaml", "modified": True, "content": ""}],
                "activeTabPath": "empty.yaml",
                "futureSetting": {"nested": True},
            },
            "futureRoot": [1, 2, 3],
        }

        migrated = module.migrate_storage_data(1, 1, original)

        self.assertEqual(2, migrated["schema_version"])
        self.assertEqual({"username": "octocat", "token": "encoded"}, migrated["credentials"])
        self.assertEqual([1, 2, 3], migrated["futureRoot"])
        self.assertEqual("", migrated["settings"]["openTabs"][0]["content"])
        self.assertEqual(original["username"], "octocat")
        self.assertIn("token", original)

    def test_migration_is_idempotent_and_rejects_invalid_settings(self):
        module = _load_storage_module()
        current = {"settings": {"openTabs": []}, "schema_version": 2, "unknown": "kept"}
        self.assertEqual(current, module.migrate_storage_data(2, 1, current))
        with self.assertRaisesRegex(ValueError, "settings must be an object"):
            module.migrate_storage_data(1, 1, {"settings": []})

    def test_each_historical_shape_migrates_losslessly(self):
        module = _load_storage_module()
        historical_shapes = [
            {},
            {"settings": {"openTabs": [], "activeTabPath": None}},
            {"username": "legacy", "token": None, "settings": {}},
            {
                "github_credentials": {"username": "git", "token": "encoded"},
                "gitea_credentials": {"username": "tea", "token": None},
                "settings": {"sshHosts": [{"id": "host-1"}]},
                "unknown": {"preserved": True},
            },
        ]

        for old_data in historical_shapes:
            migrated = module.migrate_storage_data(1, 0, old_data)
            self.assertEqual(2, migrated["schema_version"])
            self.assertEqual(old_data.get("settings", {}), migrated["settings"])
            if "unknown" in old_data:
                self.assertEqual(old_data["unknown"], migrated["unknown"])

    def test_future_storage_version_is_rejected_without_mutating_input(self):
        module = _load_storage_module()
        original = {"settings": {"openTabs": [{"path": "keep.yaml"}]}}
        snapshot = {"settings": {"openTabs": [{"path": "keep.yaml"}]}}

        with self.assertRaisesRegex(ValueError, "Unsupported"):
            module.migrate_storage_data(3, 0, original)
        self.assertEqual(snapshot, original)

    def test_workspace_and_unsaved_buffer_fields_remain_persisted(self):
        source = SETTINGS_PATH.read_text(encoding="utf-8")
        required_fields = {
            "openTabs", "activeTabPath", "rememberWorkspace", "splitView",
            "currentNavigationPath", "navigationHistory", "sshHosts",
            "activeSftpConnectionId", "activeSftpPath", "content",
            "originalContent", "cursor", "scroll", "workspaceLayout",
            "terminalPanelHeight", "splitPrimaryPercent",
        }
        for field in required_fields:
            self.assertIn(field, source)

    def test_browser_settings_key_is_stable(self):
        source = CONSTANTS_PATH.read_text(encoding="utf-8")
        self.assertIn('STORAGE_KEY = "blueprint_studio_settings"', source)


if __name__ == "__main__":
    unittest.main()
