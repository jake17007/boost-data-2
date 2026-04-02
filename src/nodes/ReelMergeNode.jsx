import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';

function useTimer() {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null);

  const start = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsed(0);
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (startTimeRef.current) {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }
  }, []);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const formatted = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  return { formatted, start, stop };
}

export default function ReelMergeNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();

  const [status, setStatus] = useState('idle');
  const [phase, setPhase] = useState('');
  const [encodePct, setEncodePct] = useState(0);
  const [resultUrl, setResultUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const processedRef = useRef(null);
  const { formatted: elapsed, start: startTimer, stop: stopTimer } = useTimer();

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  const syncAndMerge = useCallback(async (videos, directory) => {
    setStatus('processing');
    setPhase('sync');
    setEncodePct(0);
    setResultUrl(null);
    setErrorMsg('');
    startTimer();

    try {
      const res = await fetch('http://localhost:8000/sync-merge-reel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: videos.map((v) => v.path),
          directory,
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

          if (data.phase === 'sync' && data.status === 'started') {
            setPhase('sync');
          } else if (data.phase === 'sync' && data.status === 'done') {
            setPhase('sync-done');
          } else if (data.phase === 'sync' && data.status === 'error') {
            throw new Error(data.error);
          } else if (data.phase === 'encode' && data.status === 'started') {
            setPhase('encode');
            setEncodePct(0);
          } else if (data.phase === 'encode' && data.status === 'progress') {
            setEncodePct(data.percent);
          } else if (data.phase === 'encode' && data.status === 'done') {
            const binary = atob(data.video_b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            setResultUrl(url);
            setNodeOutput(nodeId, { videoBlob: blob, videoUrl: url });
            stopTimer();
            setStatus('done');
          } else if (data.phase === 'encode' && data.status === 'error') {
            throw new Error(data.error);
          }
        }
      }
    } catch (err) {
      console.error('Reel merge failed:', err);
      stopTimer();
      setStatus('error');
      setErrorMsg(err.message || 'Failed');
    }
  }, [nodeId, startTimer, stopTimer]);

  useEffect(() => {
    const check = () => {
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.videos && data.videos.length >= 2 && data.videos !== processedRef.current) {
        processedRef.current = data.videos;
        syncAndMerge(data.videos, data.directory);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, syncAndMerge]);

  return (
    <div className="syncmerge-node">
      <Handle type="target" position={Position.Left} />

      <div className="syncmerge-node-header">
        <div className="syncmerge-node-icon">📱</div>
        Reel Merge (9:16)
      </div>

      <div className="syncmerge-node-body">
        <div className="syncmerge-description">
          Syncs DJI + screen recording, stacks vertically (screen top, DJI bottom), DJI audio
        </div>

        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Waiting for videos...</span>
          )}
          {status === 'processing' && phase === 'sync' && (
            <span className="status-active">
              <span className="pulse-dot" /> Syncing audio... ({elapsed})
            </span>
          )}
          {status === 'processing' && phase === 'sync-done' && (
            <span className="status-active">
              <span className="pulse-dot" /> Audio synced, starting encode... ({elapsed})
            </span>
          )}
          {status === 'processing' && phase === 'encode' && encodePct === 0 && (
            <span className="status-active">
              <span className="pulse-dot" /> Merging video... ({elapsed})
            </span>
          )}
          {status === 'processing' && phase === 'encode' && encodePct > 0 && (
            <span className="status-active">
              <span className="pulse-dot" /> Encoding reel... {encodePct}% ({elapsed})
            </span>
          )}
          {status === 'done' && (
            <span className="status-done">Reel ready ({elapsed})</span>
          )}
          {status === 'error' && (
            <span className="status-error">{errorMsg || 'Error'} ({elapsed})</span>
          )}
        </div>

        {status === 'processing' && phase === 'encode' && encodePct > 0 && (
          <div className="syncmerge-progress-bar">
            <div className="syncmerge-progress-fill" style={{ width: `${encodePct}%` }} />
          </div>
        )}

        {resultUrl && (
          <div className="syncmerge-result">
            <video
              src={resultUrl}
              controls
              style={{ width: '100%', maxHeight: 300, borderRadius: 6, background: '#000', objectFit: 'contain' }}
            />
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
