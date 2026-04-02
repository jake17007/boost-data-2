import { useState, useEffect, useCallback } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';
import { useNodeEnabled } from './useNodeEnabled';

const API = 'http://localhost:8000';

function formatTime(sec) {
  if (!sec && sec !== 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MatchBRollNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();
  const { enabled, toggle: toggleEnabled } = useNodeEnabled(nodeId);

  const [analyses, setAnalyses] = useState(null);
  const [brollDirectory, setBrollDirectory] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [clipFilenames, setClipFilenames] = useState([]);
  const [status, setStatus] = useState('idle');
  const [assignments, setAssignments] = useState([]);

  // Two inputs: analyses (from AnalyzeBRollNode) and suggestions (from BRollNode)
  useEffect(() => {
    const check = () => {
      const edges = getEdges().filter((e) => e.target === nodeId);
      for (const edge of edges) {
        const data = getNodeOutput(edge.source);
        if (!data) continue;
        if (edge.targetHandle === 'analyses' && data.analyses) {
          setAnalyses(data.analyses);
          setClipFilenames(data.analyses.map((a) => a.filename));
          if (data.directory) setBrollDirectory(data.directory);
        }
        if (edge.targetHandle === 'suggestions' && data.brollSuggestions) {
          setSuggestions(data.brollSuggestions);
        }
      }
    };
    check();
    return subscribe(() => check());
  }, [getEdges, nodeId]);

  const match = useCallback(async () => {
    if (!analyses || !suggestions) return;
    setStatus('matching');

    try {
      const res = await fetch(`${API}/match-broll-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions, analyses }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setAssignments(data.assignments);
      setNodeOutput(nodeId, { assignments: data.assignments, directory: brollDirectory });
      setStatus('done');
    } catch (err) {
      console.error('Match clips failed:', err);
      setStatus('error');
    }
  }, [nodeId, analyses, suggestions, brollDirectory]);

  const updateAssignment = (idx, field, value) => {
    const updated = assignments.map((a, i) => (i === idx ? { ...a, [field]: value } : a));
    setAssignments(updated);
    setNodeOutput(nodeId, { assignments: updated, directory: brollDirectory });
  };

  const removeAssignment = (idx) => {
    const updated = assignments.filter((_, i) => i !== idx);
    setAssignments(updated);
    setNodeOutput(nodeId, { assignments: updated, directory: brollDirectory });
  };

  return (
    <div className={`match-broll-node ${!enabled ? 'node-disabled' : ''}`}>
      <div className="match-broll-handle-row" style={{ top: '35%' }}>
        <Handle type="target" position={Position.Left} id="analyses" style={{ top: 0, position: 'relative' }} />
        <span className="match-broll-handle-label">Analyses</span>
      </div>
      <div className="match-broll-handle-row" style={{ top: '55%' }}>
        <Handle type="target" position={Position.Left} id="suggestions" style={{ top: 0, position: 'relative' }} />
        <span className="match-broll-handle-label">Suggestions</span>
      </div>

      <div className="match-broll-header">
        <span className="broll-node-icon">🔗</span>
        Match B-Roll
        <button className={`node-power-btn ${enabled ? 'node-power-on' : 'node-power-off'}`} onClick={toggleEnabled}>⏻</button>
      </div>

      <div className="match-broll-body nodrag nopan">
        <div className="broll-placer-inputs">
          <div className="broll-placer-input-status">
            <span className={`broll-placer-dot ${analyses ? 'dot-connected' : ''}`} />
            <span className="broll-placer-input-label">Analyses</span>
          </div>
          <div className="broll-placer-input-status">
            <span className={`broll-placer-dot ${suggestions ? 'dot-connected' : ''}`} />
            <span className="broll-placer-input-label">Suggestions</span>
          </div>
        </div>

        <div className="transcript-status">
          {status === 'matching' && (
            <span className="status-active"><span className="pulse-dot" /> Claude is matching...</span>
          )}
          {status === 'done' && <span className="status-done">{assignments.length} matched</span>}
          {status === 'error' && <span className="status-error">Matching failed</span>}
        </div>

        <button
          className="btn btn-start"
          style={{ width: '100%' }}
          onClick={match}
          disabled={!analyses || !suggestions || status === 'matching'}
        >
          {status === 'matching' ? 'Matching...' : status === 'done' ? 'Re-Match' : 'Match Clips'}
        </button>

        {assignments.length > 0 && (
          <div className="match-broll-assignments nowheel">
            {assignments.map((a, i) => (
              <div key={i} className="broll-placer-assignment-row">
                <div className="broll-placer-assignment-time">
                  {formatTime(a.start)} – {formatTime(a.end)}
                </div>
                <div className="broll-placer-assignment-suggestion">{a.suggestion}</div>
                <div className="broll-placer-assignment-controls">
                  <select
                    className="broll-placer-clip-select nowheel"
                    value={a.matched_clip || ''}
                    onChange={(e) => updateAssignment(i, 'matched_clip', e.target.value || null)}
                  >
                    <option value="">— none —</option>
                    {clipFilenames.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                  <div className="broll-placer-offset-row">
                    <label>Offset:</label>
                    <input
                      type="number"
                      className="broll-placer-offset-input"
                      value={a.clip_start_offset || 0}
                      min={0}
                      step={0.5}
                      onChange={(e) => updateAssignment(i, 'clip_start_offset', parseFloat(e.target.value) || 0)}
                    />
                    <span className="broll-placer-offset-unit">s</span>
                  </div>
                  {a.reason && <div className="broll-placer-reason">{a.reason}</div>}
                </div>
                <button className="broll-placer-remove-btn" onClick={() => removeAssignment(i)} title="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
