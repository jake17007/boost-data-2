import { useState, useRef, useCallback, useEffect } from 'react';

export default function ClaudePanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activity]);

  const updateLastAssistant = (text) => {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = { role: 'assistant', text };
      return copy;
    });
  };

  const toolLabel = (name, input) => {
    switch (name) {
      case 'Read': return `Reading ${input?.file_path?.split('/').pop() || 'file'}`;
      case 'Write': return `Writing ${input?.file_path?.split('/').pop() || 'file'}`;
      case 'Edit': return `Editing ${input?.file_path?.split('/').pop() || 'file'}`;
      case 'Glob': return `Searching for ${input?.pattern || 'files'}`;
      case 'Grep': return `Searching for "${input?.pattern || '...'}"`;
      case 'Bash': return `Running command`;
      default: return `Using ${name}`;
    }
  };

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setLoading(true);
    setActivity(null);
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }]);

    try {
      const res = await fetch('http://localhost:8000/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, conversation_id: conversationId }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const raw = line.startsWith('data: ') ? line.slice(6) : line;
          if (!raw || raw === '[DONE]') continue;

          try {
            const data = JSON.parse(raw);

            if (data.session_id && !conversationId) {
              setConversationId(data.session_id);
            }

            if (data.type === 'assistant' && data.message?.content) {
              for (const block of data.message.content) {
                if (block.type === 'text') {
                  fullText += block.text;
                  setActivity(null);
                } else if (block.type === 'tool_use') {
                  setActivity(toolLabel(block.name, block.input));
                }
              }
              updateLastAssistant(fullText);
            }

            if (data.type === 'result' && data.result) {
              fullText = data.result;
              setActivity(null);
              updateLastAssistant(fullText);
            }
          } catch {
            // skip
          }
        }
      }

      if (!fullText) {
        updateLastAssistant('(No response received)');
      }
    } catch (err) {
      updateLastAssistant(`Error: ${err.message}`);
    } finally {
      setLoading(false);
      setActivity(null);
    }
  }, [input, loading, conversationId]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

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
        <span>Claude Code</span>
        <button className="claude-close" onClick={() => setOpen(false)}>
          &times;
        </button>
      </div>

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
        <button className="claude-send" onClick={send} disabled={loading || !input.trim()}>
          {loading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
