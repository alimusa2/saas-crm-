import json
import logging
import time
from typing import Any, Optional, Dict
from app.core.config import settings

logger = logging.getLogger(__name__)

# Fallback In-Memory TTL Cache (used if Redis is offline or not installed locally)
_in_memory_cache: Dict[str, tuple[Any, float]] = {}

_redis_client = None
_redis_available = False

async def get_redis_client():
    global _redis_client, _redis_available
    if _redis_client is None:
        try:
            import redis.asyncio as aioredis
            _redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True, socket_timeout=1.5)
            await _redis_client.ping()
            _redis_available = True
            logger.info("Connected to Redis cache engine.")
        except Exception as e:
            _redis_available = False
            _redis_client = None
            logger.warning(f"Redis unavailable ({e}). Using high-speed in-memory TTL cache fallback.")
    return _redis_client if _redis_available else None


async def cache_get(key: str) -> Optional[Any]:
    """Retrieve item from Redis or in-memory TTL fallback."""
    client = await get_redis_client()
    if client:
        try:
            val = await client.get(key)
            if val is not None:
                return json.loads(val)
        except Exception as e:
            logger.debug(f"Redis cache_get error: {e}")

    # Fallback to in-memory cache
    if key in _in_memory_cache:
        val, expire_time = _in_memory_cache[key]
        if time.time() < expire_time:
            return val
        else:
            del _in_memory_cache[key]
    return None


async def cache_set(key: str, value: Any, expire_seconds: int = 60) -> bool:
    """Store item in Redis or in-memory TTL fallback."""
    # Always update in-memory fallback for local speed
    _in_memory_cache[key] = (value, time.time() + expire_seconds)
    
    # Prune expired items from in-memory cache occasionally
    if len(_in_memory_cache) > 1000:
        now = time.time()
        expired_keys = [k for k, (_, exp) in _in_memory_cache.items() if now >= exp]
        for k in expired_keys:
            _in_memory_cache.pop(k, None)

    client = await get_redis_client()
    if client:
        try:
            val_json = json.dumps(value, default=str)
            await client.setex(key, expire_seconds, val_json)
            return True
        except Exception as e:
            logger.debug(f"Redis cache_set error: {e}")
    return True


async def cache_delete_pattern(pattern: str) -> int:
    """Invalidate cache keys matching pattern."""
    count = 0
    # Invalidate matching keys in memory
    prefix = pattern.replace("*", "")
    to_del = [k for k in _in_memory_cache.keys() if prefix in k]
    for k in to_del:
        _in_memory_cache.pop(k, None)
        count += 1

    client = await get_redis_client()
    if client:
        try:
            keys = await client.keys(pattern)
            if keys:
                await client.delete(*keys)
                count += len(keys)
        except Exception as e:
            logger.debug(f"Redis cache_delete_pattern error: {e}")
    return count
