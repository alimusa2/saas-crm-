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
  const onEventRef = useRef(onEvent);

  // Keep latest onEvent callback in ref without re-triggering effect
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const orgId = (user as any)?.org || (user as any)?.organization_id || 'default_org';

  const connect = useCallback(() => {
    if (!orgId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:8000/ws/${orgId}`;

    try {
      if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

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
          if (onEventRef.current) {
            onEventRef.current(parsed);
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
  }, [orgId]);

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) {
        const ws = socketRef.current;
        if ((ws as any)._pingInterval) {
          clearInterval((ws as any)._pingInterval);
        }
        
        // Prevent Strict Mode 'closed before connection established' warning
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => {
            try { ws.close(); } catch (e) {}
          };
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        socketRef.current = null;
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
