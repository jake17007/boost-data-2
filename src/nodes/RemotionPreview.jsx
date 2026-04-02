import { forwardRef, useImperativeHandle, useRef, useMemo, useEffect } from 'react';
import { Player } from '@remotion/player';
import { OffthreadVideo, AbsoluteFill, Sequence } from 'remotion';

const FPS = 30;

/**
 * Each segment is a Sequence with an OffthreadVideo trimmed to the right range.
 * trimBefore = start frame in source, trimAfter = end frame in source.
 */
const VideoWithRotation = ({ children, rotation }) => {
  if (!rotation) return children;
  return (
    <AbsoluteFill style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        transform: `rotate(${rotation}deg)`,
        width: '100%',
        height: '100%',
      }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

const SegmentedVideo = ({ videoUrl, segments, fps, rotation }) => {
  let position = 0;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {segments.map((seg, i) => {
        const trimBefore = Math.round(seg.start * fps);
        const trimAfter = Math.round(seg.end * fps);
        const durationFrames = trimAfter - trimBefore;
        const from = position;
        position += durationFrames;

        return (
          <Sequence key={i} from={from} durationInFrames={durationFrames} premountFor={60}>
            <VideoWithRotation rotation={rotation}>
              <OffthreadVideo
                src={videoUrl}
                trimBefore={trimBefore}
                trimAfter={trimAfter}
                pauseWhenBuffering
              />
            </VideoWithRotation>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const SimpleVideo = ({ videoUrl, rotation }) => {
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <VideoWithRotation rotation={rotation}>
        <OffthreadVideo src={videoUrl} pauseWhenBuffering />
      </VideoWithRotation>
    </AbsoluteFill>
  );
};

const RemotionPreview = forwardRef(({ videoUrl, segments, onTimeUpdate, rotation }, ref) => {
  const playerRef = useRef(null);

  // Memoize segments by value (not reference) to prevent Player re-renders
  const segmentsKey = JSON.stringify(segments);
  const stableSegments = useMemo(() => segments, [segmentsKey]);

  const totalFrames = useMemo(() => {
    if (!stableSegments?.length) return 900;
    return Math.max(
      1,
      stableSegments.reduce((sum, s) => sum + Math.round((s.end - s.start) * FPS), 0)
    );
  }, [stableSegments]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onTimeUpdate) return;
    const handler = (e) => onTimeUpdate(e.detail.frame / FPS);
    player.addEventListener('frameupdate', handler);
    return () => player.removeEventListener('frameupdate', handler);
  }, [onTimeUpdate]);

  useImperativeHandle(ref, () => ({
    play: () => playerRef.current?.play(),
    pause: () => playerRef.current?.pause(),
    seekToSegment: (idx, sourceTime) => {
      if (!stableSegments || idx < 0 || idx >= segments.length) return;
      let frame = 0;
      for (let i = 0; i < idx; i++) {
        frame += Math.round((stableSegments[i].end - stableSegments[i].start) * FPS);
      }
      frame += Math.round(((sourceTime ?? stableSegments[idx].start) - stableSegments[idx].start) * FPS);
      playerRef.current?.seekTo(frame);
    },
    isPlaying: () => playerRef.current?.isPlaying() ?? false,
  }), [stableSegments]);

  if (!videoUrl) return null;

  const hasSegments = stableSegments?.length > 0;

  const inputProps = useMemo(
    () => hasSegments
      ? { videoUrl, segments: stableSegments, fps: FPS, rotation }
      : { videoUrl, rotation },
    [hasSegments, videoUrl, stableSegments, rotation]
  );

  return (
    <div className="gapless-preview" style={{ width: '100%', position: 'relative' }}>
      <Player
        ref={playerRef}
        component={hasSegments ? SegmentedVideo : SimpleVideo}
        inputProps={inputProps}
        durationInFrames={totalFrames}
        fps={FPS}
        compositionWidth={1920}
        compositionHeight={1080}
        style={{ width: '100%', aspectRatio: '16 / 9' }}
        controls
        acknowledgeRemotionLicense
      />
    </div>
  );
});

RemotionPreview.displayName = 'RemotionPreview';
export default RemotionPreview;
