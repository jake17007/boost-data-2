import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import useConversations from './useConversations';
import useClaudeSend from './useClaudeSend';

const API = 'http://localhost:8000';

export default function ClaudePanel() {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const [activity, setActivity] = useState(null);
  const [openTabs, setOpenTabs] = useState([]); // array of conversation IDs
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const bottomRef = useRef(null);

  const {
    conversations,
    activeId,
    activeConversation,
    loaded,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
    updateConversation,
  } = useConversations();

  // Initialize open tabs once conversations load
  useEffect(() => {
    if (loaded && conversations.length && !openTabs.length) {
      setOpenTabs([conversations[conversations.length - 1].id]);
    }
  }, [loaded, conversations, openTabs.length]);

  // Ensure active tab is in openTabs
  useEffect(() => {
    if (activeId && !openTabs.includes(activeId)) {
      setOpenTabs((prev) => [...prev, activeId]);
    }
  }, [activeId, openTabs]);

  const activeRef = useRef(activeConversation);
  activeRef.current = activeConversation;

  // Auto-name after first message
  const autoName = useCallback(async (convId, message) => {
    try {
      const res = await fetch(`${API}/conversations/${convId}/auto-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (data.name) {
        renameConversation(convId, data.name);
      }
    } catch {
      // ignore
    }
  }, [renameConversation]);

  const handlers = useMemo(() => ({
    onSessionId: (sid) => {
      updateConversation(activeRef.current.id, { sessionId: sid });
    },
    onText: (text) => {
      const conv = activeRef.current;
      const msgs = [...conv.messages];
      msgs[msgs.length - 1] = { role: 'assistant', text };
      updateConversation(conv.id, { messages: msgs });
    },
    onActivity: setActivity,
    onDone: (text) => {
      const conv = activeRef.current;
      const msgs = [...conv.messages];
      msgs[msgs.length - 1] = { role: 'assistant', text };
      updateConversation(conv.id, { messages: msgs });
    },
    onError: (errMsg) => {
      const conv = activeRef.current;
      const msgs = [...conv.messages];
      msgs[msgs.length - 1] = { role: 'assistant', text: `Error: ${errMsg}` };
      updateConversation(conv.id, { messages: msgs });
    },
  }), [updateConversation]);

  const { send, loading } = useClaudeSend(handlers);

  const messages = activeConversation?.messages || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activity]);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || loading) return;

    setInput('');
    const conv = activeRef.current;
    const isFirstMessage = conv.messages.length === 0;
    const updated = [
      ...conv.messages,
      { role: 'user', text: msg },
      { role: 'assistant', text: '' },
    ];
    updateConversation(conv.id, { messages: updated });
    send(msg, conv.sessionId);

    if (isFirstMessage) {
      autoName(conv.id, msg);
    }
  }, [input, loading, send, updateConversation, autoName]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = async () => {
    const conv = await createConversation();
    setOpenTabs((prev) => [...prev, conv.id]);
    setShowHistory(false);
  };

  const closeTab = (e, id) => {
    e.stopPropagation();
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      if (!next.length) return prev; // don't close the last tab
      if (id === activeId) {
        const idx = prev.indexOf(id);
        switchConversation(next[Math.min(idx, next.length - 1)]);
      }
      return next;
    });
  };

  const openFromHistory = (id) => {
    if (!openTabs.includes(id)) {
      setOpenTabs((prev) => [...prev, id]);
    }
    switchConversation(id);
    setShowHistory(false);
  };

  const startRename = (e, conv) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditName(conv.name);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      renameConversation(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const handleDeleteFromHistory = (e, id) => {
    e.stopPropagation();
    setOpenTabs((prev) => prev.filter((t) => t !== id));
    deleteConversation(id);
  };

  const getPreview = (conv) => {
    const first = conv.messages?.find((m) => m.role === 'user');
    if (!first) return 'Empty conversation';
    return first.text.length > 60 ? first.text.slice(0, 60) + '...' : first.text;
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  // Get conversation objects for open tabs, preserving tab order
  const tabConversations = openTabs
    .map((id) => conversations.find((c) => c.id === id))
    .filter(Boolean);

  if (!open) {
    return (
      <button className="claude-fab" onClick={() => setOpen(true)}>
        Claude
      </button>
    );
  }

  return (
    <div className="claude-panel">
      <div className="claude-panel-header">
        <div className="claude-header-left">
          <button
            className={`claude-history-btn ${showHistory ? 'claude-history-btn--active' : ''}`}
            onClick={() => setShowHistory(!showHistory)}
            title="Conversation history"
          >
            &#9776;
          </button>
          <span>Claude Code</span>
        </div>
        <div className="claude-header-right">
          <button className="claude-new-btn" onClick={handleNewConversation} title="New conversation">
            +
          </button>
          <button className="claude-close" onClick={() => setOpen(false)}>
            &times;
          </button>
        </div>
      </div>

      <div className="claude-conv-bar">
        {tabConversations.map((conv) => (
          <div
            key={conv.id}
            className={`claude-conv-tab ${conv.id === activeId ? 'claude-conv-tab--active' : ''}`}
            onClick={() => switchConversation(conv.id)}
            onDoubleClick={() => {
              setEditingId(conv.id);
              setEditName(conv.name);
            }}
          >
            {editingId === conv.id ? (
              <input
                className="claude-conv-rename-inline"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => e.key === 'Enter' && commitRename()}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="claude-conv-name">{conv.name}</span>
            )}
            {openTabs.length > 1 && (
              <button className="claude-conv-close" onClick={(e) => closeTab(e, conv.id)}>
                &times;
              </button>
            )}
          </div>
        ))}
      </div>

      {showHistory ? (
        <div className="claude-history">
          <div className="claude-history-title">History</div>
          {[...conversations].reverse().map((conv) => (
            <div
              key={conv.id}
              className={`claude-history-item ${conv.id === activeId ? 'claude-history-item--active' : ''}`}
              onClick={() => openFromHistory(conv.id)}
            >
              <div className="claude-history-item-top">
                {editingId === conv.id ? (
                  <input
                    className="claude-conv-rename"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => e.key === 'Enter' && commitRename()}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="claude-history-name">{conv.name}</span>
                )}
                <span className="claude-history-date">{formatDate(conv.createdAt)}</span>
              </div>
              <div className="claude-history-preview">{getPreview(conv)}</div>
              <div className="claude-history-actions">
                <button className="claude-history-action" onClick={(e) => startRename(e, conv)}>
                  rename
                </button>
                <button
                  className="claude-history-action claude-history-action--delete"
                  onClick={(e) => handleDeleteFromHistory(e, conv.id)}
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="claude-messages">
            {messages.length === 0 && (
              <div className="claude-empty">Ask Claude to edit this app...</div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`claude-msg claude-msg-${msg.role}`}>
                <div className="claude-msg-label">
                  {msg.role === 'user' ? 'You' : 'Claude'}
                </div>
                <pre className="claude-msg-text">{msg.text || '...'}</pre>
              </div>
            ))}
            {activity && (
              <div className="claude-activity">
                <span className="pulse-dot" /> {activity}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="claude-input-row">
            <textarea
              className="claude-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Claude to make changes..."
              rows={2}
              disabled={loading}
            />
            <button className="claude-send" onClick={handleSend} disabled={loading || !input.trim()}>
              {loading ? '...' : 'Send'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
