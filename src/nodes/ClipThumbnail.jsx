import { memo, useEffect, useRef, useState } from 'react';

const cache = new Map();
// Keep one video element per URL to avoid repeated loading
const videoPool = new Map();

function getVideo(url) {
  if (videoPool.has(url)) return Promise.resolve(videoPool.get(url));
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    v.addEventListener('loadeddata', () => {
      videoPool.set(url, v);
      resolve(v);
    }, { once: true });
    v.addEventListener('error', () => resolve(null), { once: true });
  });
}

function snapFrame(video, time) {
  return new Promise((resolve) => {
    video.currentTime = Math.max(0, time);
    video.addEventListener('seeked', () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      resolve(c.toDataURL('image/jpeg', 0.7));
    }, { once: true });
  });
}

export default memo(function ClipThumbnail({ videoUrl, seekTime = 0 }) {
  const cacheKey = `${videoUrl}@${seekTime.toFixed(1)}`;
  const [src, setSrc] = useState(() => cache.get(cacheKey) || null);
  const pending = useRef(null);

  useEffect(() => {
    const cached = cache.get(cacheKey);
    if (cached) { setSrc(cached); return; }

    // Debounce during drag — only grab frame after 80ms idle
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      getVideo(videoUrl).then((v) => {
        if (!v) return;
        snapFrame(v, seekTime).then((url) => {
          cache.set(cacheKey, url);
          setSrc(url);
        });
      });
    }, 80);

    return () => { if (pending.current) clearTimeout(pending.current); };
  }, [videoUrl, seekTime, cacheKey]);

  if (!src) return null;

  return (
    <div
      className="tl-filmstrip"
      style={{
        backgroundImage: `url(${src})`,
        backgroundSize: 'auto 100%',
        backgroundRepeat: 'repeat-x',
      }}
    />
  );
});
