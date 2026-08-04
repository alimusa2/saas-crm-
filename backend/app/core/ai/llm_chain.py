"""
Shared multi-provider LLM fallback chain.

Place this at: app/core/ai/llm_chain.py  (adjust the import in router.py files to match)

Fixes vs the original ai_coach/router.py implementation:
  1. Timeouts were 2.0-2.5s total, which is shorter than typical real-world LLM
     latency (esp. with conversation history attached). Most "successful" real
     calls were timing out and silently falling through to the hardcoded
     `generate_embedded_sales_advice` engine, making the bot look scripted/fake
     even when API keys and quota were fine. Fixed: separate connect/read
     timeouts with a realistic read timeout (12s), configurable via env.
  2. Key validity was checked with brittle prefix-sniffing
     (`gemini_key.startswith("AQ.")`, `groq_key.startswith("gsk_")`). If a key
     format changes or a key is rotated, this silently breaks with no signal.
     Fixed: presence check only for gating; prefix mismatches are now logged
     as a warning (visibility) instead of causing a silent skip.
  3. Only the Gemini caller distinguished fatal (401/403, bad key/perms) from
     retryable errors. Groq/OpenRouter treated every non-200 the same way,
     with no differentiation and only `warning`-level logs. Fixed: every
     provider now classifies status codes and logs at the right level
     (`error` for auth failures — these need a human to look at env vars/keys,
     `warning` for rate limits/transient issues).
  4. Gemini's system prompt was faked as a user/model turn pair, which wastes
     context tokens and gets weaker instruction-following than the API's
     actual `systemInstruction` field. Fixed: uses `systemInstruction` properly.
  5. No visibility into *why* the chain fell through to the hardcoded fallback.
     Fixed: `execute_llm_chain` now always returns which providers were tried
     and why they failed (`attempts`), so you can log/alert on it and stop
     flying blind in production.

This module is intentionally provider-call logic ONLY. It takes a system
prompt + message + history and returns a reply. It does not know about
sessions, leads, or any DB models — callers (ai_coach, ai_lead_handler)
build the system prompt and history and pass them in.
"""

import os
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Callable, Awaitable

import httpx

logger = logging.getLogger(__name__)

# Read timeout is the one that matters for LLM calls; keep connect timeout tight.
_READ_TIMEOUT = float(os.getenv("LLM_READ_TIMEOUT_SECONDS", "12.0"))
_CONNECT_TIMEOUT = float(os.getenv("LLM_CONNECT_TIMEOUT_SECONDS", "3.0"))
_TIMEOUT = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=_READ_TIMEOUT, pool=_CONNECT_TIMEOUT)

_HISTORY_CAP = 20  # keep last N turns in the context window


@dataclass
class ProviderAttempt:
    provider: str
    ok: bool
    detail: str = ""


@dataclass
class LLMResult:
    reply: str
    provider_used: str
    attempts: List[ProviderAttempt] = field(default_factory=list)


def _classify_status(status_code: int) -> str:
    """Return 'fatal' (bad key/perms - stop retrying this provider),
    'rate_limited' (back off, but chain can still try next provider),
    or 'transient' (5xx / unknown - try next model/provider)."""
    if status_code in (401, 403):
        return "fatal"
    if status_code == 429:
        return "rate_limited"
    return "transient"


async def call_groq_api(api_key: str, system_prompt: str, message: str, history: List[dict]) -> tuple[Optional[str], ProviderAttempt]:
    url = "https://api.groq.com/openai/v1/chat/completions"
    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-_HISTORY_CAP:]:
        role = "user" if h["role"] == "user" else "assistant"
        messages.append({"role": role, "content": h["content"]})
    messages.append({"role": "user", "content": message})

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": "llama-3.3-70b-versatile", "messages": messages, "temperature": 0.7},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"], ProviderAttempt("groq", True)

            severity = _classify_status(resp.status_code)
            log_fn = logger.error if severity == "fatal" else logger.warning
            log_fn(f"Groq API returned {resp.status_code} ({severity}): {resp.text[:300]}")
            return None, ProviderAttempt("groq", False, f"http_{resp.status_code}_{severity}")
    except httpx.TimeoutException as e:
        logger.warning(f"Groq API timed out after {_READ_TIMEOUT}s: {e}")
        return None, ProviderAttempt("groq", False, "timeout")
    except Exception as e:
        logger.error(f"Groq API call raised an unexpected exception: {e}")
        return None, ProviderAttempt("groq", False, f"exception:{type(e).__name__}")


async def call_gemini_api(api_key: str, system_prompt: str, message: str, history: List[dict]) -> tuple[Optional[str], ProviderAttempt]:
    models_to_try = [
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    ]
    contents = []
    for h in history[-_HISTORY_CAP:]:
        role = "user" if h["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": h["content"]}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    body = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
    }

    last_attempt = ProviderAttempt("gemini", False, "no_models_tried")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for model_url in models_to_try:
            try:
                resp = await client.post(f"{model_url}?key={api_key}", json=body)
                if resp.status_code == 200:
                    data = resp.json()
                    return data["candidates"][0]["content"]["parts"][0]["text"], ProviderAttempt("gemini", True)

                severity = _classify_status(resp.status_code)
                log_fn = logger.error if severity == "fatal" else logger.warning
                log_fn(f"Gemini ({model_url.split('/')[-1]}) returned {resp.status_code} ({severity}): {resp.text[:300]}")
                last_attempt = ProviderAttempt("gemini", False, f"http_{resp.status_code}_{severity}")
                if severity == "fatal":
                    break  # bad key/perms won't fix itself on the next model
            except httpx.TimeoutException as e:
                logger.warning(f"Gemini call timed out after {_READ_TIMEOUT}s: {e}")
                last_attempt = ProviderAttempt("gemini", False, "timeout")
            except Exception as e:
                logger.error(f"Gemini call raised an unexpected exception: {e}")
                last_attempt = ProviderAttempt("gemini", False, f"exception:{type(e).__name__}")
    return None, last_attempt


async def call_openrouter_api(api_key: str, system_prompt: str, message: str, history: List[dict]) -> tuple[Optional[str], ProviderAttempt]:
    url = "https://openrouter.ai/api/v1/chat/completions"
    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-_HISTORY_CAP:]:
        role = "user" if h["role"] == "user" else "assistant"
        messages.append({"role": role, "content": h["content"]})
    messages.append({"role": "user", "content": message})

    last_attempt = ProviderAttempt("openrouter", False, "no_models_tried")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for model_name in ["meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-chat"]:
            try:
                resp = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": os.getenv("APP_PUBLIC_URL", "http://localhost:8000"),
                        "X-Title": "GrowthOS CRM AI",
                    },
                    json={"model": model_name, "messages": messages, "temperature": 0.7},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data["choices"][0]["message"]["content"], ProviderAttempt("openrouter", True)

                severity = _classify_status(resp.status_code)
                log_fn = logger.error if severity == "fatal" else logger.warning
                log_fn(f"OpenRouter ({model_name}) returned {resp.status_code} ({severity}): {resp.text[:300]}")
                last_attempt = ProviderAttempt("openrouter", False, f"http_{resp.status_code}_{severity}")
                if severity == "fatal":
                    break
            except httpx.TimeoutException as e:
                logger.warning(f"OpenRouter call timed out after {_READ_TIMEOUT}s: {e}")
                last_attempt = ProviderAttempt("openrouter", False, "timeout")
            except Exception as e:
                logger.error(f"OpenRouter call raised an unexpected exception: {e}")
                last_attempt = ProviderAttempt("openrouter", False, f"exception:{type(e).__name__}")
    return None, last_attempt


async def execute_llm_chain(
    system_prompt: str,
    message: str,
    history: List[dict],
    fallback_fn: Callable[[str, Optional[List[dict]]], str],
) -> LLMResult:
    """
    Try Groq -> Gemini -> OpenRouter in order, falling back to `fallback_fn`
    (a synchronous, deterministic responder) only if all three fail or are
    unconfigured. `fallback_fn` should have the same signature as the
    existing `generate_embedded_sales_advice(user_prompt, history)`.
    """
    attempts: List[ProviderAttempt] = []

    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        if not groq_key.startswith("gsk_"):
            logger.warning("GROQ_API_KEY is set but doesn't match the expected 'gsk_' prefix — trying it anyway.")
        reply, attempt = await call_groq_api(groq_key, system_prompt, message, history)
        attempts.append(attempt)
        if reply:
            return LLMResult(reply, "Groq AI (Llama 3.3)", attempts)
    else:
        attempts.append(ProviderAttempt("groq", False, "not_configured"))

    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        reply, attempt = await call_gemini_api(gemini_key, system_prompt, message, history)
        attempts.append(attempt)
        if reply:
            return LLMResult(reply, "Gemini 2.0 Flash", attempts)
    else:
        attempts.append(ProviderAttempt("gemini", False, "not_configured"))

    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_key:
        reply, attempt = await call_openrouter_api(openrouter_key, system_prompt, message, history)
        attempts.append(attempt)
        if reply:
            return LLMResult(reply, "OpenRouter AI", attempts)
    else:
        attempts.append(ProviderAttempt("openrouter", False, "not_configured"))

    # All three real providers failed or are unconfigured. Log it loudly —
    # this is the difference between "we know the fallback is firing a lot"
    # and finding out from a confused user.
    logger.error(f"All LLM providers failed or unconfigured; using deterministic fallback engine. Attempts: {attempts}")
    reply = fallback_fn(message, history)
    return LLMResult(reply, "Fallback Engine", attempts)

