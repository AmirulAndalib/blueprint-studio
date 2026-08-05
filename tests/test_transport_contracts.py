"""Tests for typed public transport contracts."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "transport_contracts",
    ROOT / "custom_components/blueprint_studio/backend/transport_contracts.py",
)
contracts = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = contracts
SPEC.loader.exec_module(contracts)


class TransportContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.post_fixture = json.loads(
            (ROOT / "tests/fixtures/backend_post_contract.json").read_text()
        )
        cls.get_fixture = json.loads(
            (ROOT / "tests/fixtures/backend_get_contract.json").read_text()
        )

    def test_every_documented_action_has_a_schema(self):
        documented = {item["action"] for item in self.get_fixture["actions"]}
        documented.update(self.post_fixture["actions"])
        documented.update(self.post_fixture["sftp_actions"])
        self.assertEqual(documented, set(contracts.ACTION_SCHEMAS))

    def test_get_fixtures_validate_without_changing_query_strings(self):
        for item in self.get_fixture["actions"]:
            request = {"action": item["action"], **item["query"]}
            result = contracts.validate_action(item["action"], request, transport="get")
            if "show_hidden" in item["query"]:
                self.assertEqual(item["query"]["show_hidden"], result["show_hidden"])

    def test_post_and_sftp_fixtures_validate(self):
        overrides = self.post_fixture["request_overrides"]
        for action in self.post_fixture["actions"]:
            contracts.validate_action(
                action,
                {"action": action, **overrides.get(action, {})},
                transport="post",
            )

        connection = self.post_fixture["sftp_connection"]
        overrides = self.post_fixture["sftp_request_overrides"]
        for action in self.post_fixture["sftp_actions"]:
            contracts.validate_action(
                action,
                {
                    "action": action,
                    "connection": connection,
                    **overrides.get(action, {}),
                },
                transport="sftp",
            )

    def test_required_and_typed_fields_are_rejected_consistently(self):
        invalid = (
            ("write_file", {"content": "x"}, "post"),
            ("delete_multi", {"paths": "not-a-list"}, "post"),
            ("create_file", {"path": "x", "overwrite": "sometimes"}, "post"),
            (
                "sftp_read",
                {
                    "path": "/x",
                    "connection": {"host": "h", "username": "u", "port": 70000},
                },
                "sftp",
            ),
            ("git_checkout_branch", {"branch": "bad..branch"}, "post"),
            ("ai_get_models", {"ai_type": "unknown"}, "post"),
        )
        for action, request, transport in invalid:
            with (
                self.subTest(action=action),
                self.assertRaises(contracts.ValidationError),
            ):
                contracts.validate_action(action, request, transport=transport)

    def test_empty_editor_content_is_present_not_missing(self):
        for action, request, transport in (
            ("check_syntax", {"content": "", "file_path": "empty.yaml"}, "post"),
            ("write_file", {"path": "empty.yaml", "content": ""}, "post"),
            (
                "sftp_write",
                {
                    "path": "/empty.yaml",
                    "content": "",
                    "connection": {"host": "h", "username": "u"},
                },
                "sftp",
            ),
        ):
            with self.subTest(action=action):
                result = contracts.validate_action(action, request, transport=transport)
                self.assertEqual(result["content"], "")

        with self.assertRaisesRegex(contracts.ValidationError, "content"):
            contracts.validate_action(
                "check_syntax", {"file_path": "missing.yaml"}, transport="post"
            )

    def test_repository_creation_uses_handler_compatible_fields(self):
        for action in ("github_create_repo", "gitea_create_repo"):
            with self.subTest(action=action):
                result = contracts.validate_action(
                    action,
                    {"repo_name": "fixture", "is_private": False},
                    transport="post",
                )
                self.assertEqual(result["repo_name"], "fixture")
                self.assertIs(result["is_private"], False)

                with self.assertRaisesRegex(
                    contracts.ValidationError, "Missing required field: repo_name"
                ):
                    contracts.validate_action(
                        action, {"name": "fixture"}, transport="post"
                    )

    def test_ai_proposal_selection_and_empty_revision_are_typed(self):
        selected = contracts.validate_action(
            "ai_apply_proposal",
            {"proposal_id": "fixture", "selected_paths": ["one.yaml"]},
            transport="post",
        )
        revised = contracts.validate_action(
            "ai_revise_proposal",
            {"proposal_id": "fixture", "path": "one.yaml", "new_content": ""},
            transport="post",
        )
        self.assertEqual(selected["selected_paths"], ["one.yaml"])
        self.assertEqual(revised["new_content"], "")
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_action(
                "ai_apply_proposal",
                {"proposal_id": "fixture", "selected_paths": []},
                transport="post",
            )
        for action, field in (
            ("ai_cancel", "request_id"),
            ("ai_undo_proposal", "undo_id"),
        ):
            with self.assertRaises(contracts.ValidationError):
                contracts.validate_action(action, {field: 3}, transport="post")

    def test_terminal_control_messages_are_typed(self):
        contracts.validate_terminal_message({"type": "resize", "rows": 24, "cols": 80})
        contracts.validate_terminal_message({"type": "input", "data": "pwd\n"})
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_terminal_message(
                {"type": "resize", "rows": 0, "cols": 80}
            )
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_terminal_message({"type": "input", "data": 3})

    def test_stream_and_upload_metadata_contracts(self):
        contracts.validate_stream(
            "serve_file", {"action": "serve_file", "path": "a.yaml"}
        )
        contracts.validate_upload_metadata("a.yaml", False, False, "merge", None)
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_stream("serve_file", {"action": "serve_file"})
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_upload_metadata("a.yaml", False, False, "invalid", None)


if __name__ == "__main__":
    unittest.main()
