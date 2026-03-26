import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';

export default function AddCaptionsNode() {
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

  const addCaptions = useCallback(async (blob) => {
    setStatus('processing');
    setVideoUrl(null);

    const formData = new FormData();
    formData.append('file', blob, 'video.mp4');

    try {
      const res = await fetch('http://localhost:8000/add-captions', {
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
      console.error('Add captions failed:', err);
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
        addCaptions(data.videoBlob);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, addCaptions]);

  return (
    <div className="captions-node">
      <Handle type="target" position={Position.Left} />

      <div className="captions-node-header">
        <div className="captions-node-icon">CC</div>
        Add Captions
      </div>

      <div className="captions-node-body">
        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Waiting for video...</span>
          )}
          {status === 'processing' && (
            <span className="status-active">
              <span className="pulse-dot" /> Adding captions...
            </span>
          )}
          {status === 'done' && <span className="status-done">Captions added</span>}
          {status === 'error' && <span className="status-error">Error</span>}
        </div>

        {videoUrl && (
          <div className="captions-result">
            <video src={videoUrl} controls style={{ width: '100%', borderRadius: 6 }} />
            <a className="btn btn-download" href={videoUrl} download="captioned.mp4">
              ⬇ Download
            </a>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
