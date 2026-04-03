import { registerRoot, Composition } from 'remotion';
import BRollComposition from './BRollComposition';

const RemotionRoot = () => {
  return (
    <Composition
      id="BRollComposition"
      component={BRollComposition}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        mainVideoUrl: '',
        brollActions: [],
        fps: 30,
        brollVolume: 0.15,
      }}
    />
  );
};

registerRoot(RemotionRoot);
