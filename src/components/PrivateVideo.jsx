import { forwardRef, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { Play } from 'lucide-react';
import { videoPlayback } from './video-playback.js';
import './PrivateVideo.css';

export const useVideoPlaying = () => useSyncExternalStore(videoPlayback.subscribe, videoPlayback.isPlaying, () => false);

const PrivateVideo = forwardRef(function PrivateVideo({ src, originalSrc, label, className = '', controls = true, tabIndex }, forwardedRef) {
  const player = useRef(null), position = useRef(0);
  const [released, setReleased] = useState(false), [original, setOriginal] = useState(false);
  const source = original && originalSrc ? originalSrc : src;

  useEffect(() => {
    const video = player.current;
    const suspend = () => {
      // preload="none" only avoids the first download. Removing src also
      // cancels a previous player's buffered download when another is played.
      if (!video.hasAttribute('src')) return;
      if (Number.isFinite(video.currentTime)) position.current = video.currentTime;
      video.pause();
      video.removeAttribute('src');
      video.load();
      setReleased(true);
    };
    const unregister = videoPlayback.register(video, suspend);
    const hidden = () => { if (document.hidden) videoPlayback.suspend(video); };
    const leaving = () => videoPlayback.suspend(video);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    return () => {
      unregister();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leaving);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, []);

  const resume = () => {
    const video = player.current;
    flushSync(() => setReleased(false));
    video.load();
    // Call play during the click gesture for embedded mobile browsers.
    video.play().catch(() => {});
  };
  const switchQuality = () => {
    const video = player.current, wasPlaying = !video.paused;
    if (!released && Number.isFinite(video.currentTime)) position.current = video.currentTime;
    video.pause();
    flushSync(() => setOriginal(value => !value));
    if (released) return;
    video.load();
    if (wasPlaying) video.play().catch(() => {});
  };
  const restorePosition = () => {
    const video = player.current;
    if (position.current > 0) {
      try { video.currentTime = Math.min(position.current, Number.isFinite(video.duration) ? Math.max(0, video.duration - .05) : position.current); } catch {}
      position.current = 0;
    }
  };

  return <div className="private-video-stage">
    <video ref={video => {
      player.current = video;
      if (typeof forwardedRef === 'function') forwardedRef(video);
      else if (forwardedRef) forwardedRef.current = video;
    }} className={`private-video ${className}`} src={released ? undefined : source} controls={controls} playsInline preload="none" aria-label={label} tabIndex={tabIndex}
      onPlay={() => videoPlayback.play(player.current)} onPause={() => videoPlayback.stop(player.current)} onEnded={() => videoPlayback.stop(player.current)} onLoadedMetadata={restorePosition}/>
    {released && controls && <button type="button" className="private-video-resume" aria-label={`继续播放${label || '视频'}`} onClick={resume}><Play size={20}/><span>继续播放</span></button>}
    {originalSrc && controls && <button type="button" className="private-video-quality" onClick={switchQuality} aria-label={original ? '切换流畅视频' : '切换原画视频'}>{original ? '原画 · 切换流畅' : '流畅 · 查看原画'}</button>}
  </div>;
});

export default PrivateVideo;
