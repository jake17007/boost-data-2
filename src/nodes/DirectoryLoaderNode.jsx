import { useState, useCallback } from 'react';
import { Handle, Position, useNodeId } from '@xyflow/react';
import { setNodeOutput } from '../store';

export default function DirectoryLoaderNode() {
  const nodeId = useNodeId();

  const [directory, setDirectory] = useState(() => {
    return localStorage.getItem(`dirloader-dir-${nodeId}`) || '';
  });
  const [videos, setVideos] = useState([]);
  const [status, setStatus] = useState('idle');
  const [playingVideo, setPlayingVideo] = useState(null);

  const loadVideos = useCallback(async (dir) => {
    if (!dir) return;
    setStatus('loading');
    try {
      const res = await fetch(
        `http://localhost:8000/list-videos?directory=${encodeURIComponent(dir)}`
      );
      if (!res.ok) throw new Error(await res.text());
      const files = await res.json();
      setVideos(files);
      setStatus('done');

      // Put all video paths into the node output so downstream nodes can use them
      setNodeOutput(nodeId, { videos: files, directory: dir });
    } catch (err) {
      console.error('Failed to load videos:', err);
      setStatus('error');
    }
  }, [nodeId]);

  return (
    <div className="dirloader-node">
      <div className="dirloader-node-header">
        <div className="dirloader-node-icon">📂</div>
        Load Videos
      </div>

      <div className="dirloader-node-body">
        <div className="save-node-dir-row">
          <input
            className="save-node-dir"
            type="text"
            placeholder="Path to video directory"
            value={directory}
            onChange={(e) => {
              setDirectory(e.target.value);
              localStorage.setItem(`dirloader-dir-${nodeId}`, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') loadVideos(directory);
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
                  localStorage.setItem(`dirloader-dir-${nodeId}`, data.path);
                  loadVideos(data.path);
                }
              } catch {
                // request failed
              }
            }}
          >
            📁
          </button>
        </div>

        <button
          className="btn btn-start"
          style={{ width: '100%' }}
          onClick={() => loadVideos(directory)}
          disabled={!directory}
        >
          Load Videos
        </button>

        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Select a directory...</span>
          )}
          {status === 'loading' && (
            <span className="status-active">
              <span className="pulse-dot" /> Scanning...
            </span>
          )}
          {status === 'done' && (
            <span className="status-done">
              Found {videos.length} video{videos.length !== 1 ? 's' : ''}
            </span>
          )}
          {status === 'error' && (
            <span className="status-error">Error loading directory</span>
          )}
        </div>

        {videos.length > 0 && (
          <div className="save-node-files">
            <div className="save-node-files-title">Videos</div>
            {videos.map((f) => (
              <div
                key={f.filename}
                className="save-node-file save-node-file-clickable"
                onClick={() =>
                  setPlayingVideo(playingVideo?.path === f.path ? null : f)
                }
              >
                {f.filename}
              </div>
            ))}
          </div>
        )}

        {playingVideo && (
          <div className="save-node-player">
            <video
              src={`http://localhost:8000/serve-video?path=${encodeURIComponent(playingVideo.path)}`}
              controls
              autoPlay
              style={{ width: '100%', borderRadius: 6 }}
            />
            <button
              className="save-node-player-close"
              onClick={() => setPlayingVideo(null)}
            >
              Close
            </button>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
