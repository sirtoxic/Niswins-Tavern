# ai_client.py
# Shared Claude API client: model management, pricing lookup, and request helper.
#
# All generators call call_claude() instead of building their own client/usage logic.
# Model and pricing state live here so set_model() takes effect across every generator.

import os
import httpx
import anthropic
from typing import Optional

_LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
_pricing_cache: dict = {}
_FALLBACK_INPUT_PER_TOKEN = 0.000003   # $3/MTok
_FALLBACK_OUTPUT_PER_TOKEN = 0.000015  # $15/MTok

_model_ref = ["claude-sonnet-4-6"]
_low_token_mode_ref = [False]
HAIKU_MODEL = "claude-haiku-4-5-20251001"


def get_model() -> str:
    return _model_ref[0]


def set_model(model: str) -> None:
    _model_ref[0] = model


def get_low_token_mode() -> bool:
    return _low_token_mode_ref[0]


def set_low_token_mode(enabled: bool) -> None:
    _low_token_mode_ref[0] = bool(enabled)


async def _get_model_pricing(model: str) -> tuple:
    global _pricing_cache
    if not _pricing_cache:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(_LITELLM_URL)
                if r.status_code == 200:
                    _pricing_cache = r.json()
        except Exception:
            pass

    entry = (
        _pricing_cache.get(model)
        or _pricing_cache.get(f"anthropic/{model}")
    )
    if entry:
        return (
            entry.get("input_cost_per_token", _FALLBACK_INPUT_PER_TOKEN),
            entry.get("output_cost_per_token", _FALLBACK_OUTPUT_PER_TOKEN),
        )
    return _FALLBACK_INPUT_PER_TOKEN, _FALLBACK_OUTPUT_PER_TOKEN


async def call_claude(
    user_prompt: str,
    max_tokens: int,
    system: Optional[str] = None,
    model: Optional[str] = None,
) -> tuple:
    """Call Claude, strip code fences, and return (raw_text, usage_dict)."""
    model = model or get_model()
    client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    kwargs = dict(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": user_prompt}],
    )
    if system is not None:
        kwargs["system"] = system

    message = await client.messages.create(**kwargs)

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]

    input_tokens = message.usage.input_tokens
    output_tokens = message.usage.output_tokens
    input_cost, output_cost = await _get_model_pricing(model)
    cost_usd = input_tokens * input_cost + output_tokens * output_cost

    usage = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cost_usd": round(cost_usd, 6),
        "model": model,
    }

    return raw, usage
