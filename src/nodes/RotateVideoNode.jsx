import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe, isNodeDisabled } from '../store';
import { useNodeEnabled } from './useNodeEnabled';

export default function RotateVideoNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();
  const { enabled, toggle: toggleEnabled } = useNodeEnabled(nodeId);

  const [status, setStatus] = useState('idle');
  const [resultUrl, setResultUrl] = useState(null);
  const processedBlobRef = useRef(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  const rotateVideo = useCallback(async (blob) => {
    setStatus('processing');
    setResultUrl(null);

    const formData = new FormData();
    formData.append('file', blob, 'video.mp4');

    try {
      const res = await fetch('http://localhost:8000/rotate-video', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());

      const rotatedBlob = await res.blob();
      const url = URL.createObjectURL(rotatedBlob);
      setResultUrl(url);
      setNodeOutput(nodeId, { videoBlob: rotatedBlob, videoUrl: url });
      setStatus('done');
    } catch (err) {
      console.error('Rotate failed:', err);
      setStatus('error');
    }
  }, [nodeId]);

  useEffect(() => {
    const check = async () => {
      if (isNodeDisabled(nodeId)) return;
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);

      if (data?.videoBlob && data.videoBlob !== processedBlobRef.current) {
        processedBlobRef.current = data.videoBlob;
        rotateVideo(data.videoBlob);
      } else if (data?.savedPath && data.savedPath !== processedBlobRef.current) {
        // Fetch the file from the server and rotate it
        processedBlobRef.current = data.savedPath;
        try {
          const res = await fetch(`http://localhost:8000/serve-video?path=${encodeURIComponent(data.savedPath)}`);
          const blob = await res.blob();
          rotateVideo(blob);
        } catch (err) {
          console.error('Failed to fetch video for rotation:', err);
          setStatus('error');
        }
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, rotateVideo]);

  return (
    <div className={`rotate-node ${!enabled ? 'node-disabled' : ''}`}>
      <Handle type="target" position={Position.Left} />

      <div className="rotate-node-header">
        <div className="rotate-node-icon">🔄</div>
        Rotate 90° CW
        <button className={`node-power-btn ${enabled ? 'node-power-on' : 'node-power-off'}`} onClick={toggleEnabled}>⏻</button>
      </div>

      <div className="rotate-node-body">
        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Waiting for video...</span>
          )}
          {status === 'processing' && (
            <span className="status-active">
              <span className="pulse-dot" /> Rotating...
            </span>
          )}
          {status === 'done' && <span className="status-done">Rotated</span>}
          {status === 'error' && <span className="status-error">Error</span>}
        </div>

        {resultUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <video
              src={resultUrl}
              controls
              style={{ width: '100%', borderRadius: 6, background: '#000' }}
            />
            <a href={resultUrl} download="rotated.mp4" className="btn-download">
              Download
            </a>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
