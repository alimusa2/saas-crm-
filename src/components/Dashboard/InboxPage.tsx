import React, { useState, useEffect, useMemo, useRef } from 'react';
import styles from './InboxPage.module.css';
import { inboxApi, crmApi, contactsApi, gmailApi, teamApi, calendarApi } from '../../lib/api';
import type { Message, Lead, Contact, GmailIntegration, TeamMember, Appointment } from '../../lib/api';
import {
  Send,
  Mail,
  MessageSquare,
  Plus,
  User,
  Check,
  CheckCheck,
  AlertCircle,
  Loader,
  ExternalLink,
  Search,
  Paperclip,
  Download,
  HelpCircle,
  ArrowLeft,
  Reply,
} from 'lucide-react';

interface Thread {
  key: string;
  type: 'Lead' | 'Contact' | 'Internal' | 'Unknown' | 'General';
  id: string; // lead_id or contact_id or other identifier
  name: string;
  email?: string;
  phone?: string;
  messages: Message[];
  lastMessage: Message;
  unreadCount: number;
}

export const InboxPage = () => {
  // Data lists
  const [messages, setMessages] = useState<Message[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [gmailStatus, setGmailStatus] = useState<GmailIntegration | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  // UI state
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Email' | 'Internal' | 'Unknown Contacts' | 'Archived' | 'Starred'>('All');
  const [showReplyForm, setShowReplyForm] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Compose / Reply inputs
  const [replyBody, setReplyBody] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyType, setReplyType] = useState<'Email' | 'Internal'>('Email');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // New thread compose inputs
  const [newRecipientType, setNewRecipientType] = useState<'Lead' | 'Contact' | 'Internal'>('Lead');
  const [newRecipientId, setNewRecipientId] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newType, setNewType] = useState<'Email' | 'Internal'>('Email');

  const threadMessagesRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);

  // Load everything on mount and poll for real-time updates
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      inboxApi.getMessages()
        .then(msgData => {
          setMessages(msgData);
        })
        .catch(e => console.error("Inbox polling failed:", e));
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async (isSilent = false) => {
    if (!isSilent && messages.length === 0) {
      setLoading(true);
    }
    try {
      // 1. Fetch messages & gmail status first so inbox renders immediately
      const [msgData, gmailData] = await Promise.all([
        inboxApi.getMessages(),
        gmailApi.getStatus().catch(() => null),
      ]);
      setMessages(msgData);
      if (gmailData) setGmailStatus(gmailData);
      setLoading(false);

      // 2. Fetch secondary context data asynchronously in background
      Promise.all([
        crmApi.getLeads().catch(() => []),
        contactsApi.getContacts().catch(() => []),
        teamApi.getTeamMembers().catch(() => []),
        calendarApi.getAppointments().catch(() => []),
      ]).then(([leadData, contactData, teamData, apptData]) => {
        setLeads(leadData);
        setContacts(contactData);
        setTeamMembers(teamData.filter(t => !t.is_deleted));
        setAppointments(apptData);
      });
    } catch (e) {
      console.error('Failed to load inbox data:', e);
      setLoading(false);
    }
  };

  // Scroll inner thread messages container and fetch full chat text when selected
  useEffect(() => {
    setShowReplyForm(false);
    if (selectedThreadKey) {
      // Fetch full body details for selected conversation chat
      inboxApi.getMessages(undefined, undefined, { include_full_body: true, limit: 100 })
        .then(fullMsgs => {
          setMessages(prev => {
            const fullMap = new Map(fullMsgs.map(m => [m.id, m]));
            return prev.map(m => fullMap.get(m.id) || m);
          });
        })
        .catch(e => console.error("Failed to fetch full thread body:", e));

      const timer = setTimeout(() => {
        if (latestMessageRef.current) {
          latestMessageRef.current.scrollIntoView({ behavior: 'auto', block: 'start' });
        } else if (threadMessagesRef.current) {
          threadMessagesRef.current.scrollTop = 0;
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [selectedThreadKey]);


  // Maps for quick lookup
  const leadMap = useMemo(() => new Map(leads.map(l => [l.id, l])), [leads]);
  const contactMap = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);

  // Helper to strip HTML tags and extra whitespace for clean preview text
  const stripHtml = (htmlStr: string): string => {
    if (!htmlStr) return '';
    try {
      const doc = new DOMParser().parseFromString(htmlStr, 'text/html');
      const text = doc.body.textContent || '';
      return text.replace(/\s+/g, ' ').trim();
    } catch (e) {
      return htmlStr.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
    }
  };

  // Handlers for Mark Read and Attachment download
  const handleMarkThreadRead = async (thread: Thread) => {
    const unreadMsgs = thread.messages.filter(m => !m.is_read && m.direction === 'Incoming');
    if (unreadMsgs.length === 0) return;
    try {
      await Promise.all(unreadMsgs.map(m => inboxApi.markAsRead(m.id)));
      setMessages(prev =>
        prev.map(m => (unreadMsgs.some(u => u.id === m.id) ? { ...m, is_read: true } : m))
      );
    } catch (e) {
      console.error('Failed to mark thread as read:', e);
    }
  };

  const formatMessageBodyWithClickableLinks = (rawBody: string) => {
    if (!rawBody) return '';
    let body = rawBody;
    if (!/<a\s+/i.test(body)) {
      body = body.replace(
        /(https?:\/\/[^\s<"']+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #4F46E5; text-decoration: underline; font-weight: 600; cursor: pointer; word-break: break-all;">$1</a>'
      );
    }
    return body;
  };

  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor && anchor.href) {
      e.preventDefault();
      e.stopPropagation();
      window.open(anchor.href, '_blank', 'noopener,noreferrer');
    }
  };


  const handleDownloadAttachment = async (msgId: string, attId: string, filename: string) => {
    try {
      const res = await gmailApi.getAttachmentData(msgId, attId);
      if (res.success && res.data_base64) {
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${res.data_base64}`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert(res.error || 'Failed to download attachment');
      }
    } catch (e: any) {
      alert(e.message || 'Error downloading attachment');
    }
  };

  // Group messages into Threads
  const threads = useMemo(() => {
    const grouped: Record<string, Message[]> = {};

    const getRootId = (msg: Message, allMsgs: Message[]): string => {
      let current = msg;
      const visited = new Set<string>();
      while (current.parent_id && !visited.has(current.parent_id)) {
        visited.add(current.id);
        const parent = allMsgs.find(m => m.id === current.parent_id);
        if (!parent) break;
        current = parent;
      }
      return current.id;
    };

    messages.forEach(msg => {
      let key = 'general';
      if (msg.gmail_thread_id) {
        key = `gmail_thread_${msg.gmail_thread_id}`;
      } else if (msg.lead_id) {
        key = `lead_${msg.lead_id}`;
      } else if (msg.contact_id) {
        key = `contact_${msg.contact_id}`;
      } else if (msg.is_unknown_contact) {
        key = `unknown_${msg.sender_email || msg.id}`;
      } else if (msg.is_ambiguous) {
        key = `ambiguous_${msg.sender_email}`;
      } else if (msg.message_type === 'Internal') {
        if (msg.parent_id) {
          const rootId = getRootId(msg, messages);
          key = `internal_thread_${rootId}`;
        } else if (msg.subject && !msg.subject.startsWith('Chat:')) {
          key = `internal_thread_${msg.id}`;
        } else {
          const sender = msg.sender_id || 'unknown';
          const recipient = msg.recipient_id || 'unknown';
          const sortedIds = [sender, recipient].sort().join('_');
          key = `internal_${sortedIds}`;
        }
      }

      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(msg);
    });

    const threadList: Thread[] = [];

    Object.entries(grouped).forEach(([key, threadMsgs]) => {
      // Sort messages chronologically inside thread
      threadMsgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const lastMessage = threadMsgs[threadMsgs.length - 1];
      const unreadCount = threadMsgs.filter(m => !m.is_read && m.direction === 'Incoming').length;

      let type: Thread['type'] = 'General';
      let id = '';
      let name = 'General Workspace Feed';
      let email: string | undefined;
      let phone: string | undefined;

      if (key.startsWith('gmail_thread_')) {
        id = key.replace('gmail_thread_', '');
        // Find lead, contact, or unknown sender details from messages
        const leadMsg = threadMsgs.find(m => m.lead_id);
        const contactMsg = threadMsgs.find(m => m.contact_id);
        if (leadMsg && leadMsg.lead_id) {
          type = 'Lead';
          const lead = leadMap.get(leadMsg.lead_id);
          name = lead ? `${lead.first_name} ${lead.last_name}` : 'Linked Lead';
          email = lead?.email || leadMsg.sender_email;
          phone = lead?.phone;
        } else if (contactMsg && contactMsg.contact_id) {
          type = 'Contact';
          const contact = contactMap.get(contactMsg.contact_id);
          name = contact ? `${contact.first_name} ${contact.last_name}` : 'Linked Contact';
          email = contact?.email || contactMsg.sender_email;
          phone = contact?.phone;
        } else {
          type = 'Unknown';
          const senderEm = threadMsgs.find(m => m.direction === 'Incoming')?.sender_email || lastMessage.sender_email;
          name = senderEm ? `Unknown (${senderEm})` : 'Unknown Sender';
          email = senderEm;
        }
      } else if (key.startsWith('lead_')) {
        type = 'Lead';
        id = key.replace('lead_', '');
        const lead = leadMap.get(id);
        name = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Lead';
        email = lead?.email;
        phone = lead?.phone;
      } else if (key.startsWith('contact_')) {
        type = 'Contact';
        id = key.replace('contact_', '');
        const contact = contactMap.get(id);
        name = contact ? `${contact.first_name} ${contact.last_name}` : 'Unknown Contact';
        email = contact?.email;
        phone = contact?.phone;
      } else if (key.startsWith('unknown_')) {
        type = 'Unknown';
        id = key.replace('unknown_', '');
        name = `Unknown Contact (${id})`;
        email = id;
      } else if (key.startsWith('ambiguous_')) {
        type = 'General';
        id = key.replace('ambiguous_', '');
        name = `Ambiguous Match: ${id}`;
        email = id;
      } else if (key.startsWith('internal_') || key.startsWith('internal_thread_')) {
        type = 'Internal';
        id = key.replace('internal_thread_', '').replace('internal_', '');
        name = lastMessage.subject || 'Internal Discussion';
        
        const otherEmail = lastMessage.sender_email === gmailStatus?.gmail_address
          ? lastMessage.recipient_email
          : lastMessage.sender_email;
          
        if (otherEmail) {
          name = `${lastMessage.subject || 'Internal Conversation'} (${otherEmail})`;
        } else if (lastMessage.subject) {
          name = lastMessage.subject;
        }
      }

      threadList.push({
        key,
        type,
        id,
        name,
        email,
        phone,
        messages: threadMsgs,
        lastMessage,
        unreadCount,
      });
    });

    // Sort threads by latest message timestamp descending
    return threadList.sort(
      (a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
    );
  }, [messages, leadMap, contactMap, gmailStatus]);

  // Filter and search threads
  const filteredThreads = useMemo(() => {
    return threads.filter(t => {
      // Archive Filter
      const allArchived = t.messages.every(m => m.is_archived);
      const anyArchived = t.messages.some(m => m.is_archived);
      if (filter === 'Archived') {
        return anyArchived;
      } else if (allArchived) {
        return false;
      }

      // Channel / Category Filter
      if (filter === 'Email' && !t.messages.some(m => m.message_type === 'Email')) return false;
      if (filter === 'Internal' && t.type !== 'Internal') return false;
      if (filter === 'Unknown Contacts' && t.type !== 'Unknown' && !t.messages.some(m => m.is_unknown_contact)) return false;
      if (filter === 'Starred' && !t.messages.some(m => m.is_starred)) return false;

      // Search Query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(query);
        const matchesEmail = t.email?.toLowerCase().includes(query);
        const matchesBody = t.messages.some(m => m.body.toLowerCase().includes(query));
        return matchesName || matchesEmail || matchesBody;
      }

      return true;
    });
  }, [threads, filter, searchQuery]);


  // Find currently selected thread
  const activeThread = useMemo(() => {
    return threads.find(t => t.key === selectedThreadKey) || null;
  }, [threads, selectedThreadKey]);

  // Auto-fill reply form details when selected thread changes
  useEffect(() => {
    if (activeThread) {
      const lastMsg = activeThread.lastMessage;
      setReplySubject(lastMsg.subject ? (lastMsg.subject.startsWith('Re:') ? lastMsg.subject : `Re: ${lastMsg.subject}`) : 'Re: Dashboard Message');
      setReplyBody('');
      setSendError(null);
      // Auto-set channel to last message channel
      if (lastMsg.message_type === 'Email' || lastMsg.message_type === 'Internal') {
        setReplyType(lastMsg.message_type);
      }
    }
  }, [selectedThreadKey]);



  // Quick Reply handler
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeThread || !replyBody.trim()) return;

    setSending(true);
    setSendError(null);

    try {
      let newMsg: Message;
      if (replyType === 'Email') {
        // Send email via Gmail API
        if (!gmailStatus?.is_connected) {
          throw new Error('Please connect your Gmail account in Settings before sending emails.');
        }
        if (!activeThread.email) {
          throw new Error('This contact does not have a verified email address.');
        }
        newMsg = await inboxApi.sendEmail({
          to_email: activeThread.email,
          subject: replySubject,
          body: replyBody,
          lead_id: activeThread.type === 'Lead' ? activeThread.id : undefined,
          contact_id: activeThread.type === 'Contact' ? activeThread.id : undefined,
          parent_id: activeThread.lastMessage.id,
        });
      } else {
        // Send Internal log
        newMsg = await inboxApi.sendMessage({
          body: replyBody,
          subject: replySubject,
          message_type: replyType,
          lead_id: activeThread.type === 'Lead' ? activeThread.id : undefined,
          contact_id: activeThread.type === 'Contact' ? activeThread.id : undefined,
          recipient_id: activeThread.type === 'Internal' ? activeThread.id : undefined,
          parent_id: activeThread.lastMessage.id,
          direction: 'Outgoing',
          delivery_status: 'Sent',
          sender_email: gmailStatus?.gmail_address || 'me@growthos.com',
          recipient_email: activeThread.email || 'me@growthos.com',
        });
      }

      setMessages(prev => [newMsg, ...prev]);
      setReplyBody('');
      setShowReplyForm(false);
    } catch (err: any) {
      setSendError(err.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  // Start New Conversation (Compose) handler
  const handleSendNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRecipientId || !newBody.trim()) return;

    setSending(true);
    setSendError(null);

    let toEmail = '';
    let leadId: string | undefined;
    let contactId: string | undefined;
    let recipientId: string | undefined;

    if (newRecipientType === 'Lead') {
      const lead = leadMap.get(newRecipientId);
      toEmail = lead?.email || '';
      leadId = newRecipientId;
    } else if (newRecipientType === 'Contact') {
      const contact = contactMap.get(newRecipientId);
      toEmail = contact?.email || '';
      contactId = newRecipientId;
    } else if (newRecipientType === 'Internal') {
      const tm = teamMembers.find(t => t.id === newRecipientId);
      toEmail = tm?.email || '';
      recipientId = tm?.user_id || undefined;
    }

    try {
      let newMsg: Message;
      if (newType === 'Email') {
        if (!gmailStatus?.is_connected) {
          throw new Error('Gmail is not connected. Please connect Gmail in Settings.');
        }
        if (!toEmail) {
          throw new Error('Selected recipient does not have an email address.');
        }
        newMsg = await inboxApi.sendEmail({
          to_email: toEmail,
          subject: newSubject || 'No Subject',
          body: newBody,
          lead_id: leadId,
          contact_id: contactId,
        });
      } else {
        newMsg = await inboxApi.sendMessage({
          body: newBody,
          subject: newSubject || 'No Subject',
          message_type: newType,
          lead_id: leadId,
          contact_id: contactId,
          recipient_id: recipientId,
          direction: 'Outgoing',
          delivery_status: 'Sent',
          sender_email: gmailStatus?.gmail_address || 'me@growthos.com',
          recipient_email: toEmail || 'No recipient contact details',
        });
      }

      setMessages(prev => [newMsg, ...prev]);
      setIsComposing(false);
      // Reset compose state
      setNewRecipientId('');
      setNewSubject('');
      setNewBody('');
      // Open the new thread
      const newKey = leadId
        ? `lead_${leadId}`
        : contactId
        ? `contact_${contactId}`
        : `internal_${[gmailStatus?.gmail_address || 'me@growthos.com', toEmail].sort().join('_')}`;
      setSelectedThreadKey(newKey);
    } catch (err: any) {
      setSendError(err.message || 'Failed to send conversation.');
    } finally {
      setSending(false);
    }
  };

  // Render checkmark icon for message delivery status
  const renderDeliveryStatus = (msg: Message) => {
    if (msg.direction !== 'Outgoing') return null;

    switch (msg.delivery_status) {
      case 'Sending':
        return (
          <span className={`${styles.statusBadge} ${styles.statusSending}`} title="Sending email via Gmail API…">
            <Loader size={12} className={styles.spinIcon} /> Sending…
          </span>
        );
      case 'Sent':
        return (
          <span className={`${styles.statusBadge} ${styles.statusSent}`} title="Sent successfully">
            <Check size={12} /> Sent
          </span>
        );
      case 'Delivered':
        return (
          <span className={`${styles.statusBadge} ${styles.statusSent}`} title="Delivered to recipient">
            <CheckCheck size={12} /> Delivered
          </span>
        );
      case 'Failed':
        return (
          <span
            className={`${styles.statusBadge} ${styles.statusFailed}`}
            title={msg.error_message || 'Delivery failed'}
          >
            <AlertCircle size={12} /> Failed
          </span>
        );
      default:
        return null;
    }
  };

  const getThreadIcon = (thread: Thread) => {
    if (thread.key.startsWith('ambiguous_')) {
      return <AlertCircle size={18} style={{ color: '#eab308' }} />;
    }
    if (thread.type === 'Unknown') {
      return <HelpCircle size={18} style={{ color: '#94a3b8' }} />;
    }
    switch (thread.type) {
      case 'Lead':
      case 'Contact':
        return <User size={18} />;
      default:
        return <MessageSquare size={18} />;
    }
  };

  return (
    <div className={styles.container}>
      {/* ── Left list panel ────────────────────────────────────────────────── */}
      <div className={`${styles.sidebar} ${selectedThreadKey || isComposing ? styles.hideOnMobile : ''}`}>
        <div className={styles.sidebarHeader}>
          <h2>
            CRM Inbox{' '}
            {threads.some(t => t.unreadCount > 0) && (
              <span className={styles.badge}>
                {threads.reduce((acc, t) => acc + t.unreadCount, 0)} new
              </span>
            )}
          </h2>
          <button className={styles.composeBtn} onClick={() => { setIsComposing(true); setSelectedThreadKey(null); }}>
            <Plus size={16} /> Compose
          </button>
        </div>

        {/* Search bar */}
        <div className={styles.searchBar}>
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-tertiary)' }}
            />
            <input
              type="text"
              placeholder="Search conversations…"
              className={styles.searchInput}
              style={{ paddingLeft: 30 }}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Tab Filters */}
        <div className={styles.filterBar}>
          {(['All', 'Email', 'Internal', 'Unknown Contacts'] as const).map(t => (
            <button
              key={t}
              className={`${styles.filterTab} ${filter === t ? styles.active : ''}`}
              onClick={() => setFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Conversation list */}
        <div className={styles.messageList}>
          {loading && <div className={styles.emptyState}>Loading conversations…</div>}
          {!loading && filteredThreads.length === 0 && (
            <div className={styles.emptyState}>
              <MessageSquare size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p>No conversations found</p>
            </div>
          )}
          {filteredThreads.map(thread => (
            <div
              key={thread.key}
              className={`${styles.messageItem} ${selectedThreadKey === thread.key ? styles.active : ''} ${
                thread.unreadCount > 0 ? styles.unread : ''
              }`}
              onClick={() => {
                setSelectedThreadKey(thread.key);
                setIsComposing(false);
                handleMarkThreadRead(thread);
              }}
            >
              <div className={styles.msgIcon}>{getThreadIcon(thread)}</div>
              <div className={styles.msgPreview}>
                <div className={styles.msgMetaLine}>
                  <span className={styles.msgSenderName}>{thread.name}</span>
                  <span className={styles.msgDate}>
                    {new Date(thread.lastMessage.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className={styles.msgSubject}>{thread.lastMessage.subject || '(no subject)'}</div>
                <div className={styles.msgBody}>
                  {thread.lastMessage.direction === 'Outgoing' ? 'You: ' : ''}
                  {stripHtml(thread.lastMessage.body)}
                </div>
                <div className={styles.msgFooterLine} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={styles.msgTypeLabel}>{thread.lastMessage.message_type}</span>
                  {thread.messages.some(m => m.attachments_metadata) && (
                    <span style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--text-tertiary)' }} title="Has attachments">
                      <Paperclip size={11} />
                    </span>
                  )}
                  {thread.lastMessage.direction === 'Outgoing' && (
                    <span className={styles.statusIndicator}>
                      {renderDeliveryStatus(thread.lastMessage)}
                    </span>
                  )}
                </div>
              </div>
              {thread.unreadCount > 0 && <div className={styles.unreadDot} />}
            </div>
          ))}
        </div>
      </div>


      {/* ── Right details panel ────────────────────────────────────────────── */}
      <div className={`${styles.content} ${!selectedThreadKey && !isComposing ? styles.hideOnMobile : ''}`}>
        {isComposing ? (
          /* ── Compose panel ── */
          <div className={styles.composeArea}>
            <div className={styles.composeHeader}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  className={styles.mobileBackBtn}
                  onClick={() => setIsComposing(false)}
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <h3>Start New Conversation</h3>
              </div>
              <button type="button" className={styles.closeBtn} onClick={() => setIsComposing(false)}>✕</button>
            </div>
            <form onSubmit={handleSendNew} className={styles.composeForm}>
              <div className={styles.formGroup}>
                <label>Recipient Type</label>
                <select
                  value={newRecipientType}
                  onChange={e => {
                    setNewRecipientType(e.target.value as any);
                    setNewRecipientId('');
                    if (e.target.value === 'Internal') {
                      setNewType('Internal');
                    } else {
                      setNewType('Email');
                    }
                  }}
                >
                  <option value="Lead">Lead</option>
                  <option value="Contact">Contact</option>
                  <option value="Internal">Team Member</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>Select Recipient</label>
                <select
                  value={newRecipientId}
                  onChange={e => setNewRecipientId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Recipient --</option>
                  {newRecipientType === 'Lead' &&
                    leads.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.first_name} {l.last_name} ({l.email || 'no email'})
                      </option>
                    ))}
                  {newRecipientType === 'Contact' &&
                    contacts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name} ({c.email || 'no email'})
                      </option>
                    ))}
                  {newRecipientType === 'Internal' &&
                    teamMembers.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.first_name ? `${t.first_name} ${t.last_name || ''}` : t.email} ({t.email})
                      </option>
                    ))}
                </select>
              </div>

              {newRecipientType !== 'Internal' && (
                <div className={styles.formGroup}>
                  <label>Channel</label>
                  <select
                    value={newType}
                    onChange={e => setNewType(e.target.value as any)}
                  >
                    <option value="Email">Email</option>
                  </select>
                </div>
              )}

              <div className={styles.formGroup}>
                <label>Subject</label>
                <input
                  type="text"
                  placeholder="Message subject…"
                  value={newSubject}
                  onChange={e => setNewSubject(e.target.value)}
                />
              </div>

              {newType === 'Email' && !gmailStatus?.is_connected && (
                <div className={styles.gmailWarningBanner}>
                  <AlertCircle size={16} />
                  <span>
                    Gmail integration is not connected. Emails cannot be dispatched. Please{' '}
                    <a href="#" onClick={(e) => { e.preventDefault(); alert('Please navigate to Settings -> Email Integration to connect.'); }}>
                      Connect Gmail in Settings
                    </a>{' '}
                    before sending.
                  </span>
                </div>
              )}

              <div className={styles.formGroup}>
                <label>Message</label>
                <textarea
                  rows={5}
                  placeholder="Compose your message here…"
                  required
                  value={newBody}
                  onChange={e => setNewBody(e.target.value)}
                />
              </div>

              {sendError && <div className={styles.errorText}>{sendError}</div>}

              <div className={styles.composeActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsComposing(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.sendBtn}
                  disabled={sending}
                >
                  {sending ? 'Sending…' : 'Send Message'}
                </button>
              </div>
            </form>
          </div>
        ) : activeThread ? (
          /* ── Thread view panel ── */
          <div className={styles.threadDetails}>
            {/* Header info */}
            <div className={styles.threadHeader}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  className={styles.mobileBackBtn}
                  onClick={() => { setSelectedThreadKey(null); setIsComposing(false); }}
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <div className={styles.threadHeaderInfo}>
                  <h2 className={styles.threadTitle}>{activeThread.name}</h2>
                  <div className={styles.threadMeta}>
                    {activeThread.type} Thread
                    {activeThread.email && <> · <strong>{activeThread.email}</strong></>}
                    {activeThread.phone && <> · {activeThread.phone}</>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {activeThread.type === 'Lead' && (
                  <span className={styles.bubbleTypeBadge} style={{ background: 'var(--primary-color)', color: 'white' }}>
                    Lead
                  </span>
                )}
                {activeThread.type === 'Contact' && (
                  <span className={styles.bubbleTypeBadge} style={{ background: '#059669', color: 'white' }}>
                    Contact
                  </span>
                )}
              </div>
            </div>

            {/* Ambiguous Match warning banner */}
            {activeThread.messages.some(m => m.is_ambiguous) && (
              <div style={{
                background: '#fef3c7',
                borderBottom: '1px solid #f59e0b',
                padding: '12px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                color: '#92400e',
                fontSize: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={18} style={{ color: '#d97706' }} />
                  <span>
                    <strong>Ambiguous Lead Match:</strong> Multiple Leads match this sender email. Please link manually:
                  </span>
                </div>
                <select
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #d97706',
                    background: 'white',
                    color: '#92400e',
                    outline: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  value=""
                  onChange={async (e) => {
                    const val = e.target.value;
                    if (!val) return;
                    if (window.confirm("Are you sure you want to link this conversation to the selected Lead?")) {
                      try {
                        const targetMsg = activeThread.messages.find(m => m.is_ambiguous);
                        if (targetMsg) {
                          await inboxApi.linkMessage(targetMsg.id, { lead_id: val });
                          alert("Successfully linked to Lead!");
                          window.location.reload();
                        }
                      } catch (err: any) {
                        alert(err.message || "Failed to link message");
                      }
                    }
                  }}
                >
                  <option value="">-- Link to Lead --</option>
                  {leads
                    .filter(l => l.email?.toLowerCase() === activeThread.email?.toLowerCase())
                    .map(l => (
                      <option key={l.id} value={l.id}>
                        {l.first_name} {l.last_name} ({l.status})
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Messages scrolling container */}
            <div className={styles.threadMessages} ref={threadMessagesRef}>
              {activeThread.messages.map((msg, idx) => {
                const isOutgoing = msg.direction === 'Outgoing';
                const isLatest = idx === activeThread.messages.length - 1;
                return (
                  <div
                    key={msg.id}
                    ref={isLatest ? latestMessageRef : null}
                    className={`${styles.messageBubbleWrapper} ${
                      isOutgoing ? styles.outgoing : styles.incoming
                    }`}
                  >
                    <div className={styles.bubbleSenderLine}>
                      <span>{isOutgoing ? 'You' : activeThread.name}</span>
                      <span>·</span>
                      <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className={styles.messageBubble}>
                      {msg.subject && <div style={{ fontWeight: 700, marginBottom: 4 }}>{msg.subject}</div>}
                      <div dangerouslySetInnerHTML={{ __html: formatMessageBodyWithClickableLinks(msg.body) }} onClick={handleBodyClick} />
                      
                      {/* Attachments rendering */}
                      {msg.attachments_metadata && (() => {
                        try {
                          const atts: any[] = JSON.parse(msg.attachments_metadata);
                          if (!atts || atts.length === 0) return null;
                          return (
                            <div style={{ marginTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Paperclip size={13} /> Attachments ({atts.length})
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {atts.map((att: any, idx: number) => (
                                  <div
                                    key={att.id || idx}
                                    style={{
                                      background: 'rgba(255,255,255,0.85)',
                                      border: '1px solid #cbd5e1',
                                      borderRadius: 6,
                                      padding: '6px 10px',
                                      fontSize: 12,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                    }}
                                  >
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      <span style={{ fontWeight: 600, color: '#1e293b' }}>{att.filename}</span>
                                      <span style={{ fontSize: 10, color: '#64748b' }}>
                                        {att.size ? `${(att.size / 1024).toFixed(1)} KB` : 'Attachment'}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleDownloadAttachment(msg.gmail_message_id || msg.id, att.id, att.filename)}
                                      style={{
                                        background: 'var(--primary-color)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 4,
                                        padding: '4px 8px',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                      }}
                                    >
                                      <Download size={11} /> Download
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        } catch (e) {
                          return null;
                        }
                      })()}

                      {msg.appointment_id && (
                        <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                          {(() => {
                            const appt = appointments.find(a => a.id === msg.appointment_id);
                            if (!appt) return null;
                            return (
                              <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', padding: 10, borderRadius: 8, marginTop: 6, color: '#334155' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600 }}>📅 Related Meeting: {appt.title}</span>
                                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#e0e7ff', color: '#4338ca', textTransform: 'uppercase' }}>
                                    {appt.status}
                                  </span>
                                </div>
                                {['Scheduled', 'Rescheduled', 'Pending'].includes(appt.status) && (
                                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <button
                                      onClick={async (e) => {
                                        e.preventDefault();
                                        try {
                                          const updated = await calendarApi.updateAppointment(appt.id, { status: 'Confirmed' });
                                          setAppointments(prev => prev.map(a => a.id === updated.id ? updated : a));
                                          alert(`Meeting "${appt.title}" has been Confirmed successfully!`);
                                        } catch (err: any) {
                                          alert(err.message || 'Failed to confirm meeting');
                                        }
                                      }}
                                      style={{
                                        background: '#10b981', color: 'white', border: 'none', padding: '4px 10px',
                                        borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer'
                                      }}
                                    >
                                      Confirm Meeting
                                    </button>
                                    <button
                                      onClick={async (e) => {
                                        e.preventDefault();
                                        try {
                                          const updated = await calendarApi.updateAppointment(appt.id, { status: 'Cancelled' });
                                          setAppointments(prev => prev.map(a => a.id === updated.id ? updated : a));
                                          alert(`Meeting "${appt.title}" has been Cancelled.`);
                                        } catch (err: any) {
                                          alert(err.message || 'Failed to cancel meeting');
                                        }
                                      }}
                                      style={{
                                        background: '#ef4444', color: 'white', border: 'none', padding: '4px 10px',
                                        borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer'
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    <div className={styles.bubbleFooter}>
                      <span className={styles.bubbleTypeBadge}>{msg.message_type}</span>
                      {isOutgoing && renderDeliveryStatus(msg)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reply action trigger or editor */}
            {!showReplyForm ? (
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-color)', background: 'var(--surface-color)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  className={styles.sendBtn}
                  onClick={() => setShowReplyForm(true)}
                >
                  <Reply size={14} /> Reply
                </button>
              </div>
            ) : (
              <div className={styles.replyArea}>
                <form onSubmit={handleSendReply} className={styles.replyForm}>
                  <div className={styles.replyHeader}>
                    <div className={styles.replyToLine}>
                      Reply via:
                      <span style={{ marginLeft: 8 }} className={styles.typeSelector}>
                        {(['Email', 'Internal'] as const).map(t => (
                          <button
                            key={t}
                            type="button"
                            className={`${styles.typeSelectBtn} ${replyType === t ? styles.active : ''}`}
                            onClick={() => setReplyType(t)}
                          >
                            {t}
                          </button>
                        ))}
                      </span>
                    </div>
                    {activeThread.email && replyType === 'Email' && (
                      <span className={styles.replyToEmail}>To: {activeThread.email}</span>
                    )}
                  </div>

                  {replyType === 'Email' && !gmailStatus?.is_connected && (
                    <div className={styles.gmailWarningBanner}>
                      <AlertCircle size={16} />
                      <span>
                        Gmail connection inactive. Outbound emails will fail. Go to Settings and Connect with Google to fix.
                      </span>
                    </div>
                  )}

                  <div className={styles.replyInputGroup}>
                    {replyType === 'Email' && (
                      <input
                        type="text"
                        className={styles.subjectInput}
                        placeholder="Subject line"
                        required
                        value={replySubject}
                        onChange={e => setReplySubject(e.target.value)}
                      />
                    )}
                    <textarea
                      className={styles.bodyTextarea}
                      placeholder={`Type your ${replyType.toLowerCase()} response here…`}
                      required
                      value={replyBody}
                      onChange={e => setReplyBody(e.target.value)}
                    />
                  </div>

                  <div className={styles.replyActions}>
                    {sendError && <span className={styles.errorText}>{sendError}</span>}
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      onClick={() => setShowReplyForm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={styles.sendBtn}
                      disabled={sending}
                    >
                      <Send size={14} />
                      {sending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        ) : (
          /* ── Empty placeholder ── */
          <div className={styles.emptyContent}>
            <Mail size={56} style={{ opacity: 0.15, marginBottom: 12 }} />
            <h3>Your Inbox</h3>
            <p>Select a thread on the left or compose a message to start communicating.</p>
          </div>
        )}
      </div>
    </div>
  );
};
