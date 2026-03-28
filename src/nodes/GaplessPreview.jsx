import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';

const GaplessPreview = forwardRef(({ videoUrl, segments, onTimeUpdate }, ref) => {
  const canvasRef = useRef(null);
  const videoA = useRef(null);
  const videoB = useRef(null);
  const rafRef = useRef(null);
  const stateRef = useRef({
    activeIdx: 0,
    segIdx: 0,
    playing: false,
    nextReady: false,
  });
  const [canvasSize, setCanvasSize] = useState({ w: 480, h: 270 });
  const [playing, setPlaying] = useState(false);

  const videos = useCallback(() => [videoA.current, videoB.current], []);

  // Set canvas size from video metadata
  useEffect(() => {
    const v = videoA.current;
    if (!v) return;
    const onMeta = () => {
      const aspect = v.videoWidth / v.videoHeight;
      const w = 480;
      const h = Math.round(w / aspect);
      setCanvasSize({ w, h });
    };
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [videoUrl]);

  // Pre-seek standby video to next segment
  const preSeekNext = useCallback(() => {
    const s = stateRef.current;
    const nextSegIdx = s.segIdx + 1;
    if (nextSegIdx >= segments.length) {
      s.nextReady = false;
      return;
    }
    const standbyIdx = 1 - s.activeIdx;
    const standby = videos()[standbyIdx];
    if (!standby) return;
    standby.currentTime = segments[nextSegIdx].start;
    s.nextReady = false;
    const onSeeked = () => {
      s.nextReady = true;
      standby.removeEventListener('seeked', onSeeked);
    };
    standby.addEventListener('seeked', onSeeked);
  }, [segments, videos]);

  // The render loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const s = stateRef.current;
    const active = videos()[s.activeIdx];

    if (active && active.readyState >= 2) {
      ctx.drawImage(active, 0, 0, canvas.width, canvas.height);
    }

    if (active && !active.paused && segments.length > 0) {
      const seg = segments[s.segIdx];
      const t = active.currentTime;

      // Report timeline time (packed)
      if (onTimeUpdate) {
        let acc = 0;
        for (let i = 0; i < s.segIdx; i++) {
          acc += segments[i].end - segments[i].start;
        }
        acc += t - seg.start;
        onTimeUpdate(acc, t);
      }

      // Check if we've hit the end of current segment
      if (t >= seg.end - 0.03) {
        const nextSegIdx = s.segIdx + 1;
        if (nextSegIdx < segments.length) {
          if (s.nextReady) {
            // Swap
            active.pause();
            active.muted = true;

            const standbyIdx = 1 - s.activeIdx;
            const standby = videos()[standbyIdx];
            standby.muted = false;
            standby.play();

            s.activeIdx = standbyIdx;
            s.segIdx = nextSegIdx;

            // Pre-seek the now-free video for the segment after next
            preSeekNext();
          } else {
            // Next not ready yet — seek and wait
            active.pause();
            const standbyIdx = 1 - s.activeIdx;
            const standby = videos()[standbyIdx];
            standby.currentTime = segments[nextSegIdx].start;
            standby.muted = false;

            const onReady = () => {
              standby.play();
              s.activeIdx = standbyIdx;
              s.segIdx = nextSegIdx;
              preSeekNext();
              standby.removeEventListener('seeked', onReady);
            };
            standby.addEventListener('seeked', onReady);
          }
        } else {
          // All segments done
          active.pause();
          s.playing = false;
          setPlaying(false);
          return;
        }
      }
    }

    if (s.playing) {
      rafRef.current = requestAnimationFrame(draw);
    }
  }, [segments, videos, preSeekNext, onTimeUpdate]);

  // Start/stop the render loop
  useEffect(() => {
    if (playing) {
      stateRef.current.playing = true;
      rafRef.current = requestAnimationFrame(draw);
    } else {
      stateRef.current.playing = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, draw]);

  const play = useCallback(() => {
    const s = stateRef.current;
    if (segments.length === 0) return;

    // Start from first segment if not already in one
    const active = videos()[s.activeIdx];
    if (!active) return;

    const inSeg = segments.some(
      (seg) => active.currentTime >= seg.start && active.currentTime <= seg.end
    );
    if (!inSeg) {
      s.segIdx = 0;
      active.currentTime = segments[0].start;
    }

    active.muted = false;
    active.play();
    preSeekNext();
    setPlaying(true);
  }, [segments, videos, preSeekNext]);

  const pause = useCallback(() => {
    const active = videos()[stateRef.current.activeIdx];
    if (active) active.pause();
    setPlaying(false);
  }, [videos]);

  const seekToSegment = useCallback((idx, sourceTime) => {
    if (idx < 0 || idx >= segments.length) return;
    const s = stateRef.current;
    const active = videos()[s.activeIdx];
    if (!active) return;
    s.segIdx = idx;
    active.currentTime = sourceTime != null ? sourceTime : segments[idx].start;
    // Draw the seeked frame
    const onSeeked = () => {
      const canvas = canvasRef.current;
      if (canvas && active.readyState >= 2) {
        canvas.getContext('2d').drawImage(active, 0, 0, canvas.width, canvas.height);
      }
      preSeekNext();
      active.removeEventListener('seeked', onSeeked);
    };
    active.addEventListener('seeked', onSeeked);
  }, [segments, videos, preSeekNext]);

  // Expose controls to parent
  useImperativeHandle(ref, () => ({
    play,
    pause,
    seekToSegment,
    isPlaying: () => playing,
  }), [play, pause, seekToSegment, playing]);

  return (
    <div className="gapless-preview">
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        style={{ width: '100%', borderRadius: 4, background: '#000', display: 'block' }}
      />
      <video ref={videoA} src={videoUrl} muted preload="auto" style={{ display: 'none' }} />
      <video ref={videoB} src={videoUrl} muted preload="auto" style={{ display: 'none' }} />
    </div>
  );
});

GaplessPreview.displayName = 'GaplessPreview';
export default GaplessPreview;
