import { forwardRef, useImperativeHandle, useRef, useMemo, useEffect } from 'react';
import { Player } from '@remotion/player';
import { OffthreadVideo, AbsoluteFill, Sequence } from 'remotion';

const FPS = 30;

/**
 * Remotion composition: main video on bottom, b-roll clips layered on top.
 * B-roll clips appear at their assigned timeline positions.
 */
const BRollComposition = ({ mainVideoUrl, brollActions, fps }) => {
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* Base layer: main video */}
      <AbsoluteFill>
        <OffthreadVideo
          src={mainVideoUrl}
          pauseWhenBuffering
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </AbsoluteFill>

      {/* B-roll overlay layers */}
      {brollActions.map((action) => {
        const from = Math.round(action.start * fps);
        const dur = Math.round((action.end - action.start) * fps);
        const trimBefore = Math.round((action._clipStartOffset || 0) * fps);
        if (dur <= 0) return null;

        return (
          <Sequence key={action.id} from={from} durationInFrames={dur} premountFor={30}>
            <AbsoluteFill>
              <OffthreadVideo
                src={action._clipUrl}
                trimBefore={trimBefore}
                pauseWhenBuffering
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const BRollPreview = forwardRef(({ mainVideoUrl, brollActions, totalDuration, onTimeUpdate, compositionWidth = 1920, compositionHeight = 1080 }, ref) => {
  const playerRef = useRef(null);

  const totalFrames = Math.max(1, Math.round((totalDuration || 30) * FPS));

  // Memoize to prevent Player re-renders
  const actionsKey = JSON.stringify(brollActions);
  const stableActions = useMemo(() => brollActions || [], [actionsKey]);

  const inputProps = useMemo(
    () => ({ mainVideoUrl, brollActions: stableActions, fps: FPS }),
    [mainVideoUrl, stableActions]
  );

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
    seekTo: (time) => playerRef.current?.seekTo(Math.round(time * FPS)),
    isPlaying: () => playerRef.current?.isPlaying() ?? false,
  }), []);

  if (!mainVideoUrl) return null;

  // Calculate player size to fit within container while maintaining aspect ratio
  const maxWidth = 640;
  const maxHeight = 360;
  const aspect = compositionWidth / compositionHeight;
  let playerWidth, playerHeight;
  if (aspect >= 1) {
    // Landscape or square
    playerWidth = Math.min(maxWidth, maxWidth);
    playerHeight = Math.round(playerWidth / aspect);
  } else {
    // Portrait
    playerHeight = Math.min(maxHeight, maxHeight);
    playerWidth = Math.round(playerHeight * aspect);
  }

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <Player
        ref={playerRef}
        component={BRollComposition}
        inputProps={inputProps}
        durationInFrames={totalFrames}
        fps={FPS}
        compositionWidth={compositionWidth}
        compositionHeight={compositionHeight}
        style={{ width: playerWidth, height: playerHeight }}
        controls
        acknowledgeRemotionLicense
      />
    </div>
  );
});

BRollPreview.displayName = 'BRollPreview';
export default BRollPreview;
