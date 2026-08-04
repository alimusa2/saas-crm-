import React, { useState, useRef, useEffect } from 'react';
import styles from './AISalesCoachDrawer.module.css';
import { aiCoachApi, type ChatMessage, type CoachSession } from '../../lib/aiCoachApi';
import {
  Sparkles, X, Minus, Trash2, Send, Copy, Check, Plus, MessageSquare
} from 'lucide-react';

const QUICK_ACTIONS = [
  { label: '📧 Email Reply', prompt: 'Write a professional follow-up email for: ' },
  { label: '❌ Handle Objection', prompt: 'Help me handle this customer objection: ' },
  { label: '🤝 Negotiation', prompt: 'Give me a negotiation strategy for: ' },
  { label: '🎯 Closing Tips', prompt: 'Suggest closing techniques for a deal where: ' },
  { label: '📅 Meeting Preparation', prompt: "What should I prepare for tomorrow's sales meeting with: " },
  { label: '💼 Sales Strategy', prompt: 'Provide a high-converting sales strategy for: ' },
];

const STARTER_CARDS = [
  { icon: '🤝', title: 'Negotiation Strategy', text: 'Get proven strategies for deal negotiations', prompt: 'Give me a negotiation strategy for: ' },
  { icon: '❌', title: 'Handle Objection', text: 'Overcome pricing or hesitation objections', prompt: 'Help me handle this customer objection: ' },
  { icon: '📧', title: 'Follow-Up Email', text: 'Write a professional follow-up email', prompt: 'Write a professional follow-up email for: ' },
  { icon: '🎯', title: 'Closing Strategy', text: 'Suggest closing techniques for a deal', prompt: 'Suggest closing techniques for a deal where: ' }
];


export const AISalesCoachDrawer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [sessions, setSessions] = useState<CoachSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom();
    }
  }, [messages, isOpen, isMinimized, loading]);

  const handleCreateNewSession = () => {
    setMessages([]);
  };

  const handleDeleteSession = () => {
    setMessages([]);
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputMsg).trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      created_at: new Date().toISOString()
    };

    const currentHistory = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMessage]);
    setInputMsg('');
    setLoading(true);

    try {
      const res = await aiCoachApi.sendStatelessMessage(text, currentHistory);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.reply,
        provider_used: res.provider_used,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Failed to send stateless message:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = (promptText: string) => {
    setInputMsg(promptText);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleCopy = (content: string, index: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const parseInlineBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const renderFormattedContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('### ')) {
        return <h3 key={idx} style={{ fontSize: '15px', fontWeight: 800, margin: '10px 0 4px 0', color: '#1E293B' }}>{parseInlineBold(trimmed.replace('### ', ''))}</h3>;
      }
      if (trimmed.startsWith('#### ')) {
        return <h4 key={idx} style={{ fontSize: '13.5px', fontWeight: 700, margin: '8px 0 4px 0', color: '#334155' }}>{parseInlineBold(trimmed.replace('#### ', ''))}</h4>;
      }
      if (trimmed.startsWith('> ')) {
        return (
          <blockquote key={idx} style={{ margin: '6px 0', padding: '8px 12px', background: '#FFFFFF', borderLeft: '3px solid #6366F1', borderRadius: '4px', fontSize: '13px', fontStyle: 'italic', color: '#1E293B', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            {parseInlineBold(trimmed.replace('> ', ''))}
          </blockquote>
        );
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return <li key={idx} style={{ marginLeft: '16px', marginBottom: '3px' }}>{parseInlineBold(trimmed.substring(2))}</li>;
      }
      if (/^\d+\.\s/.test(trimmed)) {
        return <div key={idx} style={{ marginLeft: '6px', fontWeight: 500, marginBottom: '3px' }}>{parseInlineBold(trimmed)}</div>;
      }
      if (trimmed === '---') {
        return <hr key={idx} style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: '10px 0' }} />;
      }
      if (!trimmed) return <div key={idx} style={{ height: '4px' }} />;

      return <p key={idx} style={{ margin: '3px 0' }}>{parseInlineBold(line)}</p>;
    });
  };

  return (
    <>
      {/* 1. Global Floating Trigger Button (Bottom-Right) */}
      {!isOpen && (
        <button
          type="button"
          className={styles.floatingTrigger}
          onClick={() => { setIsOpen(true); setIsMinimized(false); }}
          title="Open AI Sales Coach"
        >
          <div className={styles.floatingIcon}>
            <Sparkles size={22} />
          </div>
          <span className={styles.liveDot} title="AI Coach Active" />
        </button>
      )}

      {/* Minimized Dock Button */}
      {isOpen && isMinimized && (
        <button
          type="button"
          className={styles.floatingTrigger}
          onClick={() => setIsMinimized(false)}
          title="Expand AI Sales Coach"
        >
          <div className={styles.floatingIcon}>
            <Sparkles size={22} />
          </div>
          <span className={styles.liveDot} title="AI Coach Active" />
        </button>
      )}

      {/* Backdrop overlay for mobile */}
      {isOpen && !isMinimized && (
        <div className={styles.drawerOverlay} onClick={() => setIsMinimized(true)} />
      )}

      {/* 2. Sliding Drawer Panel */}
      <div className={`${styles.drawer} ${isOpen && !isMinimized ? styles.drawerOpen : styles.drawerClosed}`}>
        {/* Drawer Header */}
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerIconWrapper}>
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className={styles.headerTitle}>AI Sales Coach</h3>
              <p className={styles.headerSubtitle}>Role-play, pitch review & objection strategy</p>
            </div>
          </div>

          <div className={styles.headerActions}>
            {activeSessionId && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={handleDeleteSession}
                title="Delete/Archive Practice Session"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setIsMinimized(true)}
              title="Minimize Panel"
            >
              <Minus size={16} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setIsOpen(false)}
              title="Close Assistant"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Quick Action Pills */}
        <div className={styles.quickActionsContainer}>
          <div className={styles.quickActionsWrapper}>
            {QUICK_ACTIONS.map((qa, i) => (
              <button
                key={i}
                type="button"
                className={styles.quickPill}
                onClick={() => handleQuickAction(qa.prompt)}
              >
                {qa.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chat Messages Area */}
        <div className={styles.messagesArea}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateHeader}>
                <div className={styles.emptyStateIcon}>
                  <Sparkles size={24} />
                </div>
                <div>
                  <h4 className={styles.emptyStateTitle}>Welcome to AI Sales Coach! 👋</h4>
                  <p className={styles.emptyStateText}>
                    I'm your 24/7 sales strategist. Select a quick starter prompt below or ask any question to get started.
                  </p>
                </div>
              </div>

              <div className={styles.starterGrid}>
                {STARTER_CARDS.map((card, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={styles.starterCard}
                    onClick={() => handleQuickAction(card.prompt)}
                  >
                    <span className={styles.starterIcon}>{card.icon}</span>
                    <div className={styles.starterContent}>
                      <div className={styles.starterTitle}>{card.title}</div>
                      <div className={styles.starterDesc}>{card.text}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              return (
                <div key={idx} className={`${styles.msgRow} ${isUser ? styles.userRow : styles.aiRow}`}>
                  <div className={`${styles.msgBubble} ${isUser ? styles.userBubble : styles.aiBubble}`}>
                    <div>{renderFormattedContent(msg.content)}</div>

                    {!isUser && (
                      <button
                        type="button"
                        className={styles.copyBtn}
                        onClick={() => handleCopy(msg.content, idx)}
                        title="Copy Strategy text"
                      >
                        {copiedIndex === idx ? (
                          <>
                            <Check size={12} style={{ color: '#10B981' }} /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy size={12} /> Copy Strategy
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Typing Indicator */}
          {loading && (
            <div className={styles.typingIndicator}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#6366F1', marginRight: '4px' }}>
                Coach is analyzing & formulating strategy
              </span>
              <div className={styles.dot} />
              <div className={styles.dot} />
              <div className={styles.dot} />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar Footer */}
        <div className={styles.inputFooter}>
          <div className={styles.inputWrapper}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder="Ask a sales question, request role-play, or paste a pitch script..."
              value={inputMsg}
              onChange={e => setInputMsg(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
            />
            <button
              type="button"
              className={styles.sendBtn}
              disabled={!inputMsg.trim() || loading}
              onClick={() => handleSend()}
              title="Send Prompt"
            >
              <Send size={16} />
            </button>
          </div>
          <div className={styles.inputHint}>
            Press <strong>Enter</strong> to send • <strong>Shift + Enter</strong> for newline
          </div>
        </div>
      </div>
    </>
  );
};
