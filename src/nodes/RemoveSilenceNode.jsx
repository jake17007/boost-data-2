import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';

export default function RemoveSilenceNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();

  const [status, setStatus] = useState('idle');
  const [videoUrl, setVideoUrl] = useState(null);
  const processedBlobRef = useRef(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  const removeSilence = useCallback(async (blob) => {
    setStatus('processing');
    setVideoUrl(null);

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');

    try {
      const res = await fetch('http://localhost:8000/remove-silence', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const resultBlob = await res.blob();
      const url = URL.createObjectURL(resultBlob);
      setVideoUrl(url);
      setNodeOutput(nodeId, { videoBlob: resultBlob, videoUrl: url });
      setStatus('done');
    } catch (err) {
      console.error('Remove silence failed:', err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const check = () => {
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.videoBlob && data.videoBlob !== processedBlobRef.current) {
        processedBlobRef.current = data.videoBlob;
        removeSilence(data.videoBlob);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, removeSilence]);

  return (
    <div className="silence-node">
      <Handle type="target" position={Position.Left} />

      <div className="silence-node-header">
        <div className="silence-node-icon">🔇</div>
        Remove Silences
      </div>

      <div className="silence-node-body">
        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Waiting for video...</span>
          )}
          {status === 'processing' && (
            <span className="status-active">
              <span className="pulse-dot" /> Removing silences...
            </span>
          )}
          {status === 'done' && <span className="status-done">Silences removed</span>}
          {status === 'error' && <span className="status-error">Error</span>}
        </div>

        {videoUrl && (
          <div className="silence-result">
            <video src={videoUrl} controls style={{ width: '100%', borderRadius: 6 }} />
            <a className="btn btn-download" href={videoUrl} download="no_silence.mp4">
              ⬇ Download
            </a>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
