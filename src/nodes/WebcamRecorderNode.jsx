import { useState, useRef, useCallback } from 'react';
import { Handle, Position, useNodeId } from '@xyflow/react';
import { setNodeOutput } from '../store';

export default function WebcamRecorderNode() {
  const nodeId = useNodeId();
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      setIsStreaming(true);
    } catch (err) {
      console.error('Camera access denied:', err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setIsRecording(false);
    clearInterval(timerRef.current);
    setDuration(0);
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;

    chunksRef.current = [];
    setRecordedUrl(null);
    setNodeOutput(nodeId, { videoBlob: null, videoUrl: null });

    const mr = new MediaRecorder(streamRef.current, {
      mimeType: 'video/webm',
    });
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setRecordedUrl(url);
      setNodeOutput(nodeId, { videoBlob: blob, videoUrl: url });
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setIsRecording(true);
    setDuration(0);
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
  }, [nodeId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    clearInterval(timerRef.current);
  }, []);

  const formatTime = (s) => {
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  };

  return (
    <div className="webcam-node">
      <Handle type="target" position={Position.Left} />

      <div className="webcam-node-header">
        <div className="webcam-node-dot" />
        Webcam Recorder
      </div>

      <div className="webcam-node-body">
        <div className="webcam-preview">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: '100%',
              borderRadius: 6,
              background: '#000',
              display: isStreaming ? 'block' : 'none',
            }}
          />
          {!isStreaming && (
            <div className="webcam-placeholder">
              <span>📷</span>
              <p>Camera off</p>
            </div>
          )}
        </div>

        {isRecording && (
          <div className="webcam-timer">
            <span className="rec-dot" /> REC {formatTime(duration)}
          </div>
        )}

        <div className="webcam-controls">
          {!isStreaming ? (
            <button className="btn btn-start" onClick={startCamera}>
              Start Camera
            </button>
          ) : (
            <>
              {!isRecording ? (
                <button className="btn btn-record" onClick={startRecording}>
                  ⏺ Record
                </button>
              ) : (
                <button className="btn btn-stop-rec" onClick={stopRecording}>
                  ⏹ Stop
                </button>
              )}
              <button className="btn btn-off" onClick={stopCamera}>
                Turn Off
              </button>
            </>
          )}
        </div>

        {recordedUrl && (
          <div className="webcam-result">
            <video src={recordedUrl} controls style={{ width: '100%', borderRadius: 6 }} />
            <a className="btn btn-download" href={recordedUrl} download="recording.webm">
              ⬇ Download
            </a>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
