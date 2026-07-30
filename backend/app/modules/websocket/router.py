from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
import logging
from app.core.websocket_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter()

@router.websocket("/ws/{org_id}")
async def websocket_endpoint(websocket: WebSocket, org_id: str):
    await manager.connect(websocket, org_id)
    try:
        while True:
            # Keep connection open and listen for ping/pong heartbeats
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket, org_id)
    except Exception as e:
        logger.warning(f"WebSocket error in org {org_id}: {e}")
        manager.disconnect(websocket, org_id)
