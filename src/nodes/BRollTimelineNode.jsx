import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';
import BRollPreview from './BRollPreview';

const EFFECTS = {
  main: { id: 'main', name: 'Main Video' },
  broll: { id: 'broll', name: 'B-Roll' },
};

export default function BRollTimelineNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();

  const [videoPath, setVideoPath] = useState(null);
  const [totalDuration, setTotalDuration] = useState(0);
  const [brollDirectory, setBrollDirectory] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [editorData, setEditorData] = useState([]);
  const [selectedActionId, setSelectedActionId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [scaleWidth, setScaleWidth] = useState(100);
  const [renderStatus, setRenderStatus] = useState('idle');
  const [renderPct, setRenderPct] = useState(0);
  const [resultUrl, setResultUrl] = useState(null);
  const [resultPath, setResultPath] = useState(null);
  const [videoWidth, setVideoWidth] = useState(1920);
  const [videoHeight, setVideoHeight] = useState(1080);

  const previewRef = useRef(null);
  const timelineRef = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  // Get source node IDs from edges
  const getSourceData = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.filter((e) => e.target === nodeId);
    let video = null;
    let assignData = null;
    for (const edge of incoming) {
      const data = getNodeOutput(edge.source);
      if (!data) continue;
      if (edge.targetHandle === 'video' && data.savedPath) {
        video = data;
      } else if (data.assignments) {
        assignData = data;
      }
    }
    return { video, assignData };
  }, [getEdges, nodeId]);

  // Listen for upstream data
  useEffect(() => {
    const check = () => {
      const { video, assignData } = getSourceData();
      if (video?.savedPath && video.savedPath !== videoPath) {
        setVideoPath(video.savedPath);
        // Probe duration
        fetch(`http://localhost:8000/serve-video?path=${encodeURIComponent(video.savedPath)}`, { method: 'HEAD' })
          .catch(() => {});
      }
      if (assignData?.assignments && assignData.assignments !== assignments) {
        setAssignments(assignData.assignments);
        setBrollDirectory(assignData.directory);
        buildEditorData(assignData.assignments, assignData.directory);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceData]);

  // Probe video duration and dimensions
  useEffect(() => {
    if (!videoPath) return;
    (async () => {
      try {
        const res = await fetch('http://localhost:8000/waveform?path=' + encodeURIComponent(videoPath) + '&samples=100');
        const data = await res.json();
        if (data.duration) setTotalDuration(data.duration);
      } catch (_) {}
      // Probe dimensions
      try {
        const v = document.createElement('video');
        v.src = `/serve-video?path=${encodeURIComponent(videoPath)}`;
        v.addEventListener('loadedmetadata', () => {
          if (v.videoWidth && v.videoHeight) {
            setVideoWidth(v.videoWidth);
            setVideoHeight(v.videoHeight);
          }
        });
      } catch (_) {}
    })();
  }, [videoPath]);

  // Build editor data from assignments
  const buildEditorData = (assigns, dir) => {
    const brollActions = assigns
      .filter((a) => a.matched_clip || a.clip_filename)
      .map((a, i) => ({
        id: `broll-${i}`,
        start: a.start,
        end: a.end,
        effectId: 'broll',
        _clipFilename: a.matched_clip || a.clip_filename,
        _clipPath: dir ? `${dir}/${a.matched_clip || a.clip_filename}` : '',
        _clipUrl: dir ? `/serve-video?path=${encodeURIComponent(dir + '/' + (a.matched_clip || a.clip_filename))}` : '',
        _clipStartOffset: a.clip_start_offset || 0,
        _suggestion: a.suggestion || '',
      }));

    setEditorData([
      {
        id: 'main-track',
        actions: [],  // main video shown in preview, not as timeline action
      },
      {
        id: 'broll-track',
        actions: brollActions,
      },
    ]);
  };

  // Undo/redo
  const pushUndo = (data) => {
    undoStack.current.push(JSON.stringify(data));
    redoStack.current = [];
    if (undoStack.current.length > 50) undoStack.current.shift();
  };

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    redoStack.current.push(JSON.stringify(editorData));
    const prev = JSON.parse(undoStack.current.pop());
    setEditorData(prev);
  }, [editorData]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    undoStack.current.push(JSON.stringify(editorData));
    const next = JSON.parse(redoStack.current.pop());
    setEditorData(next);
  }, [editorData]);

  // Timeline callbacks
  const onTimelineChange = (newData) => {
    // Preserve custom fields
    const merged = newData.map((row, ri) => ({
      ...row,
      actions: row.actions.map((a) => {
        const prev = editorData[ri]?.actions?.find((p) => p.id === a.id);
        if (prev) {
          return { ...a, _clipFilename: prev._clipFilename, _clipPath: prev._clipPath, _clipUrl: prev._clipUrl, _clipStartOffset: prev._clipStartOffset, _suggestion: prev._suggestion };
        }
        return a;
      }),
    }));
    setEditorData(merged);
  };

  const onClickAction = (e, { action }) => {
    setSelectedActionId(action.id);
  };

  const onActionResizeEnd = ({ action, row, start, end, dir }) => {
    pushUndo(editorData);
    setEditorData((prev) =>
      prev.map((r) => ({
        ...r,
        actions: r.actions.map((a) => (a.id === action.id ? { ...a, start, end } : a)),
      }))
    );
  };

  const onActionMoveEnd = ({ action, row, start, end }) => {
    pushUndo(editorData);
    setEditorData((prev) =>
      prev.map((r) => ({
        ...r,
        actions: r.actions.map((a) => (a.id === action.id ? { ...a, start, end } : a)),
      }))
    );
  };

  const deleteSelected = () => {
    if (!selectedActionId) return;
    pushUndo(editorData);
    setEditorData((prev) =>
      prev.map((r) => ({
        ...r,
        actions: r.actions.filter((a) => a.id !== selectedActionId),
      }))
    );
    setSelectedActionId(null);
  };

  // Get b-roll actions for preview
  const brollActions = useMemo(() => {
    if (!editorData[1]) return [];
    return editorData[1].actions.map((a) => ({
      ...a,
      _clipUrl: a._clipUrl || `/serve-video?path=${encodeURIComponent(a._clipPath)}`,
    }));
  }, [editorData]);

  // Preview callbacks
  const onPreviewTimeUpdate = useCallback((time) => {
    setCurrentTime(time);
    if (timelineRef.current) {
      timelineRef.current.setTime(time);
    }
  }, []);

  const togglePlay = () => {
    const p = previewRef.current;
    if (!p) return;
    if (isPlaying) {
      p.pause();
      setIsPlaying(false);
    } else {
      if (timelineRef.current) {
        const curTime = timelineRef.current.getTime();
        p.seekTo(curTime);
      }
      p.play();
      setIsPlaying(true);
    }
  };

  // Render
  const renderBRoll = useCallback(async () => {
    if (!videoPath || !brollDirectory) return;
    const actions = editorData[1]?.actions || [];
    if (actions.length === 0) return;

    setRenderStatus('rendering');
    setRenderPct(0);
    setResultUrl(null);
    setResultPath(null);

    try {
      const res = await fetch('http://localhost:8000/place-broll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: videoPath,
          broll_directory: brollDirectory,
          assignments: actions.map((a) => ({
            start: a.start,
            end: a.end,
            clip_filename: a._clipFilename,
            clip_start_offset: a._clipStartOffset || 0,
          })),
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
            setResultPath(data.saved_path);
            setNodeOutput(nodeId, { savedPath: data.saved_path });
            setRenderStatus('done');
          } else if (data.status === 'error') {
            throw new Error(data.error);
          }
        }
      }
    } catch (err) {
      console.error('B-roll render failed:', err);
      setRenderStatus('error');
    }
  }, [videoPath, brollDirectory, editorData, nodeId]);

  // Custom action render
  const getActionRender = (action) => {
    if (action.effectId === 'main') return null;
    const dur = action.end - action.start;
    return (
      <div className={`tl-action tl-broll-action ${selectedActionId === action.id ? 'tl-action--sel' : ''}`}>
        <span className="tl-broll-label">
          {action._clipFilename || 'B-Roll'}
          {dur > 0.5 && <span className="tl-broll-dur"> {dur.toFixed(1)}s</span>}
        </span>
      </div>
    );
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  };

  const brollCount = editorData[1]?.actions?.length || 0;
  const hasData = videoPath && brollCount > 0;

  return (
    <>
      <div className="tl-node">
        <Handle type="target" position={Position.Left} id="video" style={{ top: '30%' }} />
        <Handle type="target" position={Position.Left} id="assignments" style={{ top: '70%' }} />

        <div className="tl-header">
          <span className="tl-icon">🎬</span>
          <span>B-Roll Editor</span>
          {hasData && (
            <span className="tl-header-stats">
              {brollCount} clips &middot; {formatTime(totalDuration)}
            </span>
          )}
        </div>

        <div className="tl-body nodrag nopan">
          {!videoPath && <span className="status-hint">Waiting for video + assignments...</span>}
          {videoPath && !brollCount && <span className="status-hint">Waiting for b-roll assignments...</span>}
          {hasData && (
            <button className="btn btn-start" style={{ width: '100%' }} onClick={() => setModalOpen(true)}>
              Open B-Roll Editor
            </button>
          )}
          {resultPath && (
            <div className="status-done" style={{ fontSize: 11, marginTop: 4 }}>
              Saved: {resultPath.split('/').pop()}
            </div>
          )}
        </div>

        <Handle type="source" position={Position.Right} />
      </div>

      {/* Modal editor */}
      {modalOpen && createPortal(
        <div
          className="tl-modal-overlay"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setModalOpen(false);
            else if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
            else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
            else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedActionId) { e.preventDefault(); deleteSelected(); }
          }}
        >
          <div className="tl-modal">
            <div className="tl-modal-header">
              <span>B-Roll Editor</span>
              <span className="tl-modal-stats">
                {brollCount} b-roll clips
              </span>
              <button className="tl-modal-close" onClick={() => setModalOpen(false)}>Close</button>
            </div>

            <div className="tl-modal-body">
              {/* Preview */}
              <div className="tl-modal-preview">
                <BRollPreview
                  ref={previewRef}
                  mainVideoUrl={`/serve-video?path=${encodeURIComponent(videoPath)}`}
                  brollActions={brollActions}
                  totalDuration={totalDuration}
                  onTimeUpdate={onPreviewTimeUpdate}
                  compositionWidth={videoWidth}
                  compositionHeight={videoHeight}
                />
              </div>

              {/* Transport */}
              <div className="tl-transport">
                <button className="tl-transport-btn" onClick={togglePlay}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <span className="tl-timecode">{currentTime.toFixed(2)}s / {totalDuration.toFixed(2)}s</span>
                <button className="tl-transport-btn" onClick={undo} disabled={undoStack.current.length === 0} title="Undo">↩</button>
                <button className="tl-transport-btn" onClick={redo} disabled={redoStack.current.length === 0} title="Redo">↪</button>
                {selectedActionId && (
                  <button className="tl-del-btn" onClick={deleteSelected}>Delete clip</button>
                )}
                <div className="tl-zoom">
                  <button onClick={() => setScaleWidth((w) => Math.max(30, w - 20))}>−</button>
                  <button onClick={() => setScaleWidth((w) => Math.min(2000, w + 20))}>+</button>
                </div>
              </div>

              {/* Timeline */}
              <div className="tl-editor-wrap" style={{ height: 200 }}>
                <Timeline
                  ref={timelineRef}
                  editorData={editorData}
                  effects={EFFECTS}
                  onChange={onTimelineChange}
                  onClickAction={onClickAction}
                  onActionResizeEnd={onActionResizeEnd}
                  onActionMoveEnd={onActionMoveEnd}
                  onClickRow={(e, { row, time }) => {
                    const clickedOnAction = (row.actions || []).some((a) => time >= a.start && time <= a.end);
                    if (!clickedOnAction) setSelectedActionId(null);
                  }}
                  onClickTimeArea={(time) => {
                    if (previewRef.current) previewRef.current.seekTo(time);
                  }}
                  getActionRender={getActionRender}
                  scale={5}
                  scaleWidth={scaleWidth}
                  rowHeight={40}
                  startLeft={10}
                  autoScroll
                  style={{ width: '100%', height: 200 }}
                />
              </div>

              {/* Render */}
              <div className="tl-modal-render-row">
                <button
                  className="btn btn-start tl-render-btn"
                  onClick={renderBRoll}
                  disabled={renderStatus === 'rendering'}
                >
                  {renderStatus === 'rendering' ? `Rendering... ${renderPct}%` : 'Render with B-Roll'}
                </button>
              </div>
              {renderStatus === 'rendering' && renderPct > 0 && (
                <div className="syncmerge-progress-bar">
                  <div className="syncmerge-progress-fill" style={{ width: `${renderPct}%` }} />
                </div>
              )}
              {renderStatus === 'done' && resultPath && (
                <div className="status-done" style={{ textAlign: 'center' }}>
                  Saved to {resultPath.split('/').pop()}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
