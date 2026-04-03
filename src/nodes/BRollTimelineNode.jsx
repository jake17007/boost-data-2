import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';
import BRollPreview from './BRollPreview';
import WaveformBar from './WaveformBar';
import ClipThumbnail from './ClipThumbnail';

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
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [marquee, setMarquee] = useState(null);
  const marqueeRef = useRef(null);
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
  const [brollVolume, setBrollVolume] = useState(0.15);
  const [waveformPeaks, setWaveformPeaks] = useState([]);
  const [waveformDuration, setWaveformDuration] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);

  const previewRef = useRef(null);
  const timelineRef = useRef(null);
  const scrubRaf = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const processedBlobRef = useRef(null);
  const hasSavedData = useRef(false);
  const loadedFromDb = useRef(false);
  const videoPathRef = useRef(null);
  const assignmentsRef = useRef(null);
  const editorDataRef = useRef(editorData);
  editorDataRef.current = editorData;

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

  // Load saved state on mount
  useEffect(() => {
    if (!nodeId) return;
    (async () => {
      try {
        const res = await fetch(`http://localhost:8000/node-data/load?node_id=${nodeId}`);
        const saved = await res.json();
        if (saved.found && saved.data) {
          hasSavedData.current = true;
          if (saved.data.editorData) {
            // Fix main track duration from saved totalDuration
            const dur = saved.data.totalDuration;
            const ensureRowHeight = (rows) => rows.map((row) => {
              if (row.id === 'broll-track' && !row.rowHeight) return { ...row, rowHeight: 119 };
              return row;
            });
            if (dur) {
              const fixed = ensureRowHeight(saved.data.editorData.map((row) => {
                if (row.id === 'main-track') {
                  return { ...row, actions: row.actions.map((a) => ({ ...a, end: dur })) };
                }
                return row;
              }));
              setEditorData(fixed);
            } else {
              setEditorData(ensureRowHeight(saved.data.editorData));
            }
          }
          if (saved.data.videoPath) {
            setVideoPath(saved.data.videoPath);
            videoPathRef.current = saved.data.videoPath;
            processedBlobRef.current = saved.data.videoPath;
          }
          if (saved.data.brollDirectory) setBrollDirectory(saved.data.brollDirectory);
          if (saved.data.assignments) {
            setAssignments(saved.data.assignments);
            assignmentsRef.current = saved.data.assignments;
          }
          if (saved.data.brollVolume != null) setBrollVolume(saved.data.brollVolume);
          if (saved.data.totalDuration) setTotalDuration(saved.data.totalDuration);
        }
      } catch (_) {}
      loadedFromDb.current = true;
    })();
  }, [nodeId]);

  // Autosave on changes (debounced 1s)
  const autosaveTimer = useRef(null);
  const [saveStatus, setSaveStatus] = useState(null);
  useEffect(() => {
    if (!nodeId || !editorData.length) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      const currentData = editorDataRef.current;
      setSaveStatus('saving');
      fetch('http://localhost:8000/node-data/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: nodeId,
          data: {
            editorData: currentData,
            videoPath,
            brollDirectory,
            assignments,
            brollVolume,
            totalDuration,
          },
        }),
      }).then(() => {
        setSaveStatus('saved');
      }).catch(() => setSaveStatus('saved'));
    }, 1000);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [nodeId, editorData, videoPath, brollDirectory, brollVolume]);

  // Listen for upstream data
  useEffect(() => {
    const check = () => {
      if (!loadedFromDb.current) return;
      const { video, assignData } = getSourceData();
      if (video?.savedPath && video.savedPath !== videoPathRef.current) {
        videoPathRef.current = video.savedPath;
        setVideoPath(video.savedPath);
      }
      if (assignData?.assignments && JSON.stringify(assignData.assignments) !== JSON.stringify(assignmentsRef.current)) {
        assignmentsRef.current = assignData.assignments;
        setAssignments(assignData.assignments);
        setBrollDirectory(assignData.directory);
        // Don't rebuild if we loaded saved data — the user's edits take priority
        if (!hasSavedData.current) {
          buildEditorData(assignData.assignments, assignData.directory);
        }
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
        const res = await fetch('http://localhost:8000/waveform?path=' + encodeURIComponent(videoPath) + '&samples=10000');
        const data = await res.json();
        if (data.duration) {
          setTotalDuration(data.duration);
          if (data.peaks) {
            setWaveformPeaks(data.peaks);
            setWaveformDuration(data.duration);
          }
          // Update main track with actual duration
          setEditorData((prev) => {
            if (!prev.length) return prev;
            return prev.map((row) => {
              if (row.id === 'main-track') {
                return {
                  ...row,
                  actions: [{
                    id: 'main-video',
                    start: 0,
                    end: data.duration,
                    effectId: 'main',
                    movable: false,
                    flexible: false,
                  }],
                };
              }
              return row;
            });
          });
        }
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
        id: 'broll-track',
        rowHeight: 119,
        actions: brollActions,
      },
      {
        id: 'main-track',
        actions: [{
          id: 'main-video',
          start: 0,
          end: totalDuration || 30,
          effectId: 'main',
          movable: false,
          flexible: false,
        }],
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
    // Preserve custom fields, and protect the main track from being modified
    const merged = newData.map((row, ri) => {
      // Never let onChange overwrite the main track
      if (row.id === 'main-track') {
        const existing = editorData.find((r) => r.id === 'main-track');
        if (existing) return existing;
      }
      return {
        ...row,
        actions: row.actions.map((a) => {
          const prev = editorData[ri]?.actions?.find((p) => p.id === a.id);
          if (prev) {
            return { ...a, _clipFilename: prev._clipFilename, _clipPath: prev._clipPath, _clipUrl: prev._clipUrl, _clipStartOffset: prev._clipStartOffset, _suggestion: prev._suggestion };
          }
          return a;
        }),
      };
    });
    setEditorData(merged);
  };

  const onClickAction = (e, { action }) => {
    if (action.effectId === 'main') return;
    const id = action.id;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      // Toggle selection
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedIds(new Set([id]));
    }
  };

  // Track original values at resize start so we don't accumulate errors
  const resizeSnapshot = useRef(null);

  const onActionResizeStart = useCallback(({ action, dir }) => {
    if (dir === 'left') {
      resizeSnapshot.current = {
        id: action.id,
        origStart: action.start,
        origOffset: action._clipStartOffset || 0,
      };
    } else {
      resizeSnapshot.current = null;
    }
  }, []);

  const onActionResizing = useCallback(({ action, row, start, end, dir }) => {
    if (dir === 'left' && resizeSnapshot.current && resizeSnapshot.current.id === action.id) {
      const totalDelta = start - resizeSnapshot.current.origStart;
      const newOffset = resizeSnapshot.current.origOffset + totalDelta;
      setEditorData((prev) =>
        prev.map((r) => ({
          ...r,
          actions: r.actions.map((a) => {
            if (a.id !== action.id) return a;
            return { ...a, _clipStartOffset: Math.max(0, newOffset) };
          }),
        }))
      );
    }
  }, []);

  const onActionResizeEnd = ({ action, row, start, end, dir }) => {
    pushUndo(editorData);
    if (dir === 'left' && resizeSnapshot.current && resizeSnapshot.current.id === action.id) {
      const totalDelta = start - resizeSnapshot.current.origStart;
      const newOffset = resizeSnapshot.current.origOffset + totalDelta;
      setEditorData((prev) =>
        prev.map((r) => ({
          ...r,
          actions: r.actions.map((a) => {
            if (a.id !== action.id) return a;
            return { ...a, start, end, _clipStartOffset: Math.max(0, newOffset) };
          }),
        }))
      );
    } else {
      setEditorData((prev) =>
        prev.map((r) => ({
          ...r,
          actions: r.actions.map((a) => (a.id === action.id ? { ...a, start, end } : a)),
        }))
      );
    }
    resizeSnapshot.current = null;
  };

  // Multi-drag: track initial positions of all selected clips
  const dragSnapshot = useRef(null);

  const onActionMoveStart = useCallback(({ action }) => {
    if (selectedIds.size > 1 && selectedIds.has(action.id)) {
      // Snapshot positions of all selected clips
      const snap = {};
      for (const row of editorData) {
        for (const a of row.actions) {
          if (selectedIds.has(a.id)) {
            snap[a.id] = { start: a.start, end: a.end };
          }
        }
      }
      dragSnapshot.current = { draggedId: action.id, origStart: action.start, positions: snap };
    } else {
      dragSnapshot.current = null;
    }
  }, [selectedIds, editorData]);

  const onActionMoving = useCallback(({ action, start }) => {
    if (!dragSnapshot.current || dragSnapshot.current.draggedId !== action.id) return;
    const delta = start - dragSnapshot.current.origStart;
    if (delta === 0) return;
    const { positions } = dragSnapshot.current;
    setEditorData((prev) =>
      prev.map((r) => ({
        ...r,
        actions: r.actions.map((a) => {
          if (a.id === action.id) return a; // Library handles the dragged one
          if (positions[a.id]) {
            return { ...a, start: positions[a.id].start + delta, end: positions[a.id].end + delta };
          }
          return a;
        }),
      }))
    );
  }, []);

  const onActionMoveEnd = ({ action, row, start, end }) => {
    if (dragSnapshot.current && dragSnapshot.current.draggedId === action.id) {
      const delta = start - dragSnapshot.current.origStart;
      const { positions } = dragSnapshot.current;
      pushUndo(editorData);
      setEditorData((prev) =>
        prev.map((r) => ({
          ...r,
          actions: r.actions.map((a) => {
            if (a.id === action.id) return { ...a, start, end };
            if (positions[a.id]) {
              return { ...a, start: positions[a.id].start + delta, end: positions[a.id].end + delta };
            }
            return a;
          }),
        }))
      );
      dragSnapshot.current = null;
    } else {
      pushUndo(editorData);
      setEditorData((prev) =>
        prev.map((r) => ({
          ...r,
          actions: r.actions.map((a) => (a.id === action.id ? { ...a, start, end } : a)),
        }))
      );
    }
  };

  // Marquee selection
  const onMarqueeDown = useCallback((e) => {
    // Only start marquee on the timeline background, not on actions or controls
    if (e.target.closest('.timeline-editor-action') || e.target.closest('.timeline-editor-time-area')) return;
    const wrapEl = e.currentTarget;
    const rect = wrapEl.getBoundingClientRect();
    const startX = e.clientX - rect.left + wrapEl.scrollLeft;
    const startY = e.clientY - rect.top + wrapEl.scrollTop;
    marqueeRef.current = { startX, startY, rect, wrapEl };
    setMarquee({ x: startX, y: startY, w: 0, h: 0 });

    const onMove = (ev) => {
      const curX = ev.clientX - rect.left + wrapEl.scrollLeft;
      const curY = ev.clientY - rect.top + wrapEl.scrollTop;
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      setMarquee({ x, y, w, h });

      // Convert marquee x range to time range and find overlapping b-roll clips
      const pxPerSec = scaleWidth / 5;
      const startLeft = 10;
      const tStart = (x - startLeft) / pxPerSec;
      const tEnd = (x + w - startLeft) / pxPerSec;
      const brollRow = editorData.find((r) => r.id === 'broll-track');
      if (brollRow) {
        const hits = new Set();
        for (const a of brollRow.actions) {
          if (a.end > tStart && a.start < tEnd) hits.add(a.id);
        }
        setSelectedIds(hits);
      }
    };

    const onUp = () => {
      setMarquee(null);
      marqueeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [scaleWidth, editorData]);

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    pushUndo(editorData);
    setEditorData((prev) =>
      prev.map((r) => ({
        ...r,
        actions: r.actions.filter((a) => !selectedIds.has(a.id)),
      }))
    );
    setSelectedIds(new Set());
  };

  // Get b-roll actions for preview
  const brollActions = useMemo(() => {
    const brollRow = editorData.find((r) => r.id === 'broll-track');
    if (!brollRow) return [];
    return brollRow.actions.map((a) => ({
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

  // Scrubbing — seek preview while dragging the playhead
  const onCursorDragStart = useCallback(() => {
    if (previewRef.current?.isPlaying?.()) {
      previewRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const onCursorDrag = useCallback((time) => {
    setCurrentTime(time);
    if (scrubRaf.current) cancelAnimationFrame(scrubRaf.current);
    scrubRaf.current = requestAnimationFrame(() => {
      if (previewRef.current) previewRef.current.seekTo(time);
    });
  }, []);

  // Render
  const renderBRoll = useCallback(async () => {
    if (!videoPath || !brollDirectory) return;
    const actions = editorData.find((r) => r.id === 'broll-track')?.actions || [];
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
          broll_volume: brollVolume,
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

  // Pre-compute waveform element so it's not rebuilt on every drag frame
  const waveformElement = useMemo(() => {
    if (!waveformPeaks.length) return null;
    const pxPerSec = scaleWidth / 5;
    const fullPxWidth = (waveformDuration || 1) * pxPerSec;
    return (
      <div className="tl-waveform-offset" style={{ left: 0 }}>
        <WaveformBar peaks={waveformPeaks} fullWidth={fullPxWidth} />
      </div>
    );
  }, [waveformPeaks, waveformDuration, scaleWidth]);

  // Custom action render
  const getActionRender = useCallback((action) => {
    const dur = action.end - action.start;
    if (action.effectId === 'main') {
      return (
        <div className="tl-action tl-main-action">
          {waveformElement}
          <span className="tl-broll-label">
            Talking Head
            {dur > 0.5 && <span className="tl-broll-dur"> {dur.toFixed(1)}s</span>}
          </span>
        </div>
      );
    }
    return (
      <div className={`tl-action tl-broll-action ${selectedIds.has(action.id) ? 'tl-action--sel' : ''}`}>
        {action._clipUrl && <ClipThumbnail videoUrl={action._clipUrl} seekTime={action._clipStartOffset || 0} />}
        <span className="tl-broll-label">
          {action._clipFilename || 'B-Roll'}
          {dur > 0.5 && <span className="tl-broll-dur"> {dur.toFixed(1)}s</span>}
        </span>
      </div>
    );
  }, [waveformElement, selectedIds]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  };

  const brollCount = editorData.find((r) => r.id === 'broll-track')?.actions?.length || 0;
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
          {renderStatus === 'rendering' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <span className="status-active">
                <span className="pulse-dot" />
                {renderPct === 0 ? ' Preparing render...' : ` Rendering... ${renderPct}%`}
              </span>
              {renderPct > 0 && (
                <div className="syncmerge-progress-bar">
                  <div className="syncmerge-progress-fill" style={{ width: `${renderPct}%` }} />
                </div>
              )}
            </div>
          )}
          {renderStatus === 'done' && resultPath && (
            <div className="status-done" style={{ fontSize: 11, marginTop: 4 }}>
              Saved: {resultPath.split('/').pop()}
            </div>
          )}
          {renderStatus === 'error' && (
            <div className="status-error" style={{ fontSize: 11, marginTop: 4 }}>Render failed</div>
          )}
        </div>

        <Handle type="source" position={Position.Right} />
      </div>

      {/* Modal editor */}
      {modalOpen && createPortal(
        <div
          className="tl-modal-overlay nodrag nopan"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setModalOpen(false);
            else if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
            else if (e.key === 's' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setSnapEnabled((v) => !v); }
            else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
            else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
              e.preventDefault();
              const brollRow = editorData.find((r) => r.id === 'broll-track');
              if (brollRow) setSelectedIds(new Set(brollRow.actions.map((a) => a.id)));
            }
            else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) { e.preventDefault(); deleteSelected(); }
          }}
        >
          <div className="tl-modal">
            <div className="tl-modal-header">
              <span>B-Roll Editor</span>
              <span className="tl-modal-stats">
                {brollCount} b-roll clips
                <span className="tl-save-status"> — {saveStatus === 'saving' ? 'Saving...' : 'All changes saved'}</span>
              </span>
              <button
                className="tl-header-btn"
                onClick={() => {
                  if (assignments.length && brollDirectory) {
                    buildEditorData(assignments, brollDirectory);
                  }
                }}
              >
                Regenerate layout
              </button>
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
                  brollVolume={brollVolume}
                />
              </div>

              {/* Transport */}
              <div className="tl-transport">
                <button className="tl-transport-btn" onClick={togglePlay}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <span className="tl-timecode">{currentTime.toFixed(2)}s / {totalDuration.toFixed(2)}s</span>
                <button
                  className={`tl-transport-btn${snapEnabled ? ' tl-snap-active' : ''}`}
                  onClick={() => setSnapEnabled((v) => !v)}
                  title={snapEnabled ? 'Snapping ON (click to disable)' : 'Snapping OFF (click to enable)'}
                >🧲</button>
                <button className="tl-transport-btn" onClick={undo} disabled={undoStack.current.length === 0} title="Undo">↩</button>
                <button className="tl-transport-btn" onClick={redo} disabled={redoStack.current.length === 0} title="Redo">↪</button>
                {selectedIds.size > 0 && (
                  <button className="tl-del-btn" onClick={deleteSelected}>
                    Delete {selectedIds.size > 1 ? `${selectedIds.size} clips` : 'clip'}
                  </button>
                )}
                <div className="tl-broll-volume">
                  <label>B-Roll Vol</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={brollVolume}
                    onChange={(e) => setBrollVolume(parseFloat(e.target.value))}
                  />
                  <span>{Math.round(brollVolume * 100)}%</span>
                </div>
                <div className="tl-zoom">
                  <button onClick={() => setScaleWidth((w) => Math.max(30, w - 20))}>−</button>
                  <button onClick={() => setScaleWidth((w) => Math.min(2000, w + 20))}>+</button>
                </div>
              </div>

              {/* Timeline */}
              <div
                className="tl-editor-wrap"
                style={{ height: 260, position: 'relative' }}
                onMouseDown={onMarqueeDown}
                onWheel={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    const wrap = e.currentTarget;
                    const rect = wrap.getBoundingClientRect();
                    const cursorX = e.clientX - rect.left;
                    const scrollLeft = wrap.scrollLeft || 0;
                    const posInTrack = scrollLeft + cursorX;
                    const oldPxPerSec = scaleWidth / 5;
                    const timeAtCursor = posInTrack / oldPxPerSec;
                    const delta = e.deltaY > 0 ? -15 : 15;
                    const newScaleWidth = Math.max(30, Math.min(2000, scaleWidth + delta));
                    setScaleWidth(newScaleWidth);
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
                <Timeline
                  ref={timelineRef}
                  editorData={editorData}
                  effects={EFFECTS}
                  onChange={onTimelineChange}
                  onClickAction={onClickAction}
                  onActionResizeStart={onActionResizeStart}
                  onActionResizing={onActionResizing}
                  onActionResizeEnd={onActionResizeEnd}
                  onActionMoveStart={onActionMoveStart}
                  onActionMoving={onActionMoving}
                  onActionMoveEnd={onActionMoveEnd}
                  dragLine={snapEnabled}
                  onClickRow={(e, { row, time }) => {
                    const clickedOnAction = (row.actions || []).some((a) => time >= a.start && time <= a.end);
                    if (!clickedOnAction) setSelectedIds(new Set());
                  }}
                  onCursorDragStart={onCursorDragStart}
                  onCursorDrag={onCursorDrag}
                  onCursorDragEnd={onCursorDrag}
                  onClickTimeArea={(time) => {
                    setCurrentTime(time);
                    if (previewRef.current) previewRef.current.seekTo(time);
                  }}
                  getActionRender={getActionRender}
                  scale={5}
                  scaleWidth={scaleWidth}
                  rowHeight={70}
                  startLeft={10}
                  autoScroll
                  style={{ width: '100%', height: 260 }}
                />
                {marquee && marquee.w > 2 && (
                  <div className="tl-marquee" style={{
                    left: marquee.x, top: marquee.y,
                    width: marquee.w, height: marquee.h,
                  }} />
                )}
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
