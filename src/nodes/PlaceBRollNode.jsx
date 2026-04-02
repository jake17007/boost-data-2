import { useState, useEffect, useCallback } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';
import { useNodeEnabled } from './useNodeEnabled';

const API = 'http://localhost:8000';

export default function PlaceBRollNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();
  const { enabled, toggle: toggleEnabled } = useNodeEnabled(nodeId);

  const [videoPath, setVideoPath] = useState(null);
  const [assignments, setAssignments] = useState(null);
  const [brollDirectory, setBrollDirectory] = useState(null);
  const [status, setStatus] = useState('idle');
  const [renderPct, setRenderPct] = useState(0);
  const [resultPath, setResultPath] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Two inputs: video (from SaveVideoNode) and assignments (from MatchBRollNode)
  useEffect(() => {
    const check = () => {
      const edges = getEdges().filter((e) => e.target === nodeId);
      for (const edge of edges) {
        const data = getNodeOutput(edge.source);
        if (!data) continue;
        if (edge.targetHandle === 'video' && data.savedPath) {
          setVideoPath(data.savedPath);
        }
        if (edge.targetHandle === 'assignments' && data.assignments) {
          setAssignments(data.assignments);
          if (data.directory) setBrollDirectory(data.directory);
        }
      }
    };
    check();
    return subscribe(() => check());
  }, [getEdges, nodeId]);

  const render = useCallback(async () => {
    if (!videoPath || !assignments || !brollDirectory) return;
    const validAssignments = assignments.filter((a) => a.matched_clip);
    if (validAssignments.length === 0) return;

    setStatus('rendering');
    setRenderPct(0);
    setResultPath(null);
    setErrorMsg('');

    try {
      const res = await fetch(`${API}/place-broll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: videoPath,
          broll_directory: brollDirectory,
          assignments: validAssignments.map((a) => ({
            start: a.start,
            end: a.end,
            clip_filename: a.matched_clip,
            clip_start_offset: a.clip_start_offset || 0,
          })),
        }),
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

          if (data.status === 'progress') {
            setRenderPct(data.percent);
          } else if (data.status === 'done') {
            setResultPath(data.saved_path);
            setNodeOutput(nodeId, {
              savedPath: data.saved_path,
              videoUrl: `${API}/serve-video?path=${encodeURIComponent(data.saved_path)}`,
            });
            setStatus('done');
          } else if (data.status === 'error') {
            throw new Error(data.error);
          }
        }
      }
    } catch (err) {
      console.error('B-roll render failed:', err);
      setStatus('error');
      setErrorMsg(err.message || 'Render failed');
    }
  }, [nodeId, videoPath, assignments, brollDirectory]);

  const validCount = assignments ? assignments.filter((a) => a.matched_clip).length : 0;

  return (
    <div className={`place-broll-node ${!enabled ? 'node-disabled' : ''}`}>
      <div className="place-broll-handle-row" style={{ top: '35%' }}>
        <Handle type="target" position={Position.Left} id="video" style={{ top: 0, position: 'relative' }} />
        <span className="match-broll-handle-label">Video</span>
      </div>
      <div className="place-broll-handle-row" style={{ top: '55%' }}>
        <Handle type="target" position={Position.Left} id="assignments" style={{ top: 0, position: 'relative' }} />
        <span className="match-broll-handle-label">Assignments</span>
      </div>

      <div className="place-broll-header">
        <span className="broll-node-icon">🎞️</span>
        Place B-Roll
        <button className={`node-power-btn ${enabled ? 'node-power-on' : 'node-power-off'}`} onClick={toggleEnabled}>⏻</button>
      </div>

      <div className="place-broll-body nodrag nopan">
        <div className="broll-placer-inputs">
          <div className="broll-placer-input-status">
            <span className={`broll-placer-dot ${videoPath ? 'dot-connected' : ''}`} />
            <span className="broll-placer-input-label">Video</span>
          </div>
          <div className="broll-placer-input-status">
            <span className={`broll-placer-dot ${assignments ? 'dot-connected' : ''}`} />
            <span className="broll-placer-input-label">Assignments ({validCount})</span>
          </div>
        </div>

        <button
          className="btn btn-start"
          style={{ width: '100%' }}
          onClick={render}
          disabled={!videoPath || !assignments || validCount === 0 || status === 'rendering'}
        >
          {status === 'rendering' ? 'Rendering...' : 'Place B-Roll & Render'}
        </button>

        {status === 'rendering' && (
          <>
            <div className="syncmerge-progress-bar">
              <div className="syncmerge-progress-fill" style={{ width: `${renderPct}%` }} />
            </div>
            <div className="transcript-status">
              <span className="status-active"><span className="pulse-dot" /> Encoding {renderPct}%</span>
            </div>
          </>
        )}

        {status === 'done' && resultPath && (
          <div className="place-broll-result">
            <div className="transcript-status"><span className="status-done">Done!</span></div>
            <video
              src={`${API}/serve-video?path=${encodeURIComponent(resultPath)}`}
              controls
              className="place-broll-video nowheel"
            />
            <div className="save-node-path">{resultPath}</div>
          </div>
        )}

        {status === 'error' && (
          <div className="transcript-status">
            <span className="status-error">{errorMsg || 'Render failed'}</span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
