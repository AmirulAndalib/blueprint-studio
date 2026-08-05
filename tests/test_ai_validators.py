import ast
import importlib.util
import json
import pathlib
import re
import unittest
import warnings


ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend"
VALIDATORS_PATH = BACKEND_PATH / "ai_validators.py"
AI_MANAGER_PATH = BACKEND_PATH / "ai_manager.py"
CLAW_HOOK_PATH = BACKEND_PATH / "claw_hook.py"


def load_validators():
    package_name = "blueprint_studio_test_backend"
    import sys
    import types

    package = types.ModuleType(package_name)
    package.__path__ = [str(BACKEND_PATH)]
    sys.modules[package_name] = package

    metadata_spec = importlib.util.spec_from_file_location(
        f"{package_name}.ha_metadata",
        BACKEND_PATH / "ha_metadata.py",
    )
    metadata_module = importlib.util.module_from_spec(metadata_spec)
    metadata_spec.loader.exec_module(metadata_module)
    sys.modules[f"{package_name}.ha_metadata"] = metadata_module

    constants_spec = importlib.util.spec_from_file_location(
        f"{package_name}.ai_constants",
        BACKEND_PATH / "ai_constants.py",
    )
    constants_module = importlib.util.module_from_spec(constants_spec)
    constants_spec.loader.exec_module(constants_module)

    util_spec = importlib.util.spec_from_file_location(
        f"{package_name}.util",
        BACKEND_PATH / "util.py",
    )
    util_module = importlib.util.module_from_spec(util_spec)
    util_spec.loader.exec_module(util_module)

    sys.modules[f"{package_name}.ai_constants"] = constants_module
    sys.modules[f"{package_name}.util"] = util_module

    validators_spec = importlib.util.spec_from_file_location(
        f"{package_name}.ai_validators",
        VALIDATORS_PATH,
    )
    validators_module = importlib.util.module_from_spec(validators_spec)
    validators_spec.loader.exec_module(validators_module)
    return validators_module


class AiValidatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validators = load_validators()

    def _check_yaml(self, content):
        response = self.validators.check_yaml(content)
        return json.loads(response.text)

    def _check_syntax(self, content, file_path=""):
        response = self.validators.check_syntax(content, file_path)
        return json.loads(response.text)

    def test_template_blueprint_domain_is_valid(self):
        content = """blueprint:
  name: Template Helper
  domain: template
  description: Create reusable template entities.
  author: Blueprint Studio
"""

        result = self._check_syntax(content, "template_blueprint.yaml")

        self.assertTrue(result["valid"], result)
        self.assertFalse(
            any(
                error["type"] == "invalid_blueprint_domain"
                for error in result.get("errors", [])
            ),
            result,
        )

    def test_recent_entity_domains_are_known(self):
        content = """- action: infrared.learn_command
  target:
    entity_id: infrared.living_room_remote
- action: radio_frequency.send_command
  target:
    entity_id: radio_frequency.garage_remote
"""

        result = self._check_yaml(content)

        self.assertTrue(result["valid"])
        self.assertFalse(
            any(
                warning["type"] == "invalid_domain"
                and (
                    "'infrared'" in warning["message"]
                    or "'radio_frequency'" in warning["message"]
                )
                for warning in result.get("warnings", [])
            ),
            result.get("warnings", []),
        )

    def test_live_custom_domain_is_accepted(self):
        response = self.validators.check_yaml(
            "entity_id: acme_custom.demo\n", known_domains={"acme_custom"}
        )
        result = json.loads(response.text)
        self.assertTrue(result["valid"], result)
        self.assertFalse(
            any(item["type"] == "invalid_domain" for item in result.get("warnings", []))
        )

    def test_entity_id_in_python_script_data_is_not_deprecated(self):
        content = """- action: python_script.hass_entities
  data:
    action: set_state
    entity_id: binary_sensor.rain_status
    state: 'off'
"""

        result = self._check_yaml(content)
        warnings = result.get("warnings", [])

        self.assertTrue(result["valid"])
        self.assertFalse(
            any(
                "'entity_id:' inside 'data:' is deprecated" in warning["message"]
                for warning in warnings
            ),
            warnings,
        )

    def test_entity_id_in_light_action_data_is_still_deprecated(self):
        content = """- action: light.turn_on
  data:
    entity_id: light.kitchen
    brightness: 100
"""

        result = self._check_yaml(content)
        warnings = result.get("warnings", [])

        self.assertTrue(result["valid"])
        self.assertTrue(
            any(
                "'entity_id:' inside 'data:' is deprecated" in warning["message"]
                for warning in warnings
            ),
            warnings,
        )

    def test_phase_zero_validator_compatibility_baseline(self):
        fixtures = {
            "modern_minimal": """alias: Minimal
triggers:
  - trigger: state
    entity_id: sensor.example
actions:
  - action: light.turn_on
""",
            "legacy_supported": """alias: Legacy
trigger:
  - platform: state
    entity_id: sensor.example
action:
  - service: light.turn_on
    data_template:
      brightness_pct: 50
""",
            "custom_integration": """alias: Custom
triggers: []
actions:
  - action: acme_custom.activate
    target:
      entity_id: acme_custom.demo
""",
            "blueprint": """blueprint:
  name: Test
  domain: automation
  input: {}
triggers: []
actions: []
""",
            "malformed": """alias: Broken
triggers:
  - trigger: state
    entity_id: [sensor.one
""",
        }

        results = {
            name: self._check_yaml(content) for name, content in fixtures.items()
        }
        self.assertEqual(
            results["modern_minimal"],
            {
                "valid": True,
                "message": "YAML is valid and follows best practices!",
            },
        )
        self.assertEqual(
            results["blueprint"],
            {
                "valid": True,
                "message": "YAML is valid and follows best practices!",
            },
        )
        self.assertEqual(
            [warning["type"] for warning in results["legacy_supported"]["warnings"]],
            ["singular_key", "singular_key", "legacy_syntax", "deprecated_syntax"],
        )
        self.assertTrue(results["custom_integration"]["valid"])
        self.assertEqual(
            [warning["type"] for warning in results["custom_integration"]["warnings"]],
            ["invalid_domain"],
        )
        self.assertFalse(results["malformed"]["valid"])
        self.assertEqual(results["malformed"]["type"], "syntax_error")

    def test_official_minimal_file_roles_have_no_false_requirements(self):
        fixtures = {
            "automation": (
                "automations.yaml",
                """- triggers: []
  actions: []
""",
            ),
            "script": (
                "scripts.yaml",
                """example_script:
  sequence:
    - action: light.turn_on
""",
            ),
            "scene": (
                "scenes.yaml",
                """- name: Minimal scene
  entities:
    light.example: "on"
""",
            ),
            "blueprint": (
                "minimal_blueprint.yaml",
                """blueprint:
  name: Minimal blueprint
  domain: automation
triggers: []
actions: []
""",
            ),
        }

        for name, (path, content) in fixtures.items():
            with self.subTest(name=name):
                result = self._check_syntax(content, path)
                self.assertTrue(result["valid"], result)
                warnings = result.get("warnings", [])
                if name == "blueprint":
                    self.assertEqual(
                        {item["type"] for item in warnings},
                        {"missing_blueprint_description", "missing_blueprint_author"},
                        result,
                    )
                    self.assertTrue(
                        all("recommended" in item["message"] for item in warnings)
                    )
                else:
                    self.assertEqual(warnings, [], result)

    def test_missing_automation_id_is_one_optional_recommendation(self):
        result = self._check_syntax(
            """- alias: Optional ID
  triggers: []
  actions: []
""",
            "automations.yaml",
        )

        warnings = [
            item for item in result.get("warnings", []) if item["type"] == "missing_id"
        ]
        self.assertEqual(len(warnings), 1, result)
        self.assertIn("optional", warnings[0]["message"])
        self.assertIn("UI editing and debug traces", warnings[0]["solution"])
        self.assertNotIn("timestamp", warnings[0]["solution"])


class AiPhaseZeroContractTests(unittest.TestCase):
    @staticmethod
    def _assigned_string(path, function_name, variable_name):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                or node.name != function_name
            ):
                continue
            for child in ast.walk(node):
                if not isinstance(child, ast.Assign):
                    continue
                if any(
                    isinstance(target, ast.Name) and target.id == variable_name
                    for target in child.targets
                ):
                    if isinstance(child.value, ast.Constant) and isinstance(
                        child.value.value, str
                    ):
                        return child.value.value
        raise AssertionError(f"Could not find {variable_name} in {function_name}")

    def test_external_provider_prompt_snapshot(self):
        system_prompt = self._assigned_string(
            AI_MANAGER_PATH, "_build_ai_prompt", "system"
        )
        required_lines = [
            "CURRENT HOME ASSISTANT YAML GUIDANCE (capability-based; reviewed 2026-07-29):",
            "1. Prefer current automation keys triggers:, conditions:, and actions:, with '- trigger: platform' and '- action: domain.service' entries.",
            "2. Legacy trigger:/condition:/action:, '- platform:', and 'service:' forms remain supported. Preserve them unless the user asks to modernize.",
            "3. Automation id is optional. A stable unique string enables UI editing and debug traces; it has no required timestamp format.",
            "4. Omit conditions when there are none. metadata, empty data, and explicit mode are optional; mode defaults to single.",
            "5. Match the destination role: automations and scenes are root lists; scripts are a root mapping; configuration files use integration keys.",
            "6. For edits, preserve comments, includes, anchors, formatting, and unrelated content. Change only what the request requires.",
            "7. Never invent installed entities, devices, action fields, credentials, or secrets. Use obvious placeholders and state assumptions.",
        ]
        self.assertEqual(
            [
                line
                for line in system_prompt.splitlines()
                if line.startswith(tuple("1234567")) or line.startswith("CURRENT HOME")
            ],
            required_lines,
        )
        for forbidden in (
            "MUST have",
            "13-digit",
            "Include metadata",
            "conditions: [] if",
            "2024+",
        ):
            self.assertNotIn(forbidden, system_prompt)
        for reference in (
            "https://www.home-assistant.io/docs/automation/yaml/",
            "https://www.home-assistant.io/docs/scripts/",
            "https://www.home-assistant.io/integrations/scene/",
            "https://www.home-assistant.io/docs/blueprint/schema/",
        ):
            self.assertIn(reference, system_prompt)

        manager_source = AI_MANAGER_PATH.read_text(encoding="utf-8")
        for provider in ("gemini", "openai", "claude"):
            self.assertIn(
                f'cloud_provider in ["gemini", "openai", "claude"]', manager_source
            )
            self.assertIn(provider, manager_source)
        self.assertIn("provider_context = build_provider_context(", manager_source)
        self.assertEqual(
            manager_source.count("self._build_ai_prompt(provider_context)"), 3
        )

    def test_destination_role_guidance_and_generator_layout(self):
        manager_source = AI_MANAGER_PATH.read_text(encoding="utf-8")
        self.assertIn("automations.yaml root list", manager_source)
        self.assertIn("scripts.yaml root mapping", manager_source)
        self.assertIn("scenes.yaml root list", manager_source)
        self.assertIn(
            "ind, hdr = self._generation_layout(config_type, current_file)",
            manager_source,
        )
        self.assertIn('code = f"""{hdr}- name: {name}', manager_source)

    def test_conversation_agent_proposal_parsing_baseline(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SyntaxWarning)
            tree = ast.parse(CLAW_HOOK_PATH.read_text(encoding="utf-8"))
        pattern = None
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            if not any(
                isinstance(target, ast.Name) and target.id == "_EDIT_BLOCK_RE"
                for target in node.targets
            ):
                continue
            if (
                isinstance(node.value, ast.Call)
                and node.value.args
                and isinstance(node.value.args[0], ast.Constant)
            ):
                pattern = node.value.args[0].value
        self.assertIsNotNone(pattern)
        edit_pattern = re.compile(pattern, re.DOTALL | re.MULTILINE)

        fixtures = {
            "create": "```edit:automations/new.yaml\nalias: New\n```",
            "fix": "I fixed it.\n```edit:configuration.yaml\ndefault_config:\n```",
            "edit_multiple": "```edit:scripts.yaml\ntest: {}\n```\n```edit:scenes.yaml\n[]\n```",
            "explain": "This automation turns on a light.",
            "convert": "Here is a blueprint without a requested file edit.",
        }
        parsed = {
            name: [
                (match.group(1), match.group(2))
                for match in edit_pattern.finditer(response)
            ]
            for name, response in fixtures.items()
        }
        self.assertEqual(parsed["create"], [("automations/new.yaml", "alias: New\n")])
        self.assertEqual(parsed["fix"], [("configuration.yaml", "default_config:\n")])
        self.assertEqual(
            [path for path, _ in parsed["edit_multiple"]],
            ["scripts.yaml", "scenes.yaml"],
        )
        self.assertEqual(parsed["explain"], [])
        self.assertEqual(parsed["convert"], [])

        adversarial = {
            "unterminated": "```edit:automations.yaml\nalias: Missing close",
            "empty_path": "```edit:\nalias: Missing path\n```",
            "embedded_fence": "```edit:scripts.yaml\ntest: |\n  ```not-a-close\n```",
            "windows_path": "```edit:C:\\\\temp\\\\bad.yaml\ntest: true\n```",
        }
        adversarial_parsed = {
            name: [
                (match.group(1), match.group(2))
                for match in edit_pattern.finditer(response)
            ]
            for name, response in adversarial.items()
        }
        self.assertEqual(adversarial_parsed["unterminated"], [])
        self.assertEqual(adversarial_parsed["empty_path"], [])
        self.assertEqual(
            adversarial_parsed["embedded_fence"],
            [("scripts.yaml", "test: |\n  ```not-a-close\n")],
        )
        self.assertEqual(
            adversarial_parsed["windows_path"][0][0], "C:\\\\temp\\\\bad.yaml"
        )

        claw_source = CLAW_HOOK_PATH.read_text(encoding="utf-8")
        self.assertNotIn("_extract_and_apply_edits", claw_source)
        self.assertNotIn("write_text(", claw_source)
        self.assertIn("proposal_store.create", claw_source)
        self.assertIn("system_guidance", claw_source)

    def test_current_provider_context_boundary_snapshot(self):
        claw_source = CLAW_HOOK_PATH.read_text(encoding="utf-8")
        manager_source = AI_MANAGER_PATH.read_text(encoding="utf-8")
        frontend_source = (
            ROOT
            / "custom_components"
            / "blueprint_studio"
            / "www"
            / "modules"
            / "ai-ui.js"
        ).read_text(encoding="utf-8")

        self.assertNotIn("file_content[:6000]", claw_source)
        self.assertIn("[Selected file excerpt", claw_source)
        self.assertIn("ProviderRequestContext", manager_source)
        self.assertIn("Selected file excerpt", manager_source)
        self.assertNotIn('context = f"Current file:', manager_source)
        self.assertIn(
            "current_file: includeFile && state.activeTab ? state.activeTab.path : null",
            frontend_source,
        )
        self.assertIn(
            "file_content: includeFile && state.activeTab && state.editor ? state.editor.getValue() : null",
            frontend_source,
        )
        self.assertIn("selected_excerpt:", frontend_source)
        self.assertIn("include_file_context: includeFile", frontend_source)
        self.assertIn("action: 'ai_preview_context'", frontend_source)
        self.assertIn("ai-processing-boundary", frontend_source)


if __name__ == "__main__":
    unittest.main()
