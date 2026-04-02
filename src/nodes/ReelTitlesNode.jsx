import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import { getNodeOutput, setNodeOutput, subscribe } from '../store';

const TITLE_EFFECT = { title: { id: 'title', name: 'Title' } };

export default function ReelTitlesNode() {
  const nodeId = useNodeId();
  const { getEdges } = useReactFlow();

  const [status, setStatus] = useState('idle');
  const [videoPath, setVideoPath] = useState(null);
  const [transcriptLines, setTranscriptLines] = useState([]);
  const [titles, setTitles] = useState([]);
  const [interval, setInterval_] = useState(5);
  const [customInterval, setCustomInterval] = useState(5);
  const [fontSize, setFontSize] = useState(40);
  const [fontColor, setFontColor] = useState('#ffffff');
  const [selectedId, setSelectedId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [renderStatus, setRenderStatus] = useState('idle');
  const [renderPct, setRenderPct] = useState(0);
  const [resultUrl, setResultUrl] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scaleWidth, setScaleWidth] = useState(100);

  const [dragging, setDragging] = useState(false);

  const processedRef = useRef(null);
  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const timelineRef = useRef(null);
  const videoWrapRef = useRef(null);

  const getSourceNodeId = useCallback(() => {
    const edges = getEdges();
    const incoming = edges.find((e) => e.target === nodeId);
    return incoming?.source ?? null;
  }, [getEdges, nodeId]);

  // Transcribe when upstream savedPath arrives
  const transcribe = useCallback(async (path) => {
    setStatus('transcribing');
    setVideoPath(path);
    setTitles([]);
    setResultUrl(null);
    setRenderStatus('idle');

    try {
      const res = await fetch('http://localhost:8000/transcribe-timestamps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: path }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTranscriptLines(data.lines || []);
      setStatus('ready');
    } catch (err) {
      console.error('Transcription failed:', err);
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
        transcribe(data.savedPath);
      }
    };
    check();
    return subscribe(() => check());
  }, [getSourceNodeId, transcribe]);

  // Generate titles via AI
  const generateTitles = useCallback(async () => {
    if (transcriptLines.length === 0) return;
    setStatus('generating');

    try {
      const res = await fetch('http://localhost:8000/suggest-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript_lines: transcriptLines,
          interval: interval === 'custom' ? customInterval : interval,
          video_duration: videoDuration,
        }),
      });
      const data = await res.json();
      const withIds = (data.titles || []).map((t, i) => ({ ...t, id: `title-${i}` }));
      setTitles(withIds);
      setStatus('ready');
    } catch (err) {
      console.error('Title generation failed:', err);
      setStatus('ready');
    }
  }, [transcriptLines, interval, customInterval, videoDuration]);

  // Render video with titles
  const renderTitles = useCallback(async () => {
    if (!videoPath || titles.length === 0) return;
    setRenderStatus('rendering');
    setRenderPct(0);
    setResultUrl(null);

    try {
      const res = await fetch('http://localhost:8000/render-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: videoPath,
          titles: titles.map((t) => ({
            start: t.start,
            end: t.end,
            text: t.text,
            x: t.x ?? 0.5,
            y: t.y ?? 0.33,
            fontSize,
            fontColor: fontColor.replace('#', '0x'),
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
  }, [videoPath, titles, fontSize, fontColor, nodeId]);

  // Video time tracking
  const trackTime = useCallback(() => {
    const v = videoRef.current;
    if (v && !v.paused) {
      setCurrentTime(v.currentTime);
      if (timelineRef.current) timelineRef.current.setTime(v.currentTime);
      rafRef.current = requestAnimationFrame(trackTime);
    }
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(trackTime);
    } else {
      v.pause();
      setIsPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  };

  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Find active title at current time
  const activeTitle = titles.find(
    (t) => currentTime >= t.start && currentTime < t.end
  );

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  };

  const updateTitle = (id, field, value) => {
    setTitles((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  const deleteTitle = (id) => {
    setTitles((prev) => prev.filter((t) => t.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const addTitle = () => {
    const newTitle = {
      id: `title-${Date.now()}`,
      start: currentTime,
      end: Math.min(currentTime + 2, videoDuration),
      text: 'NEW TITLE',
      x: 0.5,
      y: 0.33,
    };
    setTitles((prev) => [...prev, newTitle].sort((a, b) => a.start - b.start));
    setSelectedId(newTitle.id);
  };

  // Drag title on video preview
  const onOverlayMouseDown = (e, titleId) => {
    e.preventDefault();
    setDragging(true);
    setSelectedId(titleId);

    const wrap = videoWrapRef.current;
    if (!wrap) return;

    const onMove = (ev) => {
      const rect = wrap.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      setTitles((prev) => prev.map((t) => t.id === titleId ? { ...t, x: nx, y: ny } : t));
    };

    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Convert titles to timeline editor data format
  const editorData = [{
    id: 'track-0',
    actions: titles.map((t) => ({
      id: t.id,
      start: t.start,
      end: t.end,
      effectId: 'title',
    })),
  }];

  // When timeline data changes (drag, resize)
  const onTimelineChange = (newData) => {
    if (!newData[0]) return;
    setTitles((prev) => {
      const updated = prev.map((t) => {
        const action = newData[0].actions.find((a) => a.id === t.id);
        if (action) {
          return { ...t, start: action.start, end: action.end };
        }
        return t;
      });
      return updated;
    });
  };

  const onClickAction = (e, { action }) => {
    setSelectedId(action.id);
    if (videoRef.current) videoRef.current.currentTime = action.start;
  };

  const onClickTimeArea = (time) => {
    if (videoRef.current) videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const onCursorDragEnd = (time) => {
    if (videoRef.current) videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  // Custom clip rendering showing title text
  const getActionRender = (action) => {
    const title = titles.find((t) => t.id === action.id);
    return (
      <div className={`tl-action ${selectedId === action.id ? 'tl-action--sel' : ''}`}>
        <span className="tl-action-label" style={{ fontSize: 11, opacity: 0.9 }}>
          {title?.text || ''}
        </span>
      </div>
    );
  };

  return (
    <>
      <div className="rt-node">
        <Handle type="target" position={Position.Left} />

        <div className="rt-header">
          <span className="rt-icon">🎬</span>
          <span>Reel Titles</span>
          {titles.length > 0 && (
            <span className="rt-header-stats">{titles.length} titles</span>
          )}
        </div>

        <div className="rt-body nodrag nopan">
          {status === 'idle' && (
            <span className="status-hint">Waiting for video...</span>
          )}
          {status === 'transcribing' && (
            <span className="status-active">
              <span className="pulse-dot" /> Transcribing...
            </span>
          )}
          {status === 'generating' && (
            <span className="status-active">
              <span className="pulse-dot" /> Generating titles...
            </span>
          )}
          {status === 'error' && (
            <span className="status-error">Transcription failed</span>
          )}
          {status === 'ready' && (
            <>
              <button
                className="btn btn-start"
                style={{ width: '100%' }}
                onClick={() => setModalOpen(true)}
              >
                Open Editor
              </button>

              {renderStatus === 'rendering' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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

              {renderStatus === 'done' && (
                <span className="status-done">Render complete</span>
              )}

              {renderStatus === 'error' && (
                <span className="status-error">Render failed</span>
              )}
            </>
          )}
        </div>

        <Handle type="source" position={Position.Right} />
      </div>

      {/* Full-screen modal editor */}
      {modalOpen && createPortal(
        <div
          className="tl-modal-overlay"
          tabIndex={0}
          onKeyDown={(e) => {
            const tag = e.target.tagName;
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
            if (e.key === 'Escape') setModalOpen(false);
            else if (e.code === 'Space' && !isInput) { e.preventDefault(); togglePlay(); }
            else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !isInput) {
              e.preventDefault();
              deleteTitle(selectedId);
            }
          }}
        >
          <div className="tl-modal" style={{ maxWidth: 1400 }}>
            <div className="tl-modal-header">
              <span>Reel Titles Editor</span>
              <span className="tl-modal-stats">{titles.length} titles</span>
              <button className="tl-modal-close" onClick={() => setModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="rt-modal-body">
              {/* Left: Video Preview + Timeline */}
              <div className="rt-preview-panel">
                <div className="rt-video-wrap" ref={videoWrapRef}>
                  <video
                    ref={videoRef}
                    src={videoPath ? `http://localhost:8000/serve-video?path=${encodeURIComponent(videoPath)}` : undefined}
                    onLoadedMetadata={(e) => setVideoDuration(e.target.duration)}
                    onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                    onEnded={() => setIsPlaying(false)}
                    preload="auto"
                    style={{ width: '100%', maxHeight: '50vh', borderRadius: 6, background: '#000', display: 'block' }}
                  />
                  {/* Title overlay — draggable */}
                  {activeTitle && (
                    <div
                      className="rt-title-overlay"
                      style={{
                        left: `${(activeTitle.x ?? 0.5) * 100}%`,
                        top: `${(activeTitle.y ?? 0.33) * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        fontSize: fontSize * 0.5,
                        color: fontColor,
                        cursor: dragging ? 'grabbing' : 'grab',
                      }}
                      onMouseDown={(e) => onOverlayMouseDown(e, activeTitle.id)}
                    >
                      {activeTitle.text}
                    </div>
                  )}
                </div>

                {/* Transport */}
                <div className="tl-transport">
                  <button className="tl-transport-btn" onClick={togglePlay}>
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  <span className="tl-timecode">
                    {formatTime(currentTime)} / {formatTime(videoDuration)}
                  </span>
                  <div className="tl-zoom">
                    <button onClick={() => setScaleWidth((w) => Math.max(30, w - 20))}>−</button>
                    <button onClick={() => setScaleWidth((w) => Math.min(400, w + 20))}>+</button>
                  </div>
                </div>

                {/* Timeline */}
                <div
                  className="tl-editor-wrap"
                  onWheel={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      e.stopPropagation();
                      const delta = e.deltaY > 0 ? -15 : 15;
                      setScaleWidth((w) => Math.max(30, Math.min(400, w + delta)));
                    }
                  }}
                >
                  <Timeline
                    ref={timelineRef}
                    editorData={editorData}
                    effects={TITLE_EFFECT}
                    onChange={onTimelineChange}
                    onClickAction={onClickAction}
                    onCursorDragEnd={onCursorDragEnd}
                    onClickTimeArea={onClickTimeArea}
                    getActionRender={getActionRender}
                    scale={5}
                    scaleWidth={scaleWidth}
                    rowHeight={50}
                    startLeft={10}
                    autoScroll
                    style={{ width: '100%', height: 80 }}
                  />
                </div>

                {/* Render */}
                <div className="tl-modal-render-row">
                  <button
                    className="btn btn-start tl-render-btn"
                    onClick={renderTitles}
                    disabled={renderStatus === 'rendering' || titles.length === 0}
                  >
                    {renderStatus === 'rendering'
                      ? (renderPct === 0 ? 'Preparing render...' : `Rendering... ${renderPct}%`)
                      : 'Render Video'}
                  </button>
                </div>

                {renderStatus === 'rendering' && renderPct > 0 && (
                  <div className="syncmerge-progress-bar">
                    <div className="syncmerge-progress-fill" style={{ width: `${renderPct}%` }} />
                  </div>
                )}

                {renderStatus === 'error' && (
                  <span className="status-error">Render failed</span>
                )}
              </div>

              {/* Right: Title Editor */}
              <div className="rt-editor-panel">
                {/* Interval controls */}
                <div className="rt-controls">
                  <div className="rt-interval-row">
                    <label>Interval:</label>
                    <button
                      className={`rt-interval-btn ${interval === 3 ? 'rt-interval-btn--active' : ''}`}
                      onClick={() => setInterval_(3)}
                    >3s</button>
                    <button
                      className={`rt-interval-btn ${interval === 5 ? 'rt-interval-btn--active' : ''}`}
                      onClick={() => setInterval_(5)}
                    >5s</button>
                    <button
                      className={`rt-interval-btn ${interval === 'custom' ? 'rt-interval-btn--active' : ''}`}
                      onClick={() => setInterval_('custom')}
                    >Custom</button>
                    {interval === 'custom' && (
                      <input
                        type="number"
                        className="rt-custom-input"
                        value={customInterval}
                        min={1}
                        max={30}
                        onChange={(e) => setCustomInterval(Number(e.target.value))}
                      />
                    )}
                  </div>

                  <button
                    className="btn btn-start"
                    style={{ width: '100%' }}
                    onClick={generateTitles}
                    disabled={status === 'generating' || transcriptLines.length === 0}
                  >
                    {status === 'generating' ? 'Generating...' : 'Generate Titles'}
                  </button>
                </div>

                {/* Font controls */}
                <div className="rt-font-controls">
                  <label>Size: {fontSize}px</label>
                  <input
                    type="range"
                    min={40}
                    max={120}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                  />
                  <label>Color:</label>
                  <input
                    type="color"
                    value={fontColor}
                    onChange={(e) => setFontColor(e.target.value)}
                  />
                </div>

                {/* Title list */}
                <div className="rt-title-list">
                  {titles.map((t) => (
                    <div
                      key={t.id}
                      className={`rt-title-item ${selectedId === t.id ? 'rt-title-item--selected' : ''}`}
                      onClick={() => {
                        setSelectedId(t.id);
                        if (videoRef.current) videoRef.current.currentTime = t.start;
                      }}
                    >
                      <div className="rt-title-time">
                        <input
                          type="number"
                          step="0.1"
                          value={t.start}
                          onChange={(e) => updateTitle(t.id, 'start', Number(e.target.value))}
                          className="rt-time-input"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span>-</span>
                        <input
                          type="number"
                          step="0.1"
                          value={t.end}
                          onChange={(e) => updateTitle(t.id, 'end', Number(e.target.value))}
                          className="rt-time-input"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <input
                        className="rt-text-input"
                        value={t.text}
                        onChange={(e) => updateTitle(t.id, 'text', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="rt-title-bottom-row">
                        <span className="rt-pos-label">
                          x:{(t.x ?? 0.5).toFixed(2)} y:{(t.y ?? 0.33).toFixed(2)}
                        </span>
                        <button
                          className="rt-del-btn"
                          onClick={(e) => { e.stopPropagation(); deleteTitle(t.id); }}
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                <button className="rt-add-btn" onClick={addTitle}>
                  + Add Title
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
