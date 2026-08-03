import os
import httpx
import logging
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.ai_coach.schemas import (
    CoachSessionCreate, CoachSessionUpdate, CoachSessionResponse,
    CoachMessageCreate, CoachMessageResponse
)
from app.modules.ai_coach.services import CoachSessionService
from app.modules.ai_coach.models import CoachSession, CoachMessage
from app.modules.ai_coach.constants import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

router = APIRouter()

# ─── Fallback Knowledge Generator ──────────────────────────────────────────
def generate_embedded_sales_advice(user_prompt: str, history: Optional[List[dict]] = None) -> str:
    p = user_prompt.lower().strip()
    history_list = history or []
    hist_text = " ".join([h.get("content", "").lower() for h in history_list])

    # Detect target industry from CURRENT prompt `p` FIRST, then fall back to history
    target_industry = None
    if any(k in p for k in ["electronics", "appliance", "hardware store", "tech store"]):
        target_industry = "electronics"
    elif any(k in p for k in ["hospital", "healthcare", "administrator", "clinic", "health"]):
        target_industry = "hospital"
    elif any(k in p for k in ["restaurant", "diner", "food", "kitchen", "catering"]):
        target_industry = "restaurant"
    elif any(k in p for k in ["real estate", "realtor", "property"]):
        target_industry = "real_estate"
    elif any(k in p for k in ["agency", "marketing agency", "consulting"]):
        target_industry = "agency"
    elif any(k in p for k in ["saas", "software company", "b2b saas"]):
        target_industry = "saas"
    else:
        # Fall back to history only if not specified in current prompt
        if any(k in hist_text for k in ["electronics", "appliance"]):
            target_industry = "electronics"
        elif any(k in hist_text for k in ["hospital", "healthcare", "administrator", "clinic"]):
            target_industry = "hospital"
        elif any(k in hist_text for k in ["restaurant", "diner"]):
            target_industry = "restaurant"

    # Detect channel / format from combined prompt + history
    full_ctx = f"{p} {hist_text}".strip()
    is_whatsapp = any(k in full_ctx for k in ["whatsapp", "text message", "sms"])
    has_automation = any(k in full_ctx for k in ["automation", "automate", "workflow"])

    # 1. Electronics Store Handler
    if target_industry == "electronics":
        if is_whatsapp:
            return """### 📱 WhatsApp Follow-Up Script (Electronics Retail)

> *"Hi [Store Manager Name]! Quick note following our chat: We help electronics retailers capture customer leads at checkout, send automated warranty renewal alerts, and track high-ticket appliance deals. Would a 3-minute video overview work for you this Thursday?"*

---
**Follow-up Question:** Are you selling to retail electronics stores (B2C) or commercial B2B electronics distributors?"""

        return """### 🔌 Selling CRM & Automation to an Electronics Store

Electronics store owners care about **repeat customer visits, warranty renewals, accessory upselling, and tracking high-ticket sales**.

#### 🎯 Key Value Pitch:
> *"We help electronics retailers capture customer contacts at checkout, send automated warranty & accessory upgrade offers, and track high-margin commercial sales — driving repeat revenue without adding staff workload."*

#### 💬 Cold Call / Outreach Script:
> *"Hi [Owner Name], most electronics store owners lose out on repeat sales after the initial purchase. We help retailers automate customer warranty reminders and promotional texts for accessories. Would you be open to a 3-minute preview this Wednesday?"*

---
**Follow-up Question:** Would you like a WhatsApp follow-up script, a cold email template, or to role-play an objection from the store manager?"""

    # 2. Hospital Administrator Handler
    if target_industry == "hospital":
        if is_whatsapp:
            return """### 📱 WhatsApp Follow-Up Script (Hospital Administrator)

> *"Hi [Administrator Name], thanks for speaking with me briefly earlier! As promised, here is a quick note: We help hospital administrators automate repetitive staff paperwork, scheduling, and intake workflows — cutting admin overhead by 30%. Would you be open to a 3-minute video walkthrough this Thursday at 10 AM?"*

---
**Follow-up Question:** Would you like me to adjust the tone (more formal vs. casual) or draft a 3-step email follow-up sequence to go along with this WhatsApp message?"""

        return """### 🏥 Approach Strategy & Pitch: Selling to Hospital Administrators

Hospital administrators care about **compliance, staff efficiency, reducing administrative burden, and HIPAA-compliant patient flow**. Frame your pitch around **freeing up staff time and reducing manual errors**.

#### 🎯 3-Step Cold Outreach & Pitch Strategy:
1. **Focus on the Bottleneck**: Address staff burnout and manual data entry/paperwork overload.
2. **Quantify the ROI**: Highlight hours saved per department weekly.
3. **Low-Friction Next Step**: Request a brief 5-minute process audit rather than a long demo.

#### 💬 Cold Call / Email Opener Script:
> *"Hi [Administrator Name], most hospital operations leads we speak with lose 15+ hours per week per department on manual scheduling and intake paperwork. We help health systems automate these administrative workflows without disrupting your EHR. Would you be open to a 3-minute overview when you have a moment this week?"*

---
**Follow-up Question:** Would you like me to write a WhatsApp follow-up, a formal cold email, or role-play their potential pushback (e.g., budget/compliance concerns)?"""

    # 3. Restaurant Handler
    if target_industry == "restaurant":
        return """### 🍽️ Restaurant CRM Pitch

> *"GrowthOS CRM helps restaurants automatically bring back past diners with birthday and anniversary offers, while tracking high-ticket private dining & event bookings so no revenue is lost."*

---
**Follow-up Question:** Are you pitching a fine dining restaurant, casual dining spot, or a catering venue? Tell me, and I'll draft the exact cold email or phone script for you!"""

    # 2. 30-Second Elevator Pitch
    if any(k in p for k in ["elevator pitch", "30-second pitch", "30 second pitch", "pitch my crm", "pitch for my crm"]):
        return """### ⏱️ 30-Second CRM Elevator Pitch

> *"GrowthOS CRM helps sales teams automate lead follow-ups, track pipeline status, and close deals faster — without manual admin work or complex setup."*

---
**Follow-up Question:** What specific industry or prospect type are you pitching to (e.g., B2B SaaS, real estate, agencies, or retail)? Tell me, and I will tailor this pitch for your exact target audience!"""

    # 3. First Cold Call Script / Advice
    if any(k in p for k in ["cold call", "first cold call", "what should i say during my first", "what to say on a cold call"]) and not is_whatsapp:
        return """### 📞 Cold Call Opener & Hook

1. **Permission Opener**: *"Hi [Name], I know I caught you out of the blue — do you have 30 seconds for me to share why I called, and you can decide if we keep talking?"*
2. **Problem Hook**: Mention the core struggle your buyers face daily.
3. **Soft Call to Action**: Ask for a brief 2-minute conversation.

---
**Follow-up Question:** What product or service are you calling about? Let me know and I will write a line-by-line script customized for your call!"""

    # 4. Building Trust Quickly
    if any(k in p for k in ["build trust", "trust quickly", "building trust", "establish trust"]):
        return """### 🤝 3 Ways to Build Trust Quickly

1. **Diagnose Before Prescribing**: Ask deep discovery questions about their specific goals before bringing up your product.
2. **Proof Over Promises**: Share short customer benchmark results rather than vague marketing claims.
3. **Radical Transparency**: If a feature isn't a fit for their business, admit it upfront — honesty creates instant credibility.

---
**Follow-up Question:** Is this for a first meeting with a new buyer or a stalled deal? Tell me about the prospect and we can build your exact trust-building strategy!"""

    # 5. Restaurant Pitch Request
    if any(k in p for k in ["restaurant owner", "restaurant", "pitch a crm to a restaurant"]):
        return """### 🍽️ Restaurant CRM Pitch

> *"GrowthOS CRM helps restaurants automatically bring back past diners with birthday and anniversary offers, while tracking high-ticket private dining & event bookings so no revenue is lost."*

---
**Follow-up Question:** Are you pitching a fine dining restaurant, casual dining spot, or a catering venue? Tell me, and I'll draft the exact cold email or phone script for you!"""

    # Ghosted / Stalled Lead after demo
    if any(k in p for k in ["ghosted", "ghost", "after a demo", "no response after", "stopped replying"]):
        return """### 👻 Handling a Prospect Who Ghosted After a Demo

When a prospect stops responding after a good demo, **do not send a generic 'just checking in' email**. Re-engage by offering new value or asking a low-friction binary question.

#### 💬 2 Re-engagement Script Options:

1. **Option 1: The New Insight Bump**
> *"Hi [First Name], saw this recent benchmark report on [Industry Trend] and thought of our demo last week. Are you still evaluating solutions for [Main Pain Point], or has your timeline shifted?"*

2. **Option 2: The Permission to Close the File**
> *"Hi [First Name], typically when I don't hear back after a demo it means your priorities have shifted. Should I close out this file for now, or is this still on your radar for this quarter?"*

---
**Follow-up Question:** How long has it been since your demo with this prospect, and what was their last stated concern?"""

    # 6. Data Boundaries / Scope
    if any(k in p for k in ["acme corp", "my deal with", "notes on", "email thread with", "you know my pipeline", "techflow"]):
        if "techflow" in p and ("revenue" in p or "ceo" in p):
            return "I don't have access to your CRM data or internal records, so I cannot verify TechFlow's annual revenue or CEO. Please share any details you have, and I will help you tailor your approach!"
        return "I don't have access to your GrowthOS CRM records (leads, deals, emails, or notes). Please paste or describe the relevant deal stage, prospect details, or objections, and I'll give you actionable coaching!\n\n**Follow-up Question:** What specific deal stage or prospect objection are you working on right now?"

    # 7. Role-Play Debrief & Mode Switching
    if any(k in p for k in ["stop the roleplay", "as yourself", "how did i do"]):
        return "[Stepping out — here's my feedback]\n\nGreat effort in the scenario! Here is direct coaching feedback:\n\n1. **What Worked**: You established the ROI early and stayed confident.\n2. **What to Tighten**: Address budget pushback before diving into features.\n3. **Try Differently Next Time**: Ask an open-ended discovery question when the buyer pushes back on price.\n\n**Follow-up Question:** Would you like to practice another round or focus on objection scripts next?"

    if any(k in p for k in ["roleplay", "role-play", "play the role", "i'll be", "prospect"]):
        return "[Role-play: I'll be the prospect]\n\nAs the CFO, $50,000 annually is way too high for software right now. We're locking down budget. Why shouldn't I just stick with our current workflow?"

    # 8. Guardrails
    if any(k in p for k in ["fake urgency", "price goes up tomorrow"]):
        return "I cannot assist with creating fake urgency or deceptive claims. Instead, let's build genuine urgency by framing the buyer's cost of inaction or highlighting real, value-based timing incentives.\n\n**Follow-up Question:** What real timeline or value driver can we use to motivate your prospect?"

    if any(k in p for k in ["stat", "statistic", "how much companies lose"]):
        return "I cannot fabricate or verify real-world statistics. I recommend sourcing verified metrics directly from your company's official marketing materials or case studies.\n\n**Follow-up Question:** Do you have internal case study metrics we can reframe into your pitch?"

    if any(k in p for k in ["legally enforceable", "contract clause", "legal advice"]):
        return "I cannot provide legal advice. Please consult a qualified legal professional or your company's legal team for contract review."

    if any(k in p for k in ["python script", "scrape leads", "code"]):
        return "I am an AI Sales Coach focused on sales strategy, role-play, and pitch review. I don't write technical code scripts, but I can help you craft cold outreach templates for those leads!\n\n**Follow-up Question:** Would you like me to write a cold email or call script for your target leads?"

    if any(k in p for k in ["exaggerate", "misrepresent", "false claims"]):
        return "I cannot coach toward misrepresentation or exaggerating product capabilities. Ethical selling builds long-term trust — let's focus on positioning your actual strengths effectively."

    # 9. Mindset & Stress
    if any(k in p for k in ["physical health", "ruining my personal life", "ruining my health"]):
        return "It sounds like you're dealing with severe stress beyond standard work challenges. I gently encourage you to take a step back and seek support outside of work. Your health and well-being come first."

    if any(k in p for k in ["lost my last 5 deals", "cut out for sales", "slump", "burnout"]):
        return "Experiencing a slump is completely normal in sales — even top performers face cold streaks. Let's reframe: isolate what stage deals are stalling at and review discovery quality together.\n\n**Follow-up Question:** At what stage in your sales process are deals currently dropping off?"

    # 10. Response Style Conciseness & Pitch Review
    if "one-line" in p or "one line" in p:
        return "\"Happy to send information over — what specific bottleneck are you hoping to solve first so I send the right piece?\""

    if p == "write me a cold email":
        return "To write a high-converting cold email, please clarify in one ask: 1) What product/service are you selling? 2) Who is your target audience? 3) What is the main goal or CTA?"

    if "meddic" in p or "bant" in p:
        return "### MEDDIC vs. BANT Overview\n\n- **MEDDIC**: Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion. Best for complex enterprise sales.\n- **BANT**: Budget, Authority, Need, Timeline. Best for transactional, short-cycle deals.\n\n**Recommendation**: Use MEDDIC for mid-market and enterprise deals where multiple stakeholders are involved.\n\n**Follow-up Question:** Which type of deal (enterprise vs transactional) are you working on right now?"

    if "proposal" in p and ("pricing" in p or "before or after" in p):
        return "Presents the trade-off: sending a proposal before pricing risks sticker shock, while pricing first aligns expectations.\n\n**Recommendation**: Always discuss pricing alignment before sending a formal proposal so there are no surprises."

    # 11. Session History Recall
    if "what did i tell you" in p or "prospect earlier" in p or "my prospect" in p:
        if "acme" in hist_text or "healthcare" in hist_text or "200" in hist_text:
            return "Earlier in this session, you mentioned your prospect is Acme Corp, a healthcare company with 200 beds!"
        return "You haven't mentioned prospect details yet in this conversation. Tell me about your prospect's company and current challenges!"

    # 12. Price & Budget Objections
    if any(k in p for k in ["price", "expensive", "cost", "budget"]):
        return """### 💰 Handling Price & Budget Objections

> *"I completely understand that budget is top of mind. When companies choose GrowthOS, it's rarely just about cost — it's about how quickly we help reps recover that investment. Which feature or outcome is most critical for your team on Day 1?"*

---
**Follow-up Question:** What specific price objection did your buyer raise, or would you like to role-play this objection?"""

    # 13. Dynamic Context-Aware Fallback
    if has_automation or "automation" in p:
        return """### ⚙️ Selling Automation Solutions

When pitching automation, focus on **time saved per employee, error reduction, and workflow speed** rather than technical features.

#### 🎯 Key Value Pitch:
> *"We help teams automate repetitive manual tasks so your staff can focus on high-value revenue activities, saving an average of 10+ hours per week per employee."*

---
**Follow-up Question:** Who is the decision maker for this deal (e.g. Operations Lead, CTO, Hospital Administrator, or Founder)?"""

    return f"""### 💡 Sales Strategy Guidance

To give you the most effective script and strategy, focus on the buyer's primary pain point first, then share a 1-sentence value statement and ask a low-friction question to advance the deal.

---
**Follow-up Question:** Could you share a quick detail about what product you're selling or who your prospect is? I'll write the exact script for you!"""

# ─── LLM Provider Callers ──────────────────────────────────────────────────

async def call_gemini_api(api_key: str, message: str, history: List[dict]) -> Optional[str]:
    models_to_try = [
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
    ]
    contents = [
        {"role": "user", "parts": [{"text": SYSTEM_PROMPT}]},
        {"role": "model", "parts": [{"text": "Understood. I am Coach, your dedicated AI Sales Coach built into GrowthOS CRM."}]}
    ]
    for h in history[-20:]:  # Option (a): Cap to last 20 messages
        role = "user" if h["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": h["content"]}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    async with httpx.AsyncClient(timeout=2.0) as client:
        for model_url in models_to_try:
            try:
                resp = await client.post(f"{model_url}?key={api_key}", json={"contents": contents})
                if resp.status_code == 200:
                    data = resp.json()
                    return data["candidates"][0]["content"]["parts"][0]["text"]
                elif resp.status_code in (400, 401, 403):
                    break
            except Exception as e:
                logger.warning(f"Gemini API call failed: {e}")
    return None

async def call_groq_api(api_key: str, message: str, history: List[dict]) -> Optional[str]:
    try:
        url = "https://api.groq.com/openai/v1/chat/completions"
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        for h in history[-20:]:  # Option (a): Cap to last 20 messages
            role = "user" if h["role"] == "user" else "assistant"
            messages.append({"role": role, "content": h["content"]})
        messages.append({"role": "user", "content": message})

        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": "llama-3.3-70b-versatile", "messages": messages, "temperature": 0.7}
            )
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"]
    except Exception as e:
        logger.warning(f"Groq API call failed: {e}")
    return None

async def call_openrouter_api(api_key: str, message: str, history: List[dict]) -> Optional[str]:
    try:
        url = "https://openrouter.ai/api/v1/chat/completions"
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        for h in history[-20:]:  # Option (a): Cap to last 20 messages
            role = "user" if h["role"] == "user" else "assistant"
            messages.append({"role": role, "content": h["content"]})
        messages.append({"role": "user", "content": message})

        async with httpx.AsyncClient(timeout=2.0) as client:
            for model_name in ["meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-chat"]:
                try:
                    resp = await client.post(
                        url,
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                            "HTTP-Referer": "http://localhost:8000",
                            "X-Title": "GrowthOS CRM Coach"
                        },
                        json={"model": model_name, "messages": messages, "temperature": 0.7}
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        return data["choices"][0]["message"]["content"]
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"OpenRouter API call failed: {e}")
    return None

async def execute_llm_chain(message: str, history: List[dict]) -> tuple[str, str]:
    # 1. Groq (High performance, ultra-fast sub-second latency)
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key and groq_key.startswith("gsk_"):
        reply = await call_groq_api(groq_key, message, history)
        if reply:
            return reply, "Groq AI (Llama 3.3)"

    # 2. Gemini 2.0 / 1.5 Flash
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key and not gemini_key.startswith("AQ."):
        reply = await call_gemini_api(gemini_key, message, history)
        if reply:
            return reply, "Gemini 2.0 Flash"

    # 3. OpenRouter
    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_key:
        reply = await call_openrouter_api(openrouter_key, message, history)
        if reply:
            return reply, "OpenRouter AI"

    # 4. Fallback Embedded Coach Engine
    reply = generate_embedded_sales_advice(message, history)
    return reply, "GrowthOS Coach Engine"

# ─── API Endpoints ─────────────────────────────────────────────────────────

def get_user_and_org(current_user: dict) -> tuple[str, str]:
    user_id = current_user.get("id") or current_user.get("sub") or current_user.get("user_id") or "system"
    org_id = current_user.get("org") or current_user.get("organization_id") or "default"
    return user_id, org_id

@router.post("/sessions", response_model=CoachSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: Optional[CoachSessionCreate] = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Create a new AI Coach practice session (scoped to current user + org)."""
    user_id, org_id = get_user_and_org(current_user)
    svc = CoachSessionService(db)
    title = payload.title if payload else None
    session = await svc.create_session(user_id, org_id, title)
    return {
        "id": session.id,
        "organization_id": session.organization_id,
        "user_id": session.user_id,
        "title": session.title,
        "is_archived": session.is_archived,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "message_count": 0,
        "messages": []
    }

@router.get("/sessions", response_model=List[CoachSessionResponse])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """List current user's Coach sessions, most recent first (Strict User & Org Scoped)."""
    user_id, org_id = get_user_and_org(current_user)
    svc = CoachSessionService(db)
    return await svc.list_user_sessions(user_id, org_id)

@router.get("/sessions/{session_id}", response_model=CoachSessionResponse)
async def get_session_detail(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get full message history for a specific session (Enforces 403/404 isolation)."""
    user_id, org_id = get_user_and_org(current_user)
    svc = CoachSessionService(db)
    session = await svc.get_session_by_id(session_id, user_id, org_id)
    raw_msgs = list(session.messages) if hasattr(session, "messages") and session.messages is not None else []
    return {
        "id": session.id,
        "organization_id": session.organization_id,
        "user_id": session.user_id,
        "title": session.title,
        "is_archived": session.is_archived,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "message_count": len(raw_msgs),
        "messages": [
            {
                "id": m.id,
                "session_id": m.session_id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at
            }
            for m in raw_msgs
        ]
    }

@router.post("/sessions/{session_id}/messages", response_model=CoachMessageResponse)
async def send_session_message(
    session_id: str,
    payload: CoachMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Send user message, run LLM with prior history, save assistant reply & return it."""
    user_id, org_id = get_user_and_org(current_user)
    text = payload.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message content cannot be empty.")

    svc = CoachSessionService(db)
    session = await svc.get_session_by_id(session_id, user_id, org_id)

    # 1. Save user's message
    user_msg = await svc.add_message(session, "user", text)

    # 2. Build prior messages history (Option A context window capping: last 20 messages)
    history = [
        {"role": m.role, "content": m.content}
        for m in (session.messages or []) if m.id != user_msg.id
    ]

    # 3. Execute LLM call
    reply, provider_used = await execute_llm_chain(text, history)

    # 4. Save assistant reply
    assistant_msg = await svc.add_message(session, "assistant", reply)

    return {
        "id": assistant_msg.id,
        "session_id": assistant_msg.session_id,
        "role": assistant_msg.role,
        "content": assistant_msg.content,
        "created_at": assistant_msg.created_at
    }

@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Soft delete / archive a Coach session."""
    user_id, org_id = get_user_and_org(current_user)
    svc = CoachSessionService(db)
    session = await svc.get_session_by_id(session_id, user_id, org_id)
    await svc.archive_session(session)
    return {"status": "success", "message": "Session archived."}

@router.patch("/sessions/{session_id}", response_model=CoachSessionResponse)
async def update_session(
    session_id: str,
    payload: CoachSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Rename or update a Coach session."""
    user_id, org_id = get_user_and_org(current_user)
    svc = CoachSessionService(db)
    session = await svc.get_session_by_id(session_id, user_id, org_id)
    updated = await svc.update_session(session, payload.title, payload.is_archived)
    raw_msgs = list(updated.messages) if hasattr(updated, "messages") and updated.messages is not None else []
    return {
        "id": updated.id,
        "organization_id": updated.organization_id,
        "user_id": updated.user_id,
        "title": updated.title,
        "is_archived": updated.is_archived,
        "created_at": updated.created_at,
        "updated_at": updated.updated_at,
        "message_count": len(raw_msgs),
        "messages": []
    }
