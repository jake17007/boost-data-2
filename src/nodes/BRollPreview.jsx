import { forwardRef, useImperativeHandle, useRef, useMemo, useEffect } from 'react';
import { Player } from '@remotion/player';
import BRollComposition from '../remotion/BRollComposition';

const FPS = 30;

const BRollPreview = forwardRef(({ mainVideoUrl, brollActions, totalDuration, onTimeUpdate, compositionWidth = 1920, compositionHeight = 1080, brollVolume = 0.15 }, ref) => {
  const playerRef = useRef(null);

  const totalFrames = Math.max(1, Math.round((totalDuration || 30) * FPS));

  // Memoize to prevent Player re-renders
  const actionsKey = JSON.stringify(brollActions);
  const stableActions = useMemo(() => brollActions || [], [actionsKey]);

  const inputProps = useMemo(
    () => ({ mainVideoUrl, brollActions: stableActions, fps: FPS, brollVolume }),
    [mainVideoUrl, stableActions, brollVolume]
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
