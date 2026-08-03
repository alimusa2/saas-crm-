import time
import os
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.session import get_db
from app.core.redis_cache import get_redis_client
from app.core.websocket_manager import manager as ws_manager

router = APIRouter()
START_TIME = time.time()

@router.get("/health", status_code=status.HTTP_200_OK)
async def health_check(db: AsyncSession = Depends(get_db)):
    """
    Lightweight production health and diagnostics endpoint.
    Checks database ping, Redis status, active WebSockets, and system memory.
    """
    health_data = {
        "status": "healthy",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "uptime_seconds": round(time.time() - START_TIME, 2),
        "components": {}
    }

    # 1. Check Database Health
    t0 = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        db_latency = round((time.perf_counter() - t0) * 1000, 2)
        health_data["components"]["database"] = {
            "status": "connected",
            "latency_ms": db_latency
        }
    except Exception as e:
        health_data["status"] = "degraded"
        health_data["components"]["database"] = {
            "status": "error",
            "error": str(e)
        }

    # 2. Check Redis Health
    try:
        r_client = await get_redis_client()
        if r_client:
            r_t0 = time.perf_counter()
            await r_client.ping()
            redis_latency = round((time.perf_counter() - r_t0) * 1000, 2)
            health_data["components"]["redis"] = {
                "status": "connected",
                "latency_ms": redis_latency
            }
        else:
            health_data["components"]["redis"] = {
                "status": "in_memory_fallback"
            }
    except Exception as e:
        health_data["components"]["redis"] = {
            "status": "disconnected",
            "error": str(e)
        }

    # 3. Active WebSocket Connections
    active_ws = len(getattr(ws_manager, "active_connections", []))
    health_data["components"]["websockets"] = {
        "active_connections": active_ws
    }

    # 4. Process Resource Metrics
    try:
        proc = psutil.Process(os.getpid())
        mem_info = proc.memory_info()
        health_data["components"]["system"] = {
            "rss_memory_mb": round(mem_info.rss / (1024 * 1024), 2),
            "cpu_percent": proc.cpu_percent(interval=None)
        }
    except Exception:
        pass

    return health_data
