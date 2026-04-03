import { OffthreadVideo, AbsoluteFill, Sequence } from 'remotion';

const BRollComposition = ({ mainVideoUrl, brollActions, fps, brollVolume = 0.15 }) => {
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
      {(brollActions || []).map((action) => {
        const from = Math.round(action.start * fps);
        const to = Math.round(action.end * fps);
        const dur = to - from;
        const trimBefore = Math.round((action._clipStartOffset || 0) * fps);
        if (dur <= 0) return null;

        return (
          <Sequence key={action.id} from={from} durationInFrames={dur} premountFor={30}>
            <AbsoluteFill>
              <OffthreadVideo
                src={action._clipUrl}
                trimBefore={trimBefore}
                pauseWhenBuffering
                volume={brollVolume}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export default BRollComposition;
