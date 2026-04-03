import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe, isNodeDisabled } from '../store';
import { useNodeEnabled } from './useNodeEnabled';
import ReactMarkdown from 'react-markdown';

const DEFAULT_PROMPT = `You are a professional video editor. Below is a timestamped transcript of a video. For each timestamped segment, suggest ONE specific b-roll shot that would visually support what's being said.

Be specific and practical — describe shots that could realistically be filmed or sourced from stock footage. Include the type of shot (close-up, wide, over-the-shoulder, screen recording, etc.).

Format your response as a list with one suggestion per segment, using this exact format:
[START - END] B-roll: <your suggestion>

Transcript:
{{transcript}}`;

export default function BRollNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();
  const { enabled, toggle: toggleEnabled } = useNodeEnabled(nodeId);

  const [status, setStatus] = useState('idle');
  const [suggestions, setSuggestions] = useState([]);
  const [rawText, setRawText] = useState('');
  const [savedPath, setSavedPath] = useState(null);
  const [saveDir, setSaveDir] = useState(() => {
    return localStorage.getItem(`broll-dir-${nodeId}`) || '';
  });
  const [prompt, setPrompt] = useState(() => {
    return localStorage.getItem(`broll-prompt-${nodeId}`) || DEFAULT_PROMPT;
  });
  const [showPreview, setShowPreview] = useState(false);
  const [transcriptLines, setTranscriptLines] = useState(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  const formatTime = (sec) => {
    if (!sec) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Build the transcript text from lines
  const buildTranscriptText = (lines) => {
    if (!lines || lines.length === 0) return '(no transcript available)';
    return lines
      .map((l) => `[${l.start.toFixed(1)}s - ${l.end.toFixed(1)}s] ${l.text}`)
      .join('\n');
  };

  // Resolve the prompt with variables filled in
  const resolvePrompt = (template, lines) => {
    return template.replace(/\{\{transcript\}\}/g, buildTranscriptText(lines));
  };

  const onPromptChange = (val) => {
    setPrompt(val);
    localStorage.setItem(`broll-prompt-${nodeId}`, val);
  };

  // Load saved data on mount
  useEffect(() => {
    if (!nodeId) return;
    (async () => {
      try {
        const res = await fetch(`http://localhost:8000/node-data/load?node_id=${nodeId}`);
        const saved = await res.json();
        if (saved.found && saved.data) {
          if (saved.data.suggestions) {
            setSuggestions(saved.data.suggestions);
            setStatus('done');
          }
          if (saved.data.rawText) setRawText(saved.data.rawText);
          if (saved.data.suggestions) {
            setNodeOutput(nodeId, { brollSuggestions: saved.data.suggestions, brollRaw: saved.data.rawText || '' });
          }
        }
      } catch (_) {}
    })();
  }, [nodeId]);

  // Listen for upstream transcript (but don't auto-generate)
  useEffect(() => {
    const check = () => {
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.transcriptLines) {
        setTranscriptLines(data.transcriptLines);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId]);

  const generate = useCallback(async () => {
    if (!transcriptLines) return;
    setStatus('thinking');
    setSuggestions([]);
    setRawText('');
    setSavedPath(null);

    const resolvedPrompt = resolvePrompt(prompt, transcriptLines);

    try {
      const res = await fetch('http://localhost:8000/suggest-broll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript_lines: transcriptLines,
          custom_prompt: resolvedPrompt,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSuggestions(data.suggestions);
      setRawText(data.raw);
      setNodeOutput(nodeId, { brollSuggestions: data.suggestions, brollRaw: data.raw });
      setStatus('done');
      // Save to DB
      fetch('http://localhost:8000/node-data/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: nodeId,
          data: { suggestions: data.suggestions, rawText: data.raw },
        }),
      }).catch(() => {});
    } catch (err) {
      console.error('B-roll suggestions failed:', err);
      setStatus('error');
    }
  }, [nodeId, transcriptLines, prompt]);

  const saveSuggestions = async () => {
    try {
      const res = await fetch('http://localhost:8000/save-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: rawText,
          filename: `broll_suggestions_${Date.now()}.txt`,
          directory: saveDir,
        }),
      });
      const data = await res.json();
      setSavedPath(data.path);
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  const previewText = resolvePrompt(prompt, transcriptLines);

  return (
    <div className={`broll-node ${!enabled ? 'node-disabled' : ''}`}>
      <Handle type="target" position={Position.Left} />

      <div className="broll-node-header">
        <span className="broll-node-icon">🎬</span>
        B-Roll Suggestions
        <button className={`node-power-btn ${enabled ? 'node-power-on' : 'node-power-off'}`} onClick={toggleEnabled}>⏻</button>
      </div>

      <div className="broll-node-body nodrag nopan">
        {/* Prompt editor */}
        <div className="broll-prompt-section">
          <div className="broll-prompt-header">
            <span className="broll-prompt-label">Prompt</span>
            <span className="broll-prompt-var-hint">Use {'{{transcript}}'} for transcript</span>
          </div>
          <textarea
            className="broll-prompt-editor nowheel"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            rows={6}
          />
          <div className="broll-prompt-actions">
            <button
              className="broll-preview-btn"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? 'Hide preview' : 'Preview'}
            </button>
            <button
              className="broll-reset-btn"
              onClick={() => onPromptChange(DEFAULT_PROMPT)}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="broll-preview nowheel">
            <div className="broll-preview-label">Resolved prompt preview</div>
            <pre className="broll-preview-text">{previewText}</pre>
          </div>
        )}

        {/* Status + generate */}
        <div className="transcript-status">
          {!transcriptLines && <span className="status-hint">Waiting for transcript...</span>}
          {transcriptLines && status === 'idle' && (
            <span className="status-done">Transcript ready ({transcriptLines.length} segments)</span>
          )}
          {status === 'thinking' && (
            <span className="status-active">
              <span className="pulse-dot" /> Claude is thinking...
            </span>
          )}
          {status === 'done' && <span className="status-done">{suggestions.length} suggestions</span>}
          {status === 'error' && <span className="status-error">Failed</span>}
        </div>

        <button
          className="btn btn-start"
          style={{ width: '100%' }}
          onClick={generate}
          disabled={!transcriptLines || status === 'thinking'}
        >
          {status === 'thinking' ? 'Generating...' : 'Generate B-Roll Suggestions'}
        </button>

        {/* Results */}
        {suggestions.length > 0 && (
          <>
            <div className="broll-list broll-markdown nowheel">
              <ReactMarkdown>{rawText}</ReactMarkdown>
            </div>

            <div className="save-node-dir-row">
              <input
                className="save-node-dir"
                type="text"
                placeholder="Save directory"
                value={saveDir}
                onChange={(e) => {
                  setSaveDir(e.target.value);
                  localStorage.setItem(`broll-dir-${nodeId}`, e.target.value);
                }}
              />
              <button className="btn btn-start" onClick={saveSuggestions}>
                Save
              </button>
            </div>

            {savedPath && <div className="save-node-path">{savedPath}</div>}
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
