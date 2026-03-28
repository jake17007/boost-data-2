import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { getNodeOutput, setNodeOutput, subscribe, isNodeDisabled } from '../store';
import { useNodeEnabled } from './useNodeEnabled';

export default function TimestampTranscriptNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();
  const { enabled, toggle: toggleEnabled } = useNodeEnabled(nodeId);

  const [status, setStatus] = useState('idle');
  const [lines, setLines] = useState([]);
  const [fullText, setFullText] = useState('');
  const [savedPath, setSavedPath] = useState(null);
  const [saveDir, setSaveDir] = useState(() => {
    return localStorage.getItem(`transcript-dir-${nodeId}`) || '';
  });
  const processedRef = useRef(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  const transcribe = useCallback(async (videoPath) => {
    setStatus('transcribing');
    setLines([]);
    setFullText('');
    setSavedPath(null);

    try {
      const res = await fetch('http://localhost:8000/transcribe-timestamps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: videoPath }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setLines(data.lines);
      setFullText(data.full_text);
      setNodeOutput(nodeId, { transcriptLines: data.lines, fullText: data.full_text });
      setStatus('done');
    } catch (err) {
      console.error('Transcription failed:', err);
      setStatus('error');
    }
  }, [nodeId]);

  useEffect(() => {
    const check = () => {
      if (isNodeDisabled(nodeId)) return;
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.savedPath && data.savedPath !== processedRef.current) {
        processedRef.current = data.savedPath;
        transcribe(data.savedPath);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, transcribe]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const saveTranscript = async () => {
    const content = lines
      .map((l) => `[${formatTime(l.start)} - ${formatTime(l.end)}] ${l.text}`)
      .join('\n');

    try {
      const res = await fetch('http://localhost:8000/save-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          filename: `transcript_${Date.now()}.txt`,
          directory: saveDir,
        }),
      });
      const data = await res.json();
      setSavedPath(data.path);
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  return (
    <div className={`tsnode ${!enabled ? 'node-disabled' : ''}`}>
      <Handle type="target" position={Position.Left} />

      <div className="tsnode-header">
        <span className="tsnode-icon">📝</span>
        Timestamped Transcript
        <button className={`node-power-btn ${enabled ? 'node-power-on' : 'node-power-off'}`} onClick={toggleEnabled}>⏻</button>
      </div>

      <div className="tsnode-body nodrag nopan">
        <div className="transcript-status">
          {status === 'idle' && <span className="status-hint">Waiting for video...</span>}
          {status === 'transcribing' && (
            <span className="status-active">
              <span className="pulse-dot" /> Transcribing with Deepgram...
            </span>
          )}
          {status === 'done' && <span className="status-done">{lines.length} segments</span>}
          {status === 'error' && <span className="status-error">Transcription failed</span>}
        </div>

        {lines.length > 0 && (
          <>
            <div className="tsnode-lines nowheel">
              {lines.map((l, i) => (
                <div key={i} className="tsnode-line">
                  <span className="tsnode-time">{formatTime(l.start)}</span>
                  <span className="tsnode-text">{l.text}</span>
                </div>
              ))}
            </div>

            <div className="save-node-dir-row">
              <input
                className="save-node-dir"
                type="text"
                placeholder="Save directory"
                value={saveDir}
                onChange={(e) => {
                  setSaveDir(e.target.value);
                  localStorage.setItem(`transcript-dir-${nodeId}`, e.target.value);
                }}
              />
              <button className="btn btn-start" onClick={saveTranscript}>
                Save
              </button>
            </div>

            {savedPath && <div className="save-node-path">{savedPath}</div>}
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
