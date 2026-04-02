import { useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import VideoEditor from '@twick/video-editor';
import '@twick/video-editor/dist/video-editor.css';
import { LivePlayerProvider, useLivePlayerContext, PLAYER_STATE } from '@twick/live-player';
import { TimelineProvider, useTimelineContext, VideoElement } from '@twick/timeline';

// Inner component that has access to twick contexts
function TwickInner({ videoUrl, segments, onTimeUpdate, innerRef }) {
  const { editor } = useTimelineContext();
  const { setPlayerState, setSeekTime, currentTime, playerState } = useLivePlayerContext();
  const loadedRef = useRef(false);

  // Report time updates
  useEffect(() => {
    if (onTimeUpdate && currentTime != null) {
      onTimeUpdate(currentTime);
    }
  }, [currentTime, onTimeUpdate]);

  // Load segments into timeline as video elements
  const segmentsKeyRef = useRef('');
  useEffect(() => {
    if (!editor || !segments || segments.length === 0 || !videoUrl) return;

    // Only reload if segments actually changed
    const key = segments.map(s => `${s.start}-${s.end}`).join(',') + videoUrl;
    if (key === segmentsKeyRef.current) return;
    segmentsKeyRef.current = key;

    // Clear existing tracks
    const existingTracks = editor.getTracks ? editor.getTracks() : [];
    for (const t of existingTracks) {
      try { editor.removeTrack(t); } catch (e) { /* ignore */ }
    }

    // Create a new track and add clips
    const track = editor.addTrack('Video');
    let cursor = 0;

    for (const seg of segments) {
      const dur = seg.end - seg.start;
      const el = new VideoElement(videoUrl, { width: 1920, height: 1080 });
      el.setStart(cursor);
      el.setEnd(cursor + dur);
      el.setProps({
        src: videoUrl,
        time: seg.start,
        playbackRate: 1,
        volume: 1,
      });
      editor.addElementToTrack(track, el);
      cursor += dur;
    }

    loadedRef.current = true;
  }, [editor, segments, videoUrl]);

  // Expose controls
  useImperativeHandle(innerRef, () => ({
    play: () => setPlayerState(PLAYER_STATE.PLAYING),
    pause: () => setPlayerState(PLAYER_STATE.PAUSED),
    seekToSegment: (idx, sourceTime) => {
      if (!segments || idx < 0 || idx >= segments.length) return;
      let packed = 0;
      for (let i = 0; i < idx; i++) {
        packed += segments[i].end - segments[i].start;
      }
      if (sourceTime != null) {
        packed += sourceTime - segments[idx].start;
      }
      setSeekTime(packed);
    },
    isPlaying: () => playerState === PLAYER_STATE.PLAYING,
  }), [segments, setPlayerState, setSeekTime, playerState]);

  return (
    <VideoEditor
      editorConfig={{
        canvasMode: true,
        videoProps: { width: 1920, height: 1080 },
      }}
    />
  );
}

const TwickPreview = forwardRef(({ videoUrl, segments, onTimeUpdate }, ref) => {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    play: () => innerRef.current?.play(),
    pause: () => innerRef.current?.pause(),
    seekToSegment: (idx, sourceTime) => innerRef.current?.seekToSegment(idx, sourceTime),
    isPlaying: () => innerRef.current?.isPlaying() || false,
  }), []);

  return (
    <div style={{ width: '100%', borderRadius: 4, overflow: 'hidden' }}>
      <LivePlayerProvider>
        <TimelineProvider contextId="tl-preview">
          <TwickInner
            videoUrl={videoUrl}
            segments={segments}
            onTimeUpdate={onTimeUpdate}
            innerRef={innerRef}
          />
        </TimelineProvider>
      </LivePlayerProvider>
    </div>
  );
});

TwickPreview.displayName = 'TwickPreview';
export default TwickPreview;
