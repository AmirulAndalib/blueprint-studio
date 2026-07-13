import importlib.util
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend"
VALIDATORS_PATH = BACKEND_PATH / "ai_validators.py"


def load_validators():
    package_name = "blueprint_studio_test_backend"
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

    import sys
    import types

    package = types.ModuleType(package_name)
    package.__path__ = [str(BACKEND_PATH)]
    sys.modules[package_name] = package
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
            any(error["type"] == "invalid_blueprint_domain" for error in result.get("errors", [])),
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
                and ("'infrared'" in warning["message"] or "'radio_frequency'" in warning["message"])
                for warning in result.get("warnings", [])
            ),
            result.get("warnings", []),
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
            any("'entity_id:' inside 'data:' is deprecated" in warning["message"] for warning in warnings),
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
            any("'entity_id:' inside 'data:' is deprecated" in warning["message"] for warning in warnings),
            warnings,
        )


if __name__ == "__main__":
    unittest.main()
