import { useState, useCallback } from 'react';
import { Handle, Position, useNodeId } from '@xyflow/react';
import { setNodeOutput } from '../store';

export default function LoadVideoNode() {
  const nodeId = useNodeId();

  const [filePath, setFilePath] = useState(() => {
    return localStorage.getItem(`loadvideo-path-${nodeId}`) || '';
  });
  const [status, setStatus] = useState('idle');

  const loadVideo = useCallback(
    async (path) => {
      if (!path) return;
      setStatus('loading');
      try {
        const res = await fetch(
          `http://localhost:8000/serve-video?path=${encodeURIComponent(path)}`
        );
        if (!res.ok) throw new Error(await res.text());
        setStatus('done');
        setNodeOutput(nodeId, { savedPath: path });
      } catch (err) {
        console.error('Failed to load video:', err);
        setStatus('error');
      }
    },
    [nodeId]
  );

  const browseForFile = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8000/pick-file');
      const data = await res.json();
      if (data.path) {
        setFilePath(data.path);
        localStorage.setItem(`loadvideo-path-${nodeId}`, data.path);
        loadVideo(data.path);
      }
    } catch {
      // request failed
    }
  }, [nodeId, loadVideo]);

  return (
    <div className="dirloader-node">
      <div className="dirloader-node-header">
        <div className="dirloader-node-icon">🎬</div>
        Load Video
      </div>

      <div className="dirloader-node-body">
        <div className="save-node-dir-row">
          <input
            className="save-node-dir"
            type="text"
            placeholder="Path to video file"
            value={filePath}
            onChange={(e) => {
              setFilePath(e.target.value);
              localStorage.setItem(`loadvideo-path-${nodeId}`, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') loadVideo(filePath);
            }}
          />
          <button
            className="save-node-browse-btn"
            title="Browse for folder"
            onClick={browseForFile}
          >
            📁
          </button>
        </div>

        <button
          className="btn btn-start"
          style={{ width: '100%' }}
          onClick={() => loadVideo(filePath)}
          disabled={!filePath}
        >
          Load Video
        </button>

        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Enter a video file path...</span>
          )}
          {status === 'loading' && (
            <span className="status-active">
              <span className="pulse-dot" /> Checking...
            </span>
          )}
          {status === 'done' && (
            <span className="status-done">Video loaded</span>
          )}
          {status === 'error' && (
            <span className="status-error">Error loading video</span>
          )}
        </div>

        {status === 'done' && (
          <div className="save-node-player">
            <video
              src={`http://localhost:8000/serve-video?path=${encodeURIComponent(filePath)}`}
              controls
              style={{ width: '100%', borderRadius: 6 }}
            />
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
