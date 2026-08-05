"""Grounded, non-executing context and validation for AI YAML generation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePath
import re
from typing import Any, Iterable

import yaml


REQUEST_KINDS = ("explain", "validate", "fix", "create", "convert", "edit")
MAX_GROUNDED_ACTIONS = 20
MAX_GROUNDED_ENTITIES = 30
ENTITY_ID_RE = re.compile(r"\b[a-z_][a-z0-9_]*\.[a-z0-9_]+\b", re.IGNORECASE)
ACTION_ID_RE = re.compile(r"\b[a-z_][a-z0-9_]*\.[a-z0-9_]+\b", re.IGNORECASE)
PLACEHOLDER_RE = re.compile(
    r"^(?:<[^>]+>|REPLACE_[A-Z0-9_]+|example\.|[a-z_][a-z0-9_]*\.your_device$)",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class TaggedValue:
    """An inert representation of a Home Assistant YAML tag."""

    tag: str
    value: Any


class HAYamlLoader(yaml.SafeLoader):
    """Safe loader which preserves custom tags without resolving them."""


def _construct_tagged(
    loader: HAYamlLoader, tag_suffix: str, node: yaml.Node
) -> TaggedValue:
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node)
    else:
        value = loader.construct_mapping(node)
    return TaggedValue(f"!{tag_suffix}", value)


HAYamlLoader.add_multi_constructor("!", _construct_tagged)


def parse_yaml_inert(content: str) -> Any:
    """Parse YAML without evaluating templates, tags, or generated code."""
    return yaml.load(content, Loader=HAYamlLoader)


def classify_request(query: str, has_file: bool = False) -> str:
    """Classify a user request before choosing generation behavior."""
    text = query.casefold()
    rules = (
        ("convert", ("convert", "transform", "turn this into", "migrate to")),
        ("fix", ("fix", "repair", "correct", "resolve", "make this valid")),
        ("validate", ("validate", "check", "lint", "find errors", "is this valid")),
        ("explain", ("explain", "what does", "why does", "describe", "how does")),
        ("edit", ("edit", "change", "update", "modify", "rename", "add to", "remove")),
        ("create", ("create", "generate", "make", "write", "build")),
    )
    for kind, phrases in rules:
        if any(phrase in text for phrase in phrases):
            return kind
    return "edit" if has_file else "create"


def destination_role(current_file: str | None, file_content: str | None = None) -> str:
    """Return the stable destination role used by every generator path."""
    filename = PurePath((current_file or "").replace("\\", "/")).name.casefold()
    if filename == "automations.yaml":
        return "automation_list"
    if filename == "scripts.yaml":
        return "script_mapping"
    if filename == "scenes.yaml":
        return "scene_list"
    if filename in {"configuration.yaml", "configuration.yml"}:
        return "configuration_mapping"
    normalized_path = (
        f"/{(current_file or '').replace(chr(92), '/').casefold().strip('/')}"
    )
    if "/blueprints/" in normalized_path and filename.endswith((".yaml", ".yml")):
        return "blueprint_mapping"
    if file_content:
        try:
            parsed = parse_yaml_inert(file_content)
            if isinstance(parsed, dict) and isinstance(parsed.get("blueprint"), dict):
                return "blueprint_mapping"
        except yaml.YAMLError:
            pass
    return "unknown"


def _query_domains(query: str, snapshot: dict[str, Any]) -> set[str]:
    text = query.casefold()
    domains = set()
    for domain in snapshot.get("domains", []):
        label = str(domain).casefold()
        if re.search(rf"(?<![a-z0-9_]){re.escape(label)}s?(?![a-z0-9_])", text):
            domains.add(label)
    domains.update(
        match.group(0).partition(".")[0].casefold()
        for match in ENTITY_ID_RE.finditer(query)
    )
    return domains


def select_grounding(query: str, snapshot: dict[str, Any] | None) -> dict[str, Any]:
    """Select only live records relevant to the request."""
    if not snapshot:
        return {
            "ha_version": "unknown",
            "partial": True,
            "actions": [],
            "entities": [],
            "exact_entity_ids": [],
            "unresolved_references": [],
            "authority": "fallback",
        }

    text = query.casefold()
    explicit_ids = {match.group(0).casefold() for match in ENTITY_ID_RE.finditer(query)}
    domains = _query_domains(query, snapshot)
    entities = []
    exact_entity_ids: list[str] = []
    known_ids = {
        str(item.get("id") or item.get("service") or "").casefold()
        for item in snapshot.get("actions", [])
    }
    for item in snapshot.get("entities", []):
        entity_id = str(item.get("id") or item.get("entity_id") or "").casefold()
        known_ids.add(entity_id)
        name = str(item.get("name") or item.get("friendly_name") or "").casefold()
        if entity_id in explicit_ids or (name and len(name) >= 3 and name in text):
            entities.append(item)
            if entity_id in explicit_ids:
                exact_entity_ids.append(entity_id)
    if not entities and domains:
        entities = [
            item
            for item in snapshot.get("entities", [])
            if item.get("domain") in domains
        ]

    actions = []
    for item in snapshot.get("actions", []):
        action_id = str(item.get("id") or item.get("service") or "").casefold()
        name = str(item.get("name") or "").casefold()
        domain = str(item.get("domain") or action_id.partition(".")[0]).casefold()
        action_name = action_id.partition(".")[2].replace("_", " ")
        if (
            action_id in text
            or domain in domains
            or (name and name in text)
            or (action_name and action_name in text)
        ):
            actions.append(item)

    unresolved = sorted(
        value
        for value in explicit_ids
        if value not in known_ids and not PLACEHOLDER_RE.match(value)
    )
    return {
        "ha_version": snapshot.get("ha_version", "unknown"),
        "partial": bool(snapshot.get("partial", False)),
        "actions": actions[:MAX_GROUNDED_ACTIONS],
        "entities": entities[:MAX_GROUNDED_ENTITIES],
        "exact_entity_ids": exact_entity_ids[:MAX_GROUNDED_ENTITIES],
        "unresolved_references": unresolved,
        "authority": "live_instance_partial"
        if snapshot.get("partial")
        else "live_instance",
    }


def build_generation_context(
    query: str,
    current_file: str | None,
    file_content: str | None,
    snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build the provider-neutral context shared by all generator paths."""
    grounding = select_grounding(query, snapshot)
    role = destination_role(current_file, file_content)
    if role == "unknown" and "blueprint" in query.casefold():
        role = "blueprint_mapping"
    return {
        "request_kind": classify_request(query, file_content is not None),
        "destination_role": role,
        **grounding,
    }


def _finding(
    code: str,
    message: str,
    *,
    severity: str = "error",
    path: str = "$",
    authority: str = "yaml_schema",
) -> dict[str, str]:
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "path": path,
        "authority": authority,
    }


def _walk(value: Any, path: str = "$") -> Iterable[tuple[Any, str]]:
    yield value, path
    if isinstance(value, dict):
        for key, child in value.items():
            yield from _walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk(child, f"{path}[{index}]")


def _scalar_values(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for child in value:
            yield from _scalar_values(child)


def _target_domains(target: Any) -> set[str]:
    domains: set[str] = set()
    if isinstance(target, dict):
        for key, value in target.items():
            if key == "domain":
                domains.update(_scalar_values(value))
            else:
                domains.update(_target_domains(value))
    elif isinstance(target, list):
        for value in target:
            domains.update(_target_domains(value))
    return domains


def _root_findings(parsed: Any, role: str) -> list[dict[str, str]]:
    if role in {"automation_list", "scene_list"} and not isinstance(parsed, list):
        return [
            _finding(
                "wrong_root_shape", f"{role} requires a YAML list at the document root"
            )
        ]
    if role in {
        "script_mapping",
        "configuration_mapping",
        "blueprint_mapping",
    } and not isinstance(parsed, dict):
        return [
            _finding(
                "wrong_root_shape",
                f"{role} requires a YAML mapping at the document root",
            )
        ]
    if (
        role == "blueprint_mapping"
        and isinstance(parsed, dict)
        and not isinstance(parsed.get("blueprint"), dict)
    ):
        return [
            _finding(
                "missing_blueprint_header",
                "A blueprint file requires a blueprint mapping",
            )
        ]
    return []


def validate_generated_yaml(
    content: str,
    role: str,
    snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    """Parse and validate generated YAML against schema and live instance metadata."""
    authority = (
        "live_instance"
        if snapshot and not snapshot.get("partial")
        else "live_instance_partial"
    )
    try:
        parsed = parse_yaml_inert(content)
    except yaml.YAMLError as err:
        return {
            "valid": False,
            "parsed": False,
            "authority": ["yaml_parser"],
            "findings": [
                _finding("yaml_parse_error", str(err), authority="yaml_parser")
            ],
            "assumptions": [],
        }

    findings = _root_findings(parsed, role)
    assumptions: list[str] = []
    if not snapshot:
        assumptions.append(
            "Live Home Assistant metadata was unavailable; instance references were not verified."
        )
        return {
            "valid": not any(item["severity"] == "error" for item in findings),
            "parsed": True,
            "authority": ["yaml_parser", "yaml_schema"],
            "findings": findings,
            "assumptions": assumptions,
        }

    entities = {
        str(item.get("id") or item.get("entity_id"))
        for item in snapshot.get("entities", [])
        if item.get("id") or item.get("entity_id")
    }
    actions = {
        str(item.get("id") or item.get("service")): item
        for item in snapshot.get("actions", [])
        if item.get("id") or item.get("service")
    }

    for node, path in _walk(parsed):
        if not isinstance(node, dict):
            continue
        for key in ("action", "service"):
            action_id = node.get(key)
            if (
                not isinstance(action_id, str)
                or "{{" in action_id
                or isinstance(action_id, TaggedValue)
            ):
                continue
            meta = actions.get(action_id)
            if meta is None and not PLACEHOLDER_RE.match(action_id):
                findings.append(
                    _finding(
                        "unknown_action",
                        f"Action '{action_id}' is not present in live Home Assistant metadata",
                        path=f"{path}.{key}",
                        authority=authority,
                    )
                )
                continue
            if meta is None:
                assumptions.append(
                    f"Action placeholder '{action_id}' must be selected before apply."
                )
                continue
            allowed_fields = set((meta.get("fields") or {}).keys())
            supplied_fields: set[str] = set()
            for data_key in ("data", "data_template"):
                data = node.get(data_key)
                if isinstance(data, dict):
                    supplied_fields.update(str(field) for field in data)
                    for field in data:
                        if isinstance(field, str) and field not in allowed_fields:
                            findings.append(
                                _finding(
                                    "unsupported_action_field",
                                    f"Field '{field}' is not supported by action '{action_id}'",
                                    path=f"{path}.{data_key}.{field}",
                                    authority=authority,
                                )
                            )
            required_fields = {
                field
                for field, details in (meta.get("fields") or {}).items()
                if isinstance(details, dict) and details.get("required")
            }
            for field in sorted(required_fields - supplied_fields):
                findings.append(
                    _finding(
                        "missing_required_action_field",
                        f"Required field '{field}' is missing for action '{action_id}'",
                        path=path,
                        authority=authority,
                    )
                )
            target = node.get("target")
            if target is not None and not meta.get("supports_target"):
                findings.append(
                    _finding(
                        "unsupported_action_target",
                        f"Action '{action_id}' does not expose target metadata",
                        path=f"{path}.target",
                        authority=authority,
                    )
                )
            allowed_domains = _target_domains(meta.get("target"))
            if isinstance(target, dict) and allowed_domains:
                for entity_id in _scalar_values(target.get("entity_id")):
                    if (
                        "{{" not in entity_id
                        and not PLACEHOLDER_RE.match(entity_id)
                        and entity_id.partition(".")[0] not in allowed_domains
                    ):
                        findings.append(
                            _finding(
                                "incompatible_action_target",
                                f"Entity '{entity_id}' is not a supported target for action '{action_id}'",
                                path=f"{path}.target.entity_id",
                                authority=authority,
                            )
                        )

        entity_values: list[tuple[str, str]] = []
        if "entity_id" in node:
            entity_values.extend(
                (value, f"{path}.entity_id")
                for value in _scalar_values(node["entity_id"])
            )
        target = node.get("target")
        if isinstance(target, dict) and "entity_id" in target:
            entity_values.extend(
                (value, f"{path}.target.entity_id")
                for value in _scalar_values(target["entity_id"])
            )
        for entity_id, entity_path in entity_values:
            if "{{" in entity_id or PLACEHOLDER_RE.match(entity_id):
                assumptions.append(
                    f"Entity placeholder '{entity_id}' must be selected before apply."
                )
            elif entity_id not in entities:
                findings.append(
                    _finding(
                        "unknown_entity",
                        f"Entity '{entity_id}' is not present in live Home Assistant metadata",
                        path=entity_path,
                        authority=authority,
                    )
                )

    if snapshot.get("partial"):
        assumptions.append(
            "Live metadata is partial; unavailable registries may affect instance validation."
        )
    return {
        "valid": not any(item["severity"] == "error" for item in findings),
        "parsed": True,
        "authority": ["yaml_parser", "yaml_schema", authority],
        "findings": findings,
        "assumptions": sorted(set(assumptions)),
    }
