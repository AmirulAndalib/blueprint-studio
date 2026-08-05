"""Route Blueprint Studio AI queries through Home Assistant conversation agents.

This module is completely standalone — zero imports from any specific agent
integration. It discovers conversation agents via the HA entity registry
and calls them through the standard ``async_converse`` API.

When the agent's response contains ``edit:<path>`` fenced blocks, they are
returned as an immutable proposal. Files are changed only by a later explicit,
authenticated apply request.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Callable

from aiohttp import web
from homeassistant.core import Context, HomeAssistant

from .util import json_response
from .ai_proposals import AIProposalStore, ProposalError

_LOGGER = logging.getLogger(__name__)

_EDIT_BLOCK_RE = re.compile(
    r"^```edit:([^\n]+)\n(.*?)^```[ \t]*$",
    re.DOTALL | re.MULTILINE,
)


def list_conversation_agents(hass: HomeAssistant) -> list[dict[str, str]]:
    """Return ``[{id, name, platform}]`` for every conversation agent entity."""
    agents: list[dict[str, str]] = []
    try:
        from homeassistant.helpers import entity_registry as er
        entity_reg = er.async_get(hass)
        for entry in entity_reg.entities.values():
            if entry.domain == "conversation":
                agents.append({
                    "id": entry.entity_id,
                    "name": entry.name or entry.original_name or entry.entity_id,
                    "platform": entry.platform,
                })
    except Exception:
        pass
    return agents


def _resolve_agent_id(hass: HomeAssistant, agent_entity_id: str | None) -> str | None:
    """Pick a conversation agent: explicit id > first claw > first any."""
    if agent_entity_id:
        return agent_entity_id
    agents = list_conversation_agents(hass)
    for a in agents:
        if a["platform"] == "claw_assistant":
            return a["id"]
    return agents[0]["id"] if agents else None


async def try_claw_query(
    hass: HomeAssistant,
    query: str,
    current_file: str | None,
    file_content: str | None,
    agent_entity_id: str | None = None,
    proposal_store: AIProposalStore | None = None,
    system_guidance: str | None = None,
    response_finalizer: Callable[[str], web.Response] | None = None,
) -> web.Response | None:
    """Route the query through a HA conversation agent.

    Returns an aiohttp Response on success, or None if no agent is available.
    """
    agent_id = _resolve_agent_id(hass, agent_entity_id)
    if not agent_id:
        return None

    context_parts: list[str] = []
    if system_guidance:
        context_parts.append(f"[Blueprint Studio system guidance:\n{system_guidance}]")
    if current_file:
        context_parts.append(f"[Current open file: {current_file}]")
    if file_content is not None:
        context_parts.append(f"[Selected file excerpt ({len(file_content)} chars)]:\n```\n{file_content}\n```")

    context_parts.append(
        "[You are operating inside Blueprint Studio, the HA config file editor. "
        "When you want to edit a file, output a fenced code block with the tag "
        "`edit:<relative_path>` containing the FULL new file content. Example:\n"
        "```edit:configuration.yaml\n<full file content>\n```\n"
        "Multiple edit blocks are allowed. The editor will show a diff to the user.]"
    )

    full_query = "\n".join(context_parts) + "\n\n" + query

    try:
        from homeassistant.components.conversation import async_converse

        result = await async_converse(
            hass=hass,
            text=full_query,
            conversation_id=None,
            context=Context(),
            agent_id=agent_id,
        )

        response_text = result.response.speech.get("plain", {}).get("speech", "")
        if not response_text:
            return None
        if response_finalizer is not None:
            return response_finalizer(response_text)

        try:
            parsed_edits, raw_blocks = _extract_edit_blocks(response_text)
        except ProposalError as err:
            parsed_edits = []
            raw_blocks = [match.group(0) for match in _EDIT_BLOCK_RE.finditer(response_text)]
            proposal_error = str(err)
        else:
            proposal_error = None
        proposal = None
        if parsed_edits:
            if proposal_store is None:
                proposal_error = "AI edit review is unavailable"
            else:
                try:
                    proposal = await hass.async_add_executor_job(
                        proposal_store.create, parsed_edits
                    )
                except ProposalError as err:
                    proposal_error = str(err)

        clean_text = response_text
        for raw_block in raw_blocks:
            clean_text = clean_text.replace(raw_block, "")
        clean_text = clean_text.strip()

        if proposal:
            edit_summary = "\n".join(f"- `{edit.path}`" for edit in proposal.edits)
            if clean_text:
                clean_text = f"{clean_text}\n\n---\n**Proposed file changes (review required):**\n{edit_summary}"
            else:
                clean_text = f"**Proposed file changes (review required):**\n{edit_summary}"

        payload: dict[str, Any] = {"success": True, "response": clean_text}
        if proposal:
            payload["proposal"] = proposal.as_dict()
        if proposal_error:
            payload["proposal_error"] = proposal_error
        return json_response(payload)

    except ImportError:
        _LOGGER.debug("conversation component not available")
        return None
    except Exception as err:
        _LOGGER.warning("claw_hook: conversation call failed: %s", err)
        return None


def _extract_edit_blocks(text: str) -> tuple[list[tuple[str, str]], list[str]]:
    """Parse complete edit fences without touching the filesystem."""
    matches = list(_EDIT_BLOCK_RE.finditer(text))
    if text.count("```edit:") != len(matches):
        raise ProposalError("Malformed AI edit block")
    return (
        [(match.group(1).strip(), match.group(2)) for match in matches],
        [match.group(0) for match in matches],
    )
