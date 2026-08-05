"""Provider-neutral, privacy-bounded context for AI requests."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any


MAX_PROVIDER_EXCERPT_CHARS = 6000
MAX_PROVIDER_QUERY_CHARS = 2000
REDACTION_PREFIX = "[BLUEPRINT_STUDIO_REDACTED_"

_SECRET_KEY_RE = re.compile(
    r"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|"
    r"password|passwd|authorization|bearer|credential|private[_-]?key)"
)
_KEY_VALUE_RE = re.compile(
    r"^(?P<prefix>\s*(?:[-?]\s*)?(?P<key>[^:#\n]+?)\s*:\s*)(?P<value>.*)$"
)
_INLINE_SECRET_RE = re.compile(
    r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}|"
    r"\b(sk-[A-Za-z0-9_-]{12,})\b|"
    r"\b(gh[opusr]_[A-Za-z0-9_]{12,})\b"
)
_SECRET_REFERENCE_RE = re.compile(r"(?i)!secret\s+[^\s#]+")


@dataclass(frozen=True, slots=True)
class ProviderRequestContext:
    """Sanitized request data shared by every non-rule-based provider."""

    query: str
    current_file: str | None
    file_excerpt: str | None
    generation: dict[str, Any]
    redaction_count: int
    excerpt_truncated: bool
    task_mode: str


class LocalRedactor:
    """Replace likely secrets with stable placeholders held only in memory."""

    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    @property
    def count(self) -> int:
        return len(self._values)

    def _placeholder(self, value: str) -> str:
        if value not in self._values:
            self._values[value] = f"{REDACTION_PREFIX}{len(self._values) + 1}]"
        return self._values[value]

    def redact(self, text: str | None) -> str | None:
        if text is None:
            return None
        lines: list[str] = []
        for line in text.splitlines(keepends=True):
            newline = "\n" if line.endswith("\n") else ""
            body = line[:-1] if newline else line
            match = _KEY_VALUE_RE.match(body)
            if match and _SECRET_KEY_RE.search(match.group("key")):
                value = match.group("value")
                body = match.group("prefix") + (
                    self._placeholder(value) if value else ""
                )
            body = _SECRET_REFERENCE_RE.sub(
                lambda found: self._placeholder(found.group(0)), body
            )
            body = _INLINE_SECRET_RE.sub(
                lambda found: (
                    found.group(1)
                    + self._placeholder(found.group(0)[len(found.group(1)) :])
                    if found.group(1)
                    else self._placeholder(found.group(0))
                ),
                body,
            )
            lines.append(body + newline)
        return "".join(lines)


def _bounded_excerpt(
    content: str | None, selected_excerpt: str | None
) -> tuple[str | None, bool]:
    source = (
        selected_excerpt if selected_excerpt and selected_excerpt.strip() else content
    )
    if source is None:
        return None, False
    truncated = len(source) > MAX_PROVIDER_EXCERPT_CHARS
    return source[:MAX_PROVIDER_EXCERPT_CHARS], truncated


def build_provider_context(
    query: str,
    current_file: str | None,
    file_content: str | None,
    selected_excerpt: str | None,
    generation: dict[str, Any],
    task_mode: str = "ask",
) -> ProviderRequestContext:
    """Build one minimized, redacted context without retaining its secret map."""
    redactor = LocalRedactor()
    path_parts = (current_file or "").replace("\\", "/").split("/")
    hidden_file = any(
        part.startswith(".") for part in path_parts if part not in {"", ".", ".."}
    )
    excerpt, truncated = (
        (None, False)
        if hidden_file
        else _bounded_excerpt(file_content, selected_excerpt)
    )
    safe_query = redactor.redact(query[:MAX_PROVIDER_QUERY_CHARS]) or ""
    safe_excerpt = redactor.redact(excerpt)
    return ProviderRequestContext(
        query=safe_query,
        current_file=None if hidden_file else current_file,
        file_excerpt=safe_excerpt,
        generation=generation,
        redaction_count=redactor.count,
        excerpt_truncated=truncated,
        task_mode=task_mode,
    )


def contains_redaction_placeholder(text: str) -> bool:
    """Return whether provider output copied a local redaction marker."""
    return REDACTION_PREFIX in text
