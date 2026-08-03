import httpx
import asyncio

async def setup():
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=30.0) as client:
        r = await client.post("/api/v1/auth/register", json={
            "email": "demo@growthos.com",
            "password": "Pass123!",
            "first_name": "GrowthOS",
            "last_name": "Demo",
            "organization_name": "GrowthOS Corp"
        })
        print(f"Registration status: {r.status_code}")

if __name__ == "__main__":
    asyncio.run(setup())
