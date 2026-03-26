import { useState, useCallback, useMemo, useEffect } from 'react';

const API = 'http://localhost:8000';

export default function useConversations() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Load conversations from backend on mount
  useEffect(() => {
    fetch(`${API}/conversations`)
      .then((r) => r.json())
      .then((convos) => {
        if (!convos.length) {
          // Create a first conversation
          return fetch(`${API}/conversations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Conversation 1' }),
          })
            .then((r) => r.json())
            .then((c) => [c]);
        }
        return convos;
      })
      .then((convos) => {
        setConversations(convos);
        setActiveId(convos[0]?.id || null);
        setLoaded(true);
      });
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || conversations[0] || null,
    [conversations, activeId],
  );

  const createConversation = useCallback(async (name) => {
    const res = await fetch(`${API}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || `Conversation ${conversations.length + 1}` }),
    });
    const conv = await res.json();
    setConversations((prev) => [...prev, conv]);
    setActiveId(conv.id);
    return conv;
  }, [conversations.length]);

  const switchConversation = useCallback((id) => {
    setActiveId(id);
  }, []);

  const renameConversation = useCallback(async (id, name) => {
    await fetch(`${API}/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const deleteConversation = useCallback(async (id) => {
    await fetch(`${API}/conversations/${id}`, { method: 'DELETE' });
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (!next.length) {
        // Will create a new one
        fetch(`${API}/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Conversation 1' }),
        })
          .then((r) => r.json())
          .then((c) => {
            setConversations([c]);
            setActiveId(c.id);
          });
        return [];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }, [activeId]);

  const updateConversation = useCallback(async (id, patch) => {
    // Update local state immediately for responsiveness
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    // Persist to backend
    fetch(`${API}/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }, []);

  return {
    conversations,
    activeId,
    activeConversation,
    loaded,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
    updateConversation,
  };
}
