import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.ai.llm_chain import LLMResult, ProviderAttempt


@pytest.mark.asyncio
async def test_ai_coach_route_registered():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/api/v1/ai-coach/sessions")
        # Should return 401 Unauthorized without auth headers
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_ai_lead_handler_route_registered():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/api/v1/leads/fake-lead-id/ai")
        # Should return 401 Unauthorized without auth headers
        assert response.status_code == 401
