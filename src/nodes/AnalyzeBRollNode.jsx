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
  const [clipCosts, setClipCosts] = useState([]);
  const [totalCost, setTotalCost] = useState(0);
  const [progressCount, setProgressCount] = useState({ done: 0, total: 0 });

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  // Load saved data on mount
  useEffect(() => {
    if (!nodeId) return;
    (async () => {
      try {
        const res = await fetch(`${API}/node-data/load?node_id=${nodeId}`);
        const saved = await res.json();
        if (saved.found && saved.data) {
          if (saved.data.analyses) {
            setAnalyses(saved.data.analyses);
            setStatus('done');
            setProgress(`${saved.data.analyses.length} clips analyzed`);
          }
          if (saved.data.directory) setDirectory(saved.data.directory);
          if (saved.data.clipCosts) {
            setClipCosts(saved.data.clipCosts);
            setTotalCost(saved.data.clipCosts.reduce((sum, c) => sum + c.cost, 0));
          }
          // Restore node output so downstream nodes get the data
          if (saved.data.analyses && saved.data.directory) {
            setNodeOutput(nodeId, { analyses: saved.data.analyses, directory: saved.data.directory });
          }
        }
      } catch (_) {}
    })();
  }, [nodeId]);

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
    setClipCosts([]);
    setTotalCost(0);
    setProgressCount({ done: 0, total: 0 });

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
            setProgressCount({ done: 0, total: data.total });
            setProgress(`Analyzing 0/${data.total} clips...`);
          } else if (data.status === 'analyzing') {
            setProgress(`Analyzing ${data.index + 1}/${data.total}: ${data.filename}`);
          } else if (data.status === 'clip_done') {
            setClipCosts((prev) => [...prev, { filename: data.filename, cost: data.cost, input_tokens: data.input_tokens, output_tokens: data.output_tokens }]);
            setTotalCost((prev) => prev + data.cost);
            setProgressCount((prev) => ({ ...prev, done: data.index + 1 }));
            setProgress(`Analyzed ${data.index + 1}/${progressCount.total}: ${data.filename} — $${data.cost.toFixed(4)}`);
            // Show result immediately
            setAnalyses((prev) => [...(prev || []), data.analysis]);
            setNodeOutput(nodeId, { analyses: [...(analyses || []), data.analysis], directory });
          } else if (data.status === 'done') {
            setAnalyses(data.analyses);
            setNodeOutput(nodeId, { analyses: data.analyses, directory });
            setStatus('done');
            setProgress(`${data.analyses.length} clips analyzed`);
            // Save to DB
            fetch(`${API}/node-data/save`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                node_id: nodeId,
                data: { analyses: data.analyses, directory, clipCosts },
              }),
            }).catch(() => {});
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
            <>
              <span className="status-active"><span className="pulse-dot" /> {progress}</span>
              {progressCount.total > 0 && (
                <div className="syncmerge-progress-bar" style={{ marginTop: 4 }}>
                  <div
                    className="syncmerge-progress-fill"
                    style={{ width: `${(progressCount.done / progressCount.total) * 100}%` }}
                  />
                </div>
              )}
            </>
          )}
          {status === 'done' && <span className="status-done">{progress}</span>}
          {status === 'error' && <span className="status-error">{progress}</span>}
          {totalCost > 0 && (
            <span className="status-hint" style={{ marginLeft: 4 }}>
              Total: ${totalCost.toFixed(4)}
            </span>
          )}
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
            {analyses.map((a, i) => {
              const costInfo = clipCosts.find((c) => c.filename === a.filename);
              return (
                <div key={i} className="analyze-broll-item">
                  <div className="analyze-broll-filename">
                    {a.filename}
                    {costInfo && <span style={{ color: '#6b7280', fontSize: 10, marginLeft: 6 }}>${costInfo.cost.toFixed(4)}</span>}
                  </div>
                  <div className="analyze-broll-desc">{a.description}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
