import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, subscribe } from '../store';

export default function TimeLapseNode() {
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

  const createTimeLapse = useCallback(async (blob) => {
    setStatus('processing');
    setVideoUrl(null);

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');

    try {
      const res = await fetch('http://localhost:8000/timelapse', {
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
      console.error('Timelapse failed:', err);
      setStatus('error');
    }
  }, []);

  // Auto-trigger when upstream video blob changes
  useEffect(() => {
    const check = () => {
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.videoBlob && data.videoBlob !== processedBlobRef.current) {
        processedBlobRef.current = data.videoBlob;
        createTimeLapse(data.videoBlob);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, createTimeLapse]);

  return (
    <div className="timelapse-node">
      <Handle type="target" position={Position.Left} />

      <div className="timelapse-node-header">
        <div className="timelapse-node-icon">⏩</div>
        Time Lapse (15s)
      </div>

      <div className="timelapse-node-body">
        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Waiting for video...</span>
          )}
          {status === 'processing' && (
            <span className="status-active">
              <span className="pulse-dot" /> Creating time lapse...
            </span>
          )}
          {status === 'done' && <span className="status-done">Time lapse ready</span>}
          {status === 'error' && <span className="status-error">Error creating time lapse</span>}
        </div>

        {videoUrl && (
          <div className="timelapse-result">
            <video src={videoUrl} controls style={{ width: '100%', borderRadius: 6 }} />
            <a className="btn btn-download" href={videoUrl} download="timelapse.mp4">
              ⬇ Download
            </a>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
