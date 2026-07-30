import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';

export interface WebSocketEvent {
  event: string;
  data: any;
}

export const useWebSocket = (onEvent?: (event: WebSocketEvent) => void) => {
  const { user } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<any>(null);

  const orgId = (user as any)?.org || (user as any)?.organization_id || 'default_org';

  const connect = useCallback(() => {
    if (!orgId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:8000/ws/${orgId}`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // Send heartbeat ping every 30 seconds
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 30000);

        (ws as any)._pingInterval = pingInterval;
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const parsed: WebSocketEvent = JSON.parse(event.data);
          if (onEvent) {
            onEvent(parsed);
          }
        } catch (err) {
          // Non-JSON message
        }
      };

      ws.onclose = () => {
        if ((ws as any)._pingInterval) {
          clearInterval((ws as any)._pingInterval);
        }
        // Auto reconnect after 5 seconds
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };

      socketRef.current = ws;
    } catch (e) {
      // Ignore WebSocket connection error
    }
  }, [orgId, onEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) {
        if ((socketRef.current as any)._pingInterval) {
          clearInterval((socketRef.current as any)._pingInterval);
        }
        socketRef.current.close();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return {
    socket: socketRef.current
  };
};
