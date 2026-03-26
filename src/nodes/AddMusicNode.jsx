import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, subscribe } from '../store';

const DB_NAME = 'boost-workflow';
const STORE_NAME = 'music-files';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveMusicFile(nodeId, file) {
  const db = await openDB();
  const buf = await file.arrayBuffer();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(
    { name: file.name, type: file.type, buffer: buf },
    nodeId,
  );
}

async function loadMusicFile(nodeId) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(nodeId);
    req.onsuccess = () => {
      const data = req.result;
      if (data) {
        resolve(new File([data.buffer], data.name, { type: data.type }));
      } else {
        resolve(null);
      }
    };
    req.onerror = () => resolve(null);
  });
}

export default function AddMusicNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();

  const [status, setStatus] = useState('idle');
  const [videoUrl, setVideoUrl] = useState(null);
  const [musicFile, setMusicFile] = useState(null);
  const [volume, setVolume] = useState(0.15);
  const processedBlobRef = useRef(null);
  const pendingVideoRef = useRef(null);

  // Restore persisted music file on mount
  useEffect(() => {
    loadMusicFile(nodeId).then((file) => {
      if (file) setMusicFile(file);
    });
  }, [nodeId]);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  const addMusic = useCallback(async (videoBlob, music, vol) => {
    setStatus('processing');
    setVideoUrl(null);

    const formData = new FormData();
    formData.append('file', videoBlob, 'video.mp4');
    formData.append('music', music);
    formData.append('volume', vol.toString());

    try {
      const res = await fetch('http://localhost:8000/add-music', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const resultBlob = await res.blob();
      setVideoUrl(URL.createObjectURL(resultBlob));
      setStatus('done');
    } catch (err) {
      console.error('Add music failed:', err);
      setStatus('error');
    }
  }, []);

  // Watch for upstream video and auto-trigger if music is already selected
  useEffect(() => {
    const check = () => {
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.videoBlob && data.videoBlob !== processedBlobRef.current) {
        pendingVideoRef.current = data.videoBlob;
        if (musicFile) {
          processedBlobRef.current = data.videoBlob;
          addMusic(data.videoBlob, musicFile, volume);
        }
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, addMusic, musicFile, volume]);

  const handleMusicSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMusicFile(file);
    saveMusicFile(nodeId, file);
    // If we already have a pending video, kick off processing
    if (pendingVideoRef.current) {
      processedBlobRef.current = pendingVideoRef.current;
      addMusic(pendingVideoRef.current, file, volume);
    }
  }, [addMusic, volume, nodeId]);

  return (
    <div className="music-node">
      <Handle type="target" position={Position.Left} />

      <div className="music-node-header">
        <div className="music-node-icon">♫</div>
        Add Background Music
      </div>

      <div className="music-node-body">
        <label className="music-file-label">
          {musicFile ? musicFile.name : 'Choose audio file...'}
          <input
            type="file"
            accept="audio/*"
            onChange={handleMusicSelect}
            style={{ display: 'none' }}
          />
        </label>

        <div className="music-volume">
          <span>Volume: {Math.round(volume * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
          />
        </div>

        <div className="transcript-status">
          {status === 'idle' && !musicFile && !pendingVideoRef.current && (
            <span className="status-hint">Select a music file</span>
          )}
          {status === 'idle' && !musicFile && pendingVideoRef.current && (
            <span className="status-hint">Video ready — select a music file to continue</span>
          )}
          {status === 'idle' && musicFile && (
            <span className="status-ready">Waiting for video...</span>
          )}
          {status === 'processing' && (
            <span className="status-active">
              <span className="pulse-dot" /> Adding music...
            </span>
          )}
          {status === 'done' && <span className="status-done">Music added</span>}
          {status === 'error' && <span className="status-error">Error</span>}
        </div>

        {videoUrl && (
          <div className="music-result">
            <video src={videoUrl} controls style={{ width: '100%', borderRadius: 6 }} />
            <a className="btn btn-download" href={videoUrl} download="with_music.mp4">
              ⬇ Download
            </a>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
