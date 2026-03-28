import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, useNodeId, useReactFlow, useViewport } from '@xyflow/react';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';
import GaplessPreview from './GaplessPreview';

const CLIP_EFFECT = { clip: { id: 'clip', name: 'Clip' } };

function WaveformBar({ peaks, fullWidth }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks.length) return;
    // Render at 2px per peak for crisp output
    const w = peaks.length * 2;
    const h = 50;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const mid = h / 2;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';

    for (let i = 0; i < peaks.length; i++) {
      const x = i * 2;
      const barH = peaks[i] * mid * 0.9;
      ctx.fillRect(x, mid - barH, 2, barH * 2);
    }
  }, [peaks]);

  return (
    <canvas
      ref={canvasRef}
      className="tl-waveform-canvas"
      style={{ width: fullWidth }}
    />
  );
}

export default function TimelineEditorNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();
  const { zoom: rfZoom } = useViewport();

  const [status, setStatus] = useState('idle');
  const [segments, setSegments] = useState([]); // original {start, end} from source video
  const [editorData, setEditorData] = useState([]); // timeline library format
  const [videoPath, setVideoPath] = useState(null);
  const [totalDuration, setTotalDuration] = useState(0);
  const [selectedActionId, setSelectedActionId] = useState(null);
  const [renderStatus, setRenderStatus] = useState('idle');
  const [renderPct, setRenderPct] = useState(0);
  const [resultUrl, setResultUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [padding, setPadding] = useState(() => {
    const saved = localStorage.getItem('tl-clip-padding');
    return saved !== null ? parseFloat(saved) : 0;
  });
  const [scaleWidth, setScaleWidth] = useState(100);
  const [waveformPeaks, setWaveformPeaks] = useState([]);
  const [waveformDuration, setWaveformDuration] = useState(0);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const skipOnChange = useRef(false);
  const rawSegmentsRef = useRef([]);
  const processedRef = useRef(null);
  const previewRef = useRef(null);
  const timelineRef = useRef(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  // Convert segments to packed timeline editor data
  const segmentsToEditorData = (segs) => {
    let cursor = 0;
    const actions = segs.map((seg, i) => {
      const dur = seg.end - seg.start;
      const action = {
        id: `clip-${i}`,
        start: cursor,
        end: cursor + dur,
        effectId: 'clip',
        _srcStart: seg.start,
        _srcEnd: seg.end,
        _origSrcStart: seg.start,
        _origSrcEnd: seg.end,
      };
      cursor += dur;
      return action;
    });
    return [{ id: 'track-0', actions }];
  };

  const pushUndo = (data) => {
    undoStack.current.push(JSON.stringify(data));
    redoStack.current = [];
    if (undoStack.current.length > 50) undoStack.current.shift();
  };

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    skipOnChange.current = true;
    redoStack.current.push(JSON.stringify(editorData));
    const prev = JSON.parse(undoStack.current.pop());
    setEditorData(prev);
    setSegments(editorDataToSegments(prev));
  }, [editorData]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    skipOnChange.current = true;
    undoStack.current.push(JSON.stringify(editorData));
    const next = JSON.parse(redoStack.current.pop());
    setEditorData(next);
    setSegments(editorDataToSegments(next));
  }, [editorData]);

  // Convert editor data back to source segments
  const editorDataToSegments = (data) => {
    if (!data || !data[0]) return [];
    return data[0].actions
      .sort((a, b) => a.start - b.start)
      .map((a) => ({
        start: a._srcStart,
        end: a._srcEnd,
      }));
  };

  const applyPadding = (segs, pad, dur) => {
    const padded = segs
      .map((s) => ({
        start: Math.max(0, s.start - pad),
        end: Math.min(dur, s.end + pad),
      }))
      .filter((s) => s.end - s.start > 0.05);
    // Merge overlapping segments
    const merged = [];
    for (const seg of padded) {
      if (merged.length > 0 && seg.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, seg.end);
      } else {
        merged.push({ ...seg });
      }
    }
    return merged;
  };

  const onPaddingChange = (newPad) => {
    pushUndo(editorData);
    setPadding(newPad);
    localStorage.setItem('tl-clip-padding', newPad);
    if (rawSegmentsRef.current.length > 0) {
      const padded = applyPadding(rawSegmentsRef.current, newPad, totalDuration);
      setSegments(padded);
      setEditorData(segmentsToEditorData(padded));
    }
  };

  const detectSilences = useCallback(async (path) => {
    setStatus('detecting');
    setSegments([]);
    setEditorData([]);
    setSelectedActionId(null);
    setVideoPath(path);
    setResultUrl(null);
    setRenderStatus('idle');

    try {
      const res = await fetch('http://localhost:8000/detect-silences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: path }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      rawSegmentsRef.current = data.segments;
      setTotalDuration(data.total_duration);
      const padded = applyPadding(data.segments, padding, data.total_duration);
      setSegments(padded);
      setEditorData(segmentsToEditorData(padded));
      setStatus('ready');

      // Fetch waveform in background
      fetch(`http://localhost:8000/waveform?path=${encodeURIComponent(path)}&samples=2000`)
        .then((r) => r.json())
        .then((wf) => {
          if (wf.peaks) {
            setWaveformPeaks(wf.peaks);
            setWaveformDuration(wf.duration);
          }
        })
        .catch(() => {});
    } catch (err) {
      console.error('Silence detection failed:', err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const check = () => {
      const srcId = getSourceNodeId();
      if (!srcId) return;
      const data = getNodeOutput(srcId);
      if (data?.savedPath && data.savedPath !== processedRef.current) {
        processedRef.current = data.savedPath;
        detectSilences(data.savedPath);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, detectSilences]);

  // Convert packed timeline time to segment index + source time
  const packedTimeToSource = useCallback((packedTime) => {
    const segs = editorDataToSegments(editorData);
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      const dur = segs[i].end - segs[i].start;
      if (packedTime <= acc + dur) {
        const offset = packedTime - acc;
        return { segIdx: i, sourceTime: segs[i].start + offset };
      }
      acc += dur;
    }
    return segs.length > 0 ? { segIdx: 0, sourceTime: segs[0].start } : null;
  }, [editorData]);

  const seekToPackedTime = useCallback((packedTime) => {
    const result = packedTimeToSource(packedTime);
    if (result && previewRef.current) {
      previewRef.current.seekToSegment(result.segIdx, result.sourceTime);
    }
  }, [packedTimeToSource]);

  const togglePlay = () => {
    const p = previewRef.current;
    if (!p) return;
    if (isPlaying) {
      p.pause();
      setIsPlaying(false);
    } else {
      // Seek to current playhead position before playing
      if (timelineRef.current) {
        const curTime = timelineRef.current.getTime();
        seekToPackedTime(curTime);
      }
      p.play();
      setIsPlaying(true);
    }
  };

  const onPreviewTimeUpdate = useCallback((packedTime) => {
    setCurrentTime(packedTime);
    if (timelineRef.current) {
      timelineRef.current.setTime(packedTime);
    }
  }, []);

  // When cursor is dragged on the timeline, seek preview
  const onCursorDragEnd = useCallback((time) => {
    seekToPackedTime(time);
  }, [seekToPackedTime]);

  const onClickTimeArea = useCallback((time) => {
    seekToPackedTime(time);
  }, [seekToPackedTime]);

  // When clicking a clip on the timeline, seek to that segment
  const onClickAction = (e, { action }) => {
    setSelectedActionId(action.id);
    const segs = editorDataToSegments(editorData);
    const idx = segs.findIndex((s) => s.start === action._srcStart);
    if (idx >= 0 && previewRef.current) {
      previewRef.current.seekToSegment(idx);
    }
  };

  // When timeline data changes (drag, resize), update state
  const onTimelineChange = (newData) => {
    if (skipOnChange.current) {
      skipOnChange.current = false;
      return false; // returning false prevents the library from syncing
    }
    // Preserve our custom fields that the library doesn't know about
    const merged = newData.map((row) => ({
      ...row,
      actions: row.actions.map((a) => {
        const prev = editorData[0]?.actions?.find((p) => p.id === a.id);
        if (prev) {
          return { ...a, _srcStart: prev._srcStart, _srcEnd: prev._srcEnd, _origSrcStart: prev._origSrcStart, _origSrcEnd: prev._origSrcEnd };
        }
        return a;
      }),
    }));
    setEditorData(merged);
    setSegments(editorDataToSegments(merged));
  };

  // Repack actions end-to-end with no gaps
  const repackActions = (data) => {
    return data.map((r) => {
      let cursor = 0;
      const sorted = [...r.actions].sort((a, b) => a.start - b.start);
      return {
        ...r,
        actions: sorted.map((a) => {
          const dur = a._srcEnd - a._srcStart;
          const repacked = { ...a, start: cursor, end: cursor + dur };
          cursor += dur;
          return repacked;
        }),
      };
    });
  };

  // Handle resize: update source start/end based on how the user trimmed, then repack
  const onActionResizeEnd = ({ action, row, start, end, dir }) => {
    pushUndo(editorData);
    setEditorData((prev) => {
      const updated = prev.map((r) => ({
        ...r,
        actions: r.actions.map((a) => {
          if (a.id !== action.id) return a;
          const origDur = a._srcEnd - a._srcStart;
          const newDur = end - start;
          const delta = newDur - origDur;
          if (dir === 'left') {
            return { ...a, start, end, _srcStart: a._srcStart - delta };
          } else {
            return { ...a, start, end, _srcEnd: a._srcEnd + delta };
          }
        }),
      }));
      const repacked = repackActions(updated);
      setSegments(editorDataToSegments(repacked));
      return repacked;
    });
  };

  const deleteSelected = () => {
    if (!selectedActionId) return;
    pushUndo(editorData);
    setEditorData((prev) => {
      const filtered = prev.map((r) => ({
        ...r,
        actions: r.actions.filter((a) => a.id !== selectedActionId),
      }));
      const repacked = repackActions(filtered);
      setSegments(editorDataToSegments(repacked));
      return repacked;
    });
    setSelectedActionId(null);
  };

  const totalKept = editorData[0]?.actions?.reduce((sum, a) => sum + (a.end - a.start), 0) || 0;

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  };

  const renderTimeline = useCallback(async () => {
    const segs = editorDataToSegments(editorData);
    if (!videoPath || segs.length === 0) return;
    setRenderStatus('rendering');
    setRenderPct(0);
    setResultUrl(null);

    try {
      const res = await fetch('http://localhost:8000/render-timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: videoPath,
          segments: segs.map((s) => ({ start: s.start, end: s.end })),
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
          if (data.status === 'progress') {
            setRenderPct(data.percent);
          } else if (data.status === 'done') {
            const binary = atob(data.video_b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            setResultUrl(url);
            setNodeOutput(nodeId, { videoBlob: blob, videoUrl: url });
            setRenderStatus('done');
          } else if (data.status === 'error') {
            throw new Error(data.error);
          }
        }
      }
    } catch (err) {
      console.error('Render failed:', err);
      setRenderStatus('error');
    }
  }, [videoPath, editorData, nodeId]);

  // Extract waveform slice for a segment
  const getWaveformSlice = (srcStart, srcEnd) => {
    if (!waveformPeaks.length || waveformDuration <= 0) return [];
    const startIdx = Math.floor((srcStart / waveformDuration) * waveformPeaks.length);
    const endIdx = Math.ceil((srcEnd / waveformDuration) * waveformPeaks.length);
    return waveformPeaks.slice(startIdx, endIdx);
  };

  // Custom clip rendering with waveform
  // Renders the FULL original waveform, offset by how much was trimmed from the left.
  // The clip's overflow:hidden hides anything trimmed from either side.
  const getActionRender = (action) => {
    const dur = action.end - action.start;
    const pxPerSec = scaleWidth / 5; // scale prop is 5

    // Full original waveform
    const fullPeaks = getWaveformSlice(action._origSrcStart, action._origSrcEnd);
    const origDur = action._origSrcEnd - action._origSrcStart;
    const fullPxWidth = origDur * pxPerSec;

    // How much was trimmed from the left (in seconds → pixels)
    const leftTrimmed = action._srcStart - action._origSrcStart;
    const offsetPx = -(leftTrimmed * pxPerSec);

    return (
      <div
        className={`tl-action ${selectedActionId === action.id ? 'tl-action--sel' : ''}`}
      >
        {fullPeaks.length > 0 && (
          <div className="tl-waveform-offset" style={{ left: offsetPx }}>
            <WaveformBar peaks={fullPeaks} fullWidth={fullPxWidth} />
          </div>
        )}
        {dur > 0.5 && <span className="tl-action-label">{formatTime(dur)}</span>}
      </div>
    );
  };

  return (
    <div
      className="tl-node"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.code === 'Space') {
          e.preventDefault();
          e.stopPropagation();
          togglePlay();
        } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          undo();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedActionId) {
          e.preventDefault();
          e.stopPropagation();
          deleteSelected();
        } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          redo();
        }
      }}
    >
      <Handle type="target" position={Position.Left} />

      <div className="tl-header">
        <span className="tl-icon">✂️</span>
        <span>Timeline Editor</span>
        {status === 'ready' && (
          <span className="tl-header-stats">
            {editorData[0]?.actions?.length || 0} clips &middot; {formatTime(totalKept)}
          </span>
        )}
      </div>

      <div className="tl-body nodrag nopan">
        {status === 'idle' && (
          <div className="tl-idle">
            <span className="status-hint">Waiting for video...</span>
            <input
              className="save-node-dir"
              type="text"
              placeholder="Or paste video file path + Enter"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target.value) detectSilences(e.target.value);
              }}
            />
          </div>
        )}

        {status === 'detecting' && (
          <div className="status-active" style={{ padding: 12 }}>
            <span className="pulse-dot" /> Analyzing speech with Deepgram...
          </div>
        )}

        {status === 'error' && (
          <div className="status-error" style={{ padding: 12 }}>Detection failed</div>
        )}

        {status === 'ready' && (
          <>
            {/* Video preview */}
            <div className="tl-preview">
              <GaplessPreview
                ref={previewRef}
                videoUrl={`http://localhost:8000/serve-video?path=${encodeURIComponent(videoPath)}`}
                segments={editorDataToSegments(editorData)}
                onTimeUpdate={onPreviewTimeUpdate}
              />
              <div className="tl-transport">
                <button className="tl-transport-btn" onClick={togglePlay}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <span className="tl-timecode">{currentTime.toFixed(2)}s / {totalKept.toFixed(2)}s</span>
                {selectedActionId && (
                  <button className="tl-del-btn" onClick={deleteSelected}>
                    Delete clip
                  </button>
                )}
                <div className="tl-zoom">
                  <button onClick={() => setScaleWidth((w) => Math.max(30, w - 20))}>−</button>
                  <button onClick={() => setScaleWidth((w) => Math.min(400, w + 20))}>+</button>
                </div>
              </div>
            </div>

            {/* Padding control */}
            <div className="tl-padding">
              <label>Clip padding</label>
              <input
                type="range"
                min="-0.5"
                max="1"
                step="0.05"
                value={padding}
                onChange={(e) => onPaddingChange(parseFloat(e.target.value))}
              />
              <span>{padding.toFixed(2)}s</span>
            </div>

            {/* Timeline */}
            <div
              className="tl-editor-wrap nowheel"
              onWheel={(e) => {
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  e.stopPropagation();

                  const wrap = e.currentTarget;
                  const rect = wrap.getBoundingClientRect();
                  const cursorX = e.clientX - rect.left;
                  const scrollLeft = wrap.scrollLeft || 0;
                  const posInTrack = scrollLeft + cursorX;

                  // Time under cursor at current scale
                  const oldPxPerSec = scaleWidth / 5;
                  const timeAtCursor = posInTrack / oldPxPerSec;

                  const delta = e.deltaY > 0 ? -15 : 15;
                  const newScaleWidth = Math.max(30, Math.min(400, scaleWidth + delta));
                  setScaleWidth(newScaleWidth);

                  // After zoom, adjust scroll so timeAtCursor stays under cursor
                  const newPxPerSec = newScaleWidth / 5;
                  const newPosInTrack = timeAtCursor * newPxPerSec;
                  const newScrollLeft = newPosInTrack - cursorX;

                  requestAnimationFrame(() => {
                    if (timelineRef.current) {
                      timelineRef.current.setScrollLeft(Math.max(0, newScrollLeft));
                    }
                  });
                }
              }}
            >
              <div style={{
                width: `${100 * rfZoom}%`,
                height: 100 * rfZoom,
                transform: `scale(${1 / rfZoom})`,
                transformOrigin: 'top left',
              }}>
              <Timeline
                ref={timelineRef}
                editorData={editorData}
                effects={CLIP_EFFECT}
                onChange={onTimelineChange}
                onClickAction={onClickAction}
                onActionResizeEnd={onActionResizeEnd}
                onCursorDragEnd={onCursorDragEnd}
                onClickTimeArea={onClickTimeArea}
                getActionRender={getActionRender}
                scale={5}
                scaleWidth={scaleWidth}
                rowHeight={50}
                startLeft={10}
                autoScroll
                style={{ width: '100%', height: '100%' }}
              />
              </div>
            </div>

            {/* Render */}
            <button
              className="btn btn-start tl-render-btn"
              onClick={renderTimeline}
              disabled={renderStatus === 'rendering' || (editorData[0]?.actions?.length || 0) === 0}
            >
              {renderStatus === 'rendering' ? `Rendering... ${renderPct}%` : 'Render Video'}
            </button>

            {renderStatus === 'rendering' && (
              <div className="syncmerge-progress-bar">
                <div className="syncmerge-progress-fill" style={{ width: `${renderPct}%` }} />
              </div>
            )}

            {renderStatus === 'done' && resultUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="status-done">Render complete</span>
                <a href={resultUrl} download="timeline_render.mp4" className="btn-download">
                  Download
                </a>
              </div>
            )}

            {renderStatus === 'error' && (
              <span className="status-error">Render failed</span>
            )}
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
