import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import './RoomMotion.css';

const preferenceKey = 'house-room-motion';

export default function RoomMotion({ children, active = true }) {
  const rootRef = useRef(null);
  const pointerFrame = useRef(0);
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(preferenceKey) !== 'paused'; }
    catch { return true; }
  });
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(true);
  const [foreground, setForeground] = useState(() => !document.hidden);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReduced(query.matches);
    const onVisibility = () => setForeground(!document.hidden);
    query.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(rootRef.current);
    return () => {
      query.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
  }, []);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem(preferenceKey, next ? 'playing' : 'paused'); }
    catch { /* The control still works when browser storage is unavailable. */ }
  };
  const playing = enabled && !reduced && visible && foreground && active;
  const label = reduced ? '已遵循减少动态设置' : enabled ? '暂停小屋动效' : '播放小屋动效';

  const resetPointer = () => {
    cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = 0;
    rootRef.current?.style.removeProperty('--room-pan-x');
    rootRef.current?.style.removeProperty('--room-pan-y');
  };
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(pointerFrame.current);
      pointerFrame.current = 0;
    }
    return () => cancelAnimationFrame(pointerFrame.current);
  }, [playing]);

  const track = event => {
    if (!playing || event.pointerType !== 'mouse') return;
    const root = rootRef.current;
    const rect = root.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - .5) * -.9;
    const y = ((event.clientY - rect.top) / rect.height - .5) * -.8;
    cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = 0;
      root.style.setProperty('--room-pan-x', `${x}%`);
      root.style.setProperty('--room-pan-y', `${y}%`);
    });
  };

  return <div ref={rootRef} className="room-canvas room-motion" data-motion={playing ? 'playing' : 'paused'}
    onPointerMove={track} onPointerLeave={playing ? resetPointer : undefined} onPointerCancel={playing ? resetPointer : undefined}>
    {children}
    <span className="room-daylight" aria-hidden="true" />
    <span className="room-window-shadow" aria-hidden="true" />
    <button className="icon-button room-motion-toggle" type="button" title={label} aria-label={label}
      aria-pressed={enabled && !reduced} disabled={reduced} onClick={toggle}>
      {enabled && !reduced ? <Pause size={14} /> : <Play size={14} />}
    </button>
  </div>;
}
