import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe, isNodeDisabled } from '../store';
import { useNodeEnabled } from './useNodeEnabled';

export default function SaveVideoNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();
  const { enabled, toggle: toggleEnabled } = useNodeEnabled(nodeId);

  const [status, setStatus] = useState('idle');
  const [savedPath, setSavedPath] = useState(null);
  const [savedFiles, setSavedFiles] = useState([]);
  const [directory, setDirectory] = useState(() => {
    return localStorage.getItem(`save-node-dir-${nodeId}`) || '';
  });
  const [playingVideo, setPlayingVideo] = useState(null);
  const processedBlobRef = useRef(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  // Restore last output to store on mount (so downstream nodes have data on refresh)
  useEffect(() => {
    if (!nodeId) return;
    (async () => {
      try {
        const res = await fetch(`http://localhost:8000/node-data/load?node_id=${nodeId}`);
        const saved = await res.json();
        if (saved.found && saved.data?.savedPath) {
          setSavedPath(saved.data.savedPath);
          processedBlobRef.current = saved.data.savedPath;
          setNodeOutput(nodeId, { savedPath: saved.data.savedPath });
        }
      } catch (_) {}
    })();
  }, [nodeId]);

  // Load saved files on mount
  useEffect(() => {
    fetch(`http://localhost:8000/saved-videos${directory ? `?directory=${encodeURIComponent(directory)}` : ''}`)
      .then((r) => r.json())
      .then(setSavedFiles)
      .catch(() => {});
  }, [directory, savedPath]);

  const saveVideo = useCallback(async (blob) => {
    setStatus('saving');
    setSavedPath(null);

    const formData = new FormData();
    formData.append('file', blob, 'video.mp4');
    if (directory) formData.append('directory', directory);

    try {
      const res = await fetch('http://localhost:8000/save-video', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSavedPath(data.path);
      setNodeOutput(nodeId, { savedPath: data.path });
      setStatus('done');
      // Persist to DB so downstream nodes have data on refresh
      fetch('http://localhost:8000/node-data/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, data: { savedPath: data.path } }),
      }).catch(() => {});
    } catch (err) {
      console.error('Save failed:', err);
      setStatus('error');
    }
  }, [directory]);

  // Auto-trigger when upstream video blob changes
  useEffect(() => {
    const check = () => {
      if (isNodeDisabled(nodeId)) return;
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.videoBlob && data.videoBlob !== processedBlobRef.current) {
        processedBlobRef.current = data.videoBlob;
        saveVideo(data.videoBlob);
      } else if (data?.savedPath && data.savedPath !== processedBlobRef.current) {
        // Upstream already saved the file — just update our state and refresh the list
        processedBlobRef.current = data.savedPath;
        setSavedPath(data.savedPath);
        setNodeOutput(nodeId, { savedPath: data.savedPath });
        fetch('http://localhost:8000/node-data/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ node_id: nodeId, data: { savedPath: data.savedPath } }),
        }).catch(() => {});
        // Refresh file list
        if (directory) {
          fetch(`http://localhost:8000/saved-videos?directory=${encodeURIComponent(directory)}`)
            .then((r) => r.json())
            .then((d) => { if (d.videos) setVideos(d.videos); })
            .catch(() => {});
        }
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, saveVideo]);

  return (
    <div className={`save-node ${!enabled ? 'node-disabled' : ''}`}>
      <Handle type="target" position={Position.Left} />

      <div className="save-node-header">
        <div className="save-node-icon">💾</div>
        Save Video
        <button className={`node-power-btn ${enabled ? 'node-power-on' : 'node-power-off'}`} onClick={toggleEnabled}>⏻</button>
      </div>

      <div className="save-node-body">
        <div className="save-node-dir-row">
          <input
            className="save-node-dir"
            type="text"
            placeholder="Directory (default: ./output)"
            value={directory}
            onChange={(e) => {
              setDirectory(e.target.value);
              localStorage.setItem(`save-node-dir-${nodeId}`, e.target.value);
            }}
          />
          <button
            className="save-node-browse-btn"
            title="Browse for folder"
            onClick={async () => {
              try {
                const res = await fetch('http://localhost:8000/pick-folder');
                const data = await res.json();
                if (data.path) {
                  setDirectory(data.path);
                  localStorage.setItem(`save-node-dir-${nodeId}`, data.path);
                }
              } catch {
                // request failed
              }
            }}
          >
            📁
          </button>
        </div>

        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Waiting for video...</span>
          )}
          {status === 'saving' && (
            <span className="status-active">
              <span className="pulse-dot" /> Saving...
            </span>
          )}
          {status === 'done' && <span className="status-done">Saved</span>}
          {status === 'error' && <span className="status-error">Error saving</span>}
        </div>

        {savedPath && (
          <div className="save-node-path">{savedPath}</div>
        )}

        {playingVideo && (
          <div className="save-node-player">
            <video
              src={`http://localhost:8000/serve-video?path=${encodeURIComponent(playingVideo.path)}`}
              controls
              autoPlay
            />
            <button
              className="save-node-player-close"
              onClick={() => setPlayingVideo(null)}
            >
              Close
            </button>
          </div>
        )}

        {savedFiles.length > 0 && (
          <div className="save-node-files">
            <div className="save-node-files-title">Saved videos</div>
            {savedFiles.map((f) => (
              <div key={f.filename} className="save-node-file-row">
                <div
                  className="save-node-file save-node-file-clickable"
                  onClick={() => setPlayingVideo(f)}
                >
                  {f.filename}
                </div>
                <button
                  className="save-node-send-btn"
                  title="Send to next node"
                  onClick={() => {
                    setSavedPath(f.path);
                    setNodeOutput(nodeId, { savedPath: f.path });
                  }}
                >
                  ➤
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
