import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, subscribe } from '../store';

export default function SaveVideoNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();

  const [status, setStatus] = useState('idle');
  const [savedPath, setSavedPath] = useState(null);
  const [savedFiles, setSavedFiles] = useState([]);
  const [directory, setDirectory] = useState('');
  const [playingVideo, setPlayingVideo] = useState(null);
  const processedBlobRef = useRef(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

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
      setStatus('done');
    } catch (err) {
      console.error('Save failed:', err);
      setStatus('error');
    }
  }, [directory]);

  // Auto-trigger when upstream video blob changes
  useEffect(() => {
    const check = () => {
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.videoBlob && data.videoBlob !== processedBlobRef.current) {
        processedBlobRef.current = data.videoBlob;
        saveVideo(data.videoBlob);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, saveVideo]);

  return (
    <div className="save-node">
      <Handle type="target" position={Position.Left} />

      <div className="save-node-header">
        <div className="save-node-icon">💾</div>
        Save Video
      </div>

      <div className="save-node-body">
        <div className="save-node-dir-row">
          <input
            className="save-node-dir"
            type="text"
            placeholder="Directory (default: ./output)"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
          />
          <button
            className="save-node-browse-btn"
            title="Browse for folder"
            onClick={async () => {
              try {
                const res = await fetch('http://localhost:8000/pick-folder');
                const data = await res.json();
                if (data.path) setDirectory(data.path);
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
            {savedFiles.slice(0, 5).map((f) => (
              <div
                key={f.filename}
                className="save-node-file save-node-file-clickable"
                onClick={() => setPlayingVideo(f)}
              >
                {f.filename}
              </div>
            ))}
            {savedFiles.length > 5 && (
              <div className="save-node-file">...and {savedFiles.length - 5} more</div>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
