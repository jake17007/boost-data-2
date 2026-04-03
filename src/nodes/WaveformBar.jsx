import { memo } from 'react';

export default memo(function WaveformBar({ peaks, fullWidth }) {
  if (!peaks.length) return null;

  const w = peaks.length;
  const h = 100;
  const mid = h / 2;
  const isMinMax = Array.isArray(peaks[0]);

  let pathD = '';
  for (let i = 0; i < peaks.length; i++) {
    let yMin, yMax;
    if (isMinMax) {
      yMax = mid - peaks[i][1] * mid * 0.95;
      yMin = mid - peaks[i][0] * mid * 0.95;
    } else {
      const v = peaks[i] * mid * 0.95;
      yMax = mid - v;
      yMin = mid + v;
    }
    pathD += `M${i} ${yMax}V${yMin}`;
  }

  return (
    <svg
      className="tl-waveform-canvas"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: fullWidth, height: '100%' }}
    >
      <path
        d={pathD}
        stroke="rgba(255, 255, 255, 0.7)"
        strokeWidth="1"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});
