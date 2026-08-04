import logging
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_user
from app.core.ai.llm_chain import execute_llm_chain  # same shared chain as ai_coach
from app.modules.ai_lead_handler.schemas import (
    LeadAIMessageCreate, LeadAIMessageResponse, LeadAIThreadResponse
)
from app.modules.ai_lead_handler.services import LeadAIService
from app.modules.ai_lead_handler.constants import LEAD_HANDLER_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

router = APIRouter()


def get_user_and_org(current_user: dict) -> tuple[str, str]:
    return current_user["id"], current_user["organization_id"]


def generate_lead_fallback(user_prompt: str, history=None) -> str:
    """Deterministic fallback if all three providers fail/are unconfigured.
    Deliberately honest rather than pretending to be a full recommendation —
    a canned "recommendation" that ignores the lead's real stage/industry
    would be actively misleading here, unlike generic sales-coaching tips."""
    return (
        "I can't reach any AI provider right now, so I don't want to guess at "
        "recommendations for this lead — that could point you wrong. "
        "Please try again in a moment. If this keeps happening, flag it to "
        "your admin — it usually means an API key or provider is misconfigured."
    )


@router.get("/leads/{lead_id}/ai", response_model=LeadAIThreadResponse)
async def get_lead_ai_thread(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id, org_id = get_user_and_org(current_user)
    service = LeadAIService(db)
    thread = await service.get_thread_or_404(lead_id, org_id)
    return LeadAIThreadResponse(
        id=thread.id,
        lead_id=thread.lead_id,
        organization_id=thread.organization_id,
        user_id=thread.user_id,
        message_count=len(thread.messages),
        messages=[LeadAIMessageResponse.model_validate(m) for m in thread.messages],
    )


@router.delete("/leads/{lead_id}/ai")
async def delete_lead_ai_thread(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id, org_id = get_user_and_org(current_user)
    service = LeadAIService(db)
    await service.delete_thread(lead_id, org_id)
    return {"status": "success", "message": "Lead AI thread deleted."}



@router.post("/leads/{lead_id}/ai/messages", response_model=LeadAIMessageResponse)
async def send_lead_ai_message(
    lead_id: str,
    payload: LeadAIMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id, org_id = get_user_and_org(current_user)

    service = LeadAIService(db)

    text = payload.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message content cannot be empty.")

    # 1. Thread (create on first message for this lead)
    thread = await service.get_or_create_thread(lead_id, user_id, org_id)

    # 2. Persist the user's message immediately, before calling any provider,
    #    so it's saved even if every provider fails below.
    await service.add_message(thread, "user", text)

    # 3. Build this lead's live context and fold it into the system prompt.
    #    This is the "no RAG" approach: we already know the one record that
    #    matters, so we just inject it — no retrieval step needed.
    try:
        lead_ctx = await service.build_lead_context(lead_id, org_id)
        context_block = LeadAIService.render_context_block(lead_ctx)
    except NotImplementedError:
        # Wiring hasn't been connected to the real Lead model yet.
        raise HTTPException(
            status_code=500,
            detail="Lead context is not wired up yet (see LeadAIService.build_lead_context).",
        )

    system_prompt = f"{LEAD_HANDLER_SYSTEM_PROMPT}\n\n{context_block}"

    history = [{"role": m.role, "content": m.content} for m in thread.messages[:-1]]  # exclude the message we just added

    # 4. Run the same shared, fixed provider chain used by the AI Coach.
    result = await execute_llm_chain(
        system_prompt=system_prompt,
        message=text,
        history=history,
        fallback_fn=generate_lead_fallback,
    )
    if result.provider_used == "Fallback Engine":
        logger.warning(f"Lead AI message for lead {lead_id} served by fallback. Attempts: {result.attempts}")

    # 5. Persist assistant reply
    assistant_message = await service.add_message(thread, "assistant", result.reply)

    return LeadAIMessageResponse.model_validate(assistant_message)
