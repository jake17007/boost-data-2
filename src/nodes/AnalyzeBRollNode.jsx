import { useState, useEffect, useCallback } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';
import { useNodeEnabled } from './useNodeEnabled';

const API = 'http://localhost:8000';

export default function AnalyzeBRollNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();
  const { enabled, toggle: toggleEnabled } = useNodeEnabled(nodeId);

  const [clips, setClips] = useState(null);
  const [directory, setDirectory] = useState(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [analyses, setAnalyses] = useState(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  useEffect(() => {
    const check = () => {
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.videos) setClips(data.videos);
      if (data?.directory) setDirectory(data.directory);
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId]);

  const analyze = useCallback(async () => {
    if (!directory) return;
    setStatus('analyzing');
    setProgress('Starting...');
    setAnalyses(null);

    try {
      const res = await fetch(`${API}/analyze-broll-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (data.status === 'started') {
            setProgress(`Analyzing 0/${data.total} clips...`);
          } else if (data.status === 'analyzing') {
            setProgress(`Analyzing ${data.index + 1}/${data.total || '?'}: ${data.filename}`);
          } else if (data.status === 'done') {
            setAnalyses(data.analyses);
            setNodeOutput(nodeId, { analyses: data.analyses, directory });
            setStatus('done');
            setProgress(`${data.analyses.length} clips analyzed`);
          }
        }
      }
    } catch (err) {
      console.error('Analyze clips failed:', err);
      setStatus('error');
      setProgress(err.message || 'Analysis failed');
    }
  }, [nodeId, directory]);

  return (
    <div className={`analyze-broll-node ${!enabled ? 'node-disabled' : ''}`}>
      <Handle type="target" position={Position.Left} />

      <div className="analyze-broll-header">
        <span className="broll-node-icon">🔍</span>
        Analyze B-Roll
        <button className={`node-power-btn ${enabled ? 'node-power-on' : 'node-power-off'}`} onClick={toggleEnabled}>⏻</button>
      </div>

      <div className="analyze-broll-body nodrag nopan">
        <div className="transcript-status">
          {!clips && <span className="status-hint">Waiting for clips...</span>}
          {clips && status === 'idle' && (
            <span className="status-done">{clips.length} clips ready</span>
          )}
          {status === 'analyzing' && (
            <span className="status-active"><span className="pulse-dot" /> {progress}</span>
          )}
          {status === 'done' && <span className="status-done">{progress}</span>}
          {status === 'error' && <span className="status-error">{progress}</span>}
        </div>

        <button
          className="btn btn-start"
          style={{ width: '100%' }}
          onClick={analyze}
          disabled={!clips || status === 'analyzing'}
        >
          {status === 'analyzing' ? 'Analyzing...' : status === 'done' ? 'Re-Analyze' : 'Analyze Clips'}
        </button>

        {analyses && (
          <div className="analyze-broll-list nowheel">
            {analyses.map((a, i) => (
              <div key={i} className="analyze-broll-item">
                <div className="analyze-broll-filename">{a.filename}</div>
                <div className="analyze-broll-desc">{a.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
