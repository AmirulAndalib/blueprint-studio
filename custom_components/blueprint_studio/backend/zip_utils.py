"""ZIP archive helpers for Blueprint Studio."""
from __future__ import annotations

import re

_WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:")


def safe_zip_member_path(member_name: str) -> str | None:
    """Return a normalized relative ZIP member path, or None if unsafe."""
    if not member_name or "\x00" in member_name:
        return None

    normalized = member_name.replace("\\", "/")
    if normalized.startswith("/") or _WINDOWS_DRIVE_RE.match(normalized):
        return None

    parts: list[str] = []
    for part in normalized.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            return None
        parts.append(part)

    if not parts:
        return None
    return "/".join(parts)


def is_macos_zip_metadata(member_name: str) -> bool:
    """Return True for common macOS ZIP metadata entries."""
    normalized = member_name.replace("\\", "/")
    return normalized.startswith("__MACOSX/") or normalized.endswith("/.DS_Store") or normalized == ".DS_Store"
