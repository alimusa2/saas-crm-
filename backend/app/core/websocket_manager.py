import asyncio
import json
import logging
from typing import Dict, List, Set, Any, Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Map organization_id -> Set of WebSockets
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, org_id: str):
        await websocket.accept()
        if org_id not in self.active_connections:
            self.active_connections[org_id] = set()
        self.active_connections[org_id].add(websocket)
        logger.info(f"WebSocket client connected to org {org_id}. Total active in org: {len(self.active_connections[org_id])}")

    def disconnect(self, websocket: WebSocket, org_id: str):
        if org_id in self.active_connections:
            self.active_connections[org_id].discard(websocket)
            if not self.active_connections[org_id]:
                del self.active_connections[org_id]
        logger.info(f"WebSocket client disconnected from org {org_id}.")

    async def broadcast_to_org(self, org_id: str, event_type: str, data: Any):
        """Broadcast an event payload to all active WebSocket clients in an organization."""
        payload = json.dumps({
            "event": event_type,
            "data": data
        }, default=str)

        if org_id in self.active_connections:
            dead_sockets = set()
            for connection in self.active_connections[org_id]:
                try:
                    await connection.send_text(payload)
                except Exception as e:
                    logger.warning(f"Error sending WebSocket message: {e}")
                    dead_sockets.add(connection)
            
            # Clean up disconnected sockets
            for dead in dead_sockets:
                self.active_connections[org_id].discard(dead)

manager = ConnectionManager()

async def broadcast_event(org_id: str, event_type: str, data: Any):
    """Global helper function to broadcast real-time updates."""
    await manager.broadcast_to_org(org_id, event_type, data)
