import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, subscribe } from '../store';

export default function TranscriptNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();

  const [status, setStatus] = useState('idle'); // idle | transcribing | done | error
  const [transcript, setTranscript] = useState('');
  const processedBlobRef = useRef(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  const transcribe = useCallback(async (blob) => {
    setStatus('transcribing');
    setTranscript('');

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');

    try {
      const res = await fetch('http://localhost:8000/transcribe', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const data = await res.json();
      setTranscript(data.transcript || '(No speech detected)');
      setStatus('done');
    } catch (err) {
      console.error('Transcription failed:', err);
      setTranscript(`Error: ${err.message}`);
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
        transcribe(data.videoBlob);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, transcribe]);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(transcript);
  }, [transcript]);

  return (
    <div className="transcript-node">
      <Handle type="target" position={Position.Left} />

      <div className="transcript-node-header">
        <div className="transcript-node-icon">T</div>
        Get Transcript
      </div>

      <div className="transcript-node-body">
        <div className="transcript-status">
          {status === 'idle' && (
            <span className="status-hint">Waiting for video...</span>
          )}
          {status === 'transcribing' && (
            <span className="status-active">
              <span className="pulse-dot" /> Transcribing...
            </span>
          )}
          {status === 'done' && <span className="status-done">Transcription complete</span>}
          {status === 'error' && <span className="status-error">Error</span>}
        </div>

        {transcript && (
          <div className="transcript-output">
            <p>{transcript}</p>
          </div>
        )}

        {transcript && status === 'done' && (
          <div className="transcript-controls">
            <button className="btn btn-copy" onClick={copyToClipboard}>
              Copy
            </button>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
