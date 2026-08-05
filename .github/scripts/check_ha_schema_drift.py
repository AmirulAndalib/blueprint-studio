"""Fail when maintained editor catalogs drift behind official Home Assistant sources."""
from __future__ import annotations

import ast
from pathlib import Path
import re
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
METADATA = ROOT / "custom_components/blueprint_studio/backend/ha_metadata.py"
SOURCES = {
    "selectors": "https://raw.githubusercontent.com/home-assistant/core/dev/homeassistant/helpers/selector.py",
    "automation": "https://raw.githubusercontent.com/home-assistant/home-assistant.io/current/source/_docs/automation/yaml.markdown",
    "blueprint": "https://raw.githubusercontent.com/home-assistant/home-assistant.io/current/source/_docs/blueprint/schema.markdown",
}


def fetch(url: str) -> str:
    request = Request(url, headers={"User-Agent": "blueprint-studio-schema-drift"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def maintained_selectors() -> set[str]:
    tree = ast.parse(METADATA.read_text(encoding="utf-8"))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(target, ast.Name) and target.id == "SELECTOR_TYPES" for target in node.targets):
            continue
        if isinstance(node.value, ast.Call) and node.value.args:
            return set(ast.literal_eval(node.value.args[0]))
    raise RuntimeError("SELECTOR_TYPES was not found")


def selector_name(stem: str) -> str:
    if stem == "DateTime":
        return "datetime"
    return re.sub(r"(?<!^)(?=[A-Z])", "_", stem).lower().replace("r_g_b", "rgb")


def official_selectors(source: str) -> set[str]:
    helpers = {"Base", "EntityFilter", "DeviceFilter", "EntityWithDeviceFilter"}
    stems = set(re.findall(r"^class ([A-Za-z0-9]+)Selector(?:\(|:)", source, re.MULTILINE))
    return {selector_name(stem) for stem in stems - helpers}


def main() -> None:
    official = official_selectors(fetch(SOURCES["selectors"]))
    missing = sorted(official - maintained_selectors())
    if missing:
        raise SystemExit(f"Home Assistant added selector types missing from fallback catalogs: {missing}")

    automation = fetch(SOURCES["automation"])
    for required in ("triggers:", "conditions:", "actions:", "- trigger:"):
        if required not in automation:
            raise SystemExit(f"Official automation documentation no longer contains {required!r}")

    blueprint = fetch(SOURCES["blueprint"])
    for domain in ("automation", "script", "template"):
        if not re.search(rf"\b{domain}\b", blueprint):
            raise SystemExit(f"Official blueprint documentation no longer lists {domain!r}")

    print(f"Home Assistant drift check passed ({len(official)} selector types)")


if __name__ == "__main__":
    main()
