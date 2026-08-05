"""Provider transport limits, normalized errors, and content-free metrics."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
from typing import Any


MAX_PROVIDER_RESPONSE_BYTES = 1_048_576
PROVIDER_TIMEOUT_SECONDS = 60
PROVIDER_CONNECT_TIMEOUT_SECONDS = 15
PROVIDER_READ_TIMEOUT_SECONDS = 45


@dataclass(frozen=True, slots=True)
class ProviderTransportError(Exception):
    """A stable external-provider failure safe to return to the client."""

    code: str
    message: str
    status: int = 502
    upstream_status: int | None = None


def decode_provider_json(raw: bytes, upstream_status: int, provider_label: str) -> Any:
    """Decode a bounded provider response and normalize malformed/upstream errors."""
    if len(raw) > MAX_PROVIDER_RESPONSE_BYTES:
        raise ProviderTransportError(
            "provider_response_too_large",
            f"{provider_label} returned more than the allowed response size",
        )
    text = raw.decode("utf-8", errors="replace")
    try:
        payload: Any = json.loads(text) if text else {}
    except json.JSONDecodeError as err:
        if 200 <= upstream_status < 300:
            raise ProviderTransportError(
                "provider_malformed_response",
                f"{provider_label} returned malformed JSON",
            ) from err
        payload = {}

    if not 200 <= upstream_status < 300:
        detail = ""
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                detail = str(error.get("message") or "")
            elif error:
                detail = str(error)
            elif payload.get("message"):
                detail = str(payload["message"])
        message = f"{provider_label} rejected the request"
        if detail:
            message = f"{message}: {detail[:300]}"
        raise ProviderTransportError(
            "provider_upstream_error", message, upstream_status=upstream_status
        )
    return payload


class ProviderMetrics:
    """Aggregate operational AI metrics without retaining request content."""

    def __init__(self) -> None:
        self._outcomes: Counter[str] = Counter()
        self._provider_classes: Counter[str] = Counter()
        self._duration_ms = 0
        self._request_chars = 0
        self._response_chars = 0

    def record(
        self,
        provider_class: str,
        outcome: str,
        duration_ms: int,
        request_chars: int,
        response_chars: int,
    ) -> None:
        self._outcomes[outcome] += 1
        self._provider_classes[provider_class] += 1
        self._duration_ms += max(0, duration_ms)
        self._request_chars += max(0, request_chars)
        self._response_chars += max(0, response_chars)

    def snapshot(self) -> dict[str, Any]:
        return {
            "requests": sum(self._outcomes.values()),
            "provider_classes": dict(self._provider_classes),
            "outcomes": dict(self._outcomes),
            "duration_ms_total": self._duration_ms,
            "request_chars_total": self._request_chars,
            "response_chars_total": self._response_chars,
        }
