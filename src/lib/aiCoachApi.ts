import { api } from './api';

export interface ChatMessage {
  id?: string;
  session_id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  timestamp?: string;
  provider_used?: string;
}

export interface CoachSession {
  id: string;
  organization_id: string;
  user_id: string;
  title?: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  messages?: ChatMessage[];
}

export const aiCoachApi = {
  // Session Endpoints
  createSession: async (title?: string): Promise<CoachSession> => {
    return api<CoachSession>('/ai-coach/sessions', {
      method: 'POST',
      body: JSON.stringify({ title })
    });
  },

  listSessions: async (): Promise<CoachSession[]> => {
    return api<CoachSession[]>('/ai-coach/sessions', {
      method: 'GET'
    });
  },

  getSessionDetail: async (sessionId: string): Promise<CoachSession> => {
    return api<CoachSession>(`/ai-coach/sessions/${sessionId}`, {
      method: 'GET'
    });
  },

  sendMessageToSession: async (sessionId: string, content: string): Promise<ChatMessage> => {
    return api<ChatMessage>(`/ai-coach/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
  },

  deleteSession: async (sessionId: string): Promise<{ status: string }> => {
    return api<{ status: string }>(`/ai-coach/sessions/${sessionId}`, {
      method: 'DELETE'
    });
  },

  updateSessionTitle: async (sessionId: string, title: string): Promise<CoachSession> => {
    return api<CoachSession>(`/ai-coach/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title })
    });
  }
};
