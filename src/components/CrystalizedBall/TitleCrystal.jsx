import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import './CrystalizedBall.css';

const CrystalizedBall = lazy(() => import('./CrystalizedBall'));

class CrystalBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function TitleCrystal() {
  const host = useRef(null);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const onReady = useCallback(() => setReady(true), []);
  const onFailure = useCallback(() => { setFailed(true); setReady(false); }, []);

  useEffect(() => {
    const widthQuery = window.matchMedia('(max-width: 760px)');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateWidth = event => setCompact(event.matches);
    const updateMotion = event => setReduced(event.matches);
    widthQuery.addEventListener('change', updateWidth);
    motionQuery.addEventListener('change', updateMotion);
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setEnabled(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    if (host.current) observer.observe(host.current);
    return () => {
      observer.disconnect();
      widthQuery.removeEventListener('change', updateWidth);
      motionQuery.removeEventListener('change', updateMotion);
    };
  }, []);

  return <span ref={host} className="title-crystal" aria-hidden="true" data-crystal-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}>
    {enabled && !failed && <CrystalBoundary onFailure={onFailure}><Suspense fallback={null}><CrystalizedBall preset="plasma" theme="dark" color="#C7955E" size={0.74} crackle={0.85} glow={1.05} particleCount={compact ? 1400 : 2400} fill={0.56} hoverStrength={0.7} paused={reduced} intro={!reduced} interactive={!reduced} maxDpr={compact ? 1.5 : 2} maxFps={30} onReady={onReady} onError={onFailure}/></Suspense></CrystalBoundary>}
    {(!ready || failed) && <Sparkles className="title-crystal-fallback" size={34} strokeWidth={1.2}/>}
  </span>;
}
