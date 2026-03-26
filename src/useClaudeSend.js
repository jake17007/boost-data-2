import { useState, useCallback, useRef } from 'react';

function toolLabel(name, input) {
  switch (name) {
    case 'Read': return `Reading ${input?.file_path?.split('/').pop() || 'file'}`;
    case 'Write': return `Writing ${input?.file_path?.split('/').pop() || 'file'}`;
    case 'Edit': return `Editing ${input?.file_path?.split('/').pop() || 'file'}`;
    case 'Glob': return `Searching for ${input?.pattern || 'files'}`;
    case 'Grep': return `Searching for "${input?.pattern || '...'}"`;
    case 'Bash': return 'Running command';
    default: return `Using ${name}`;
  }
}

export default function useClaudeSend({ onSessionId, onText, onActivity, onDone, onError }) {
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const send = useCallback(async (message, sessionId) => {
    if (loading) return;
    setLoading(true);
    onActivity?.(null);

    const controller = new AbortController();
    abortRef.current = controller;

    let fullText = '';

    try {
      const res = await fetch('http://localhost:8000/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversation_id: sessionId }),
        signal: controller.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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

            if (data.session_id) {
              onSessionId?.(data.session_id);
            }

            if (data.type === 'assistant' && data.message?.content) {
              for (const block of data.message.content) {
                if (block.type === 'text') {
                  fullText += block.text;
                  onActivity?.(null);
                } else if (block.type === 'tool_use') {
                  onActivity?.(toolLabel(block.name, block.input));
                }
              }
              onText?.(fullText);
            }

            if (data.type === 'result' && data.result) {
              fullText = data.result;
              onActivity?.(null);
              onText?.(fullText);
            }
          } catch {
            // skip
          }
        }
      }

      if (!fullText) fullText = '(No response received)';
      onDone?.(fullText);
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError?.(err.message);
      }
    } finally {
      setLoading(false);
      onActivity?.(null);
      abortRef.current = null;
    }
  }, [loading, onSessionId, onText, onActivity, onDone, onError]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, loading, abort };
}
