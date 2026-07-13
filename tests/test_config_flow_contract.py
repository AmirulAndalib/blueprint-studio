import ast
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG_FLOW_PATH = ROOT / "custom_components" / "blueprint_studio" / "config_flow.py"


class ConfigFlowContractTests(unittest.TestCase):
    def test_user_step_keeps_single_instance_abort_guard(self):
        tree = ast.parse(CONFIG_FLOW_PATH.read_text(encoding="utf-8"))
        user_step = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "async_step_user"
        )

        current_entries_guard = any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "_async_current_entries"
            for node in ast.walk(user_step)
        )
        abort_reason = any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "async_abort"
            and any(
                keyword.arg == "reason"
                and isinstance(keyword.value, ast.Constant)
                and keyword.value.value == "single_instance_allowed"
                for keyword in node.keywords
            )
            for node in ast.walk(user_step)
        )

        self.assertTrue(current_entries_guard)
        self.assertTrue(abort_reason)


if __name__ == "__main__":
    unittest.main()
