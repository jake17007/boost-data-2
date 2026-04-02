import { forwardRef, useImperativeHandle, useRef, useMemo, useEffect } from 'react';
import { Player } from '@remotion/player';
import { OffthreadVideo, AbsoluteFill, Sequence } from 'remotion';

const FPS = 30;

// Build transform style that rotates AND scales to fill the composition
const getVideoTransform = (rotation, compWidth, compHeight) => {
  if (!rotation) return {};
  const absRot = ((rotation % 360) + 360) % 360;
  const isSwapped = absRot === 90 || absRot === 270;
  if (isSwapped) {
    // After 90/270° rotation, width↔height swap.
    // Scale up by the aspect ratio so the rotated video fills the composition.
    const scale = Math.max(compWidth / compHeight, compHeight / compWidth);
    return {
      transform: `rotate(${rotation}deg) scale(${scale})`,
    };
  }
  return { transform: `rotate(${rotation}deg)` };
};

const SegmentedVideo = ({ videoUrl, segments, fps, rotation, compWidth, compHeight }) => {
  let position = 0;
  const videoStyle = getVideoTransform(rotation, compWidth, compHeight);

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
            <AbsoluteFill style={videoStyle}>
              <OffthreadVideo
                src={videoUrl}
                trimBefore={trimBefore}
                trimAfter={trimAfter}
                pauseWhenBuffering
                style={{ width: '100%', height: '100%' }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const SimpleVideo = ({ videoUrl, rotation, compWidth, compHeight }) => {
  const videoStyle = getVideoTransform(rotation, compWidth, compHeight);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={videoStyle}>
        <OffthreadVideo src={videoUrl} pauseWhenBuffering style={{ width: '100%', height: '100%' }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const RemotionPreview = forwardRef(({ videoUrl, segments, onTimeUpdate, rotation, compositionWidth = 1920, compositionHeight = 1080 }, ref) => {
  const playerRef = useRef(null);

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
      if (!stableSegments || idx < 0 || idx >= stableSegments.length) return;
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
      ? { videoUrl, segments: stableSegments, fps: FPS, rotation, compWidth: compositionWidth, compHeight: compositionHeight }
      : { videoUrl, rotation, compWidth: compositionWidth, compHeight: compositionHeight },
    [hasSegments, videoUrl, stableSegments, rotation, compositionWidth, compositionHeight]
  );

  return (
    <div className="gapless-preview">
      <Player
        ref={playerRef}
        component={hasSegments ? SegmentedVideo : SimpleVideo}
        inputProps={inputProps}
        durationInFrames={totalFrames}
        fps={FPS}
        compositionWidth={compositionWidth}
        compositionHeight={compositionHeight}
        style={{ width: '100%', maxHeight: '35vh' }}
        controls
        acknowledgeRemotionLicense
      />
    </div>
  );
});

RemotionPreview.displayName = 'RemotionPreview';
export default RemotionPreview;
