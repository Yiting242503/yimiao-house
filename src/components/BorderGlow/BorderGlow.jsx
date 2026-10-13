import { useEffect, useMemo, useRef } from 'react';

import './BorderGlow.css';

const DEFAULT_COLORS = ['#c084fc', '#f472b6', '#38bdf8'];
const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
const GRADIENT_KEYS = ['--gradient-one', '--gradient-two', '--gradient-three', '--gradient-four', '--gradient-five', '--gradient-six', '--gradient-seven'];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback, min, max) => clamp(Number.isFinite(Number(value)) ? Number(value) : fallback, min, max);
const easeOutCubic = value => 1 - Math.pow(1 - value, 3);
const easeInCubic = value => value * value * value;

function parseHSL(value) {
  const match = typeof value === 'string' ? value.match(/^\s*([-+]?(?:\d+\.?\d*|\.\d+))(?:deg)?\s+([-+]?(?:\d+\.?\d*|\.\d+))%?\s+([-+]?(?:\d+\.?\d*|\.\d+))%?\s*$/) : null;
  if (!match) return { h: 40, s: 80, l: 80 };
  const h = Number(match[1]);
  return { h: Number.isFinite(h) ? ((h % 360) + 360) % 360 : 40, s: finite(match[2], 80, 0, 100), l: finite(match[3], 80, 0, 100) };
}

function buildGlowVars(glowColor, intensity) {
  const { h, s, l } = parseHSL(glowColor);
  const base = `${h}deg ${s}% ${l}%`;
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
  return Object.fromEntries(keys.map((key, i) => [`--glow-color${key}`, `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`]));
}

function validColors(value) {
  const parsed = Array.isArray(value) ? value.filter(color => typeof color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color.trim())).map(color => color.trim()) : [];
  return parsed.length ? parsed.slice(0, 3) : DEFAULT_COLORS;
}

function buildGradientVars(colors) {
  const vars = {};
  for (let i = 0; i < 7; i++) {
    vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${colors[Math.min(COLOR_MAP[i], colors.length - 1)]} 0px, transparent 50%)`;
  }
  vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`;
  return vars;
}

function validBackground(value) {
  if (typeof value !== 'string') return '#120F17';
  const color = value.trim();
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) return color;
  return typeof CSS !== 'undefined' && CSS.supports('color', color) ? color : '#120F17';
}

function isLightColor(color) {
  const value = color.replace('#', '');
  if (!/^[\da-f]{3}([\da-f]{3})?$/i.test(value)) return false;
  const hex = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
  const [red, green, blue] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 180;
}

export default function BorderGlow({
  children,
  className = '',
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#120F17',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1,
  coneSpread = 25,
  animated = false,
  colors = DEFAULT_COLORS,
  fillOpacity = 0.5
}) {
  const cardRef = useRef(null);
  const stopSweepRef = useRef(null);
  const reducedRef = useRef(false);
  const intensity = finite(glowIntensity, 1, 0.1, 3);
  const background = validBackground(backgroundColor);
  const glowVars = useMemo(() => buildGlowVars(glowColor, intensity), [glowColor, intensity]);
  const gradientVars = useMemo(() => buildGradientVars(validColors(colors)), [colors]);

  const updatePointer = (event, forceEdge = false) => {
    const card = cardRef.current;
    if (!card) return;
    stopSweepRef.current?.();
    const rect = card.getBoundingClientRect();
    const cx = Math.max(1, rect.width / 2);
    const cy = Math.max(1, rect.height / 2);
    const dx = event.clientX - rect.left - cx;
    const dy = event.clientY - rect.top - cy;
    const edge = forceEdge ? 1 : clamp(Math.max(Math.abs(dx) / cx, Math.abs(dy) / cy), 0, 1);
    const angle = reducedRef.current ? 45 : (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360;
    card.dataset.active = '';
    card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
  };

  const reset = () => {
    stopSweepRef.current?.();
    const card = cardRef.current;
    if (!card) return;
    delete card.dataset.active;
    card.style.setProperty('--edge-proximity', '0');
  };

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let alive = true;
    let started = 0;
    let lastDraw = 0;
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      card.classList.remove('sweep-active');
    };
    stopSweepRef.current = stop;
    const reduce = matches => {
      reducedRef.current = matches;
      if (matches) card.dataset.reducedMotion = '';
      else delete card.dataset.reducedMotion;
    };
    reduce(media?.matches ?? false);
    const onMotionChange = event => {
      reduce(event.matches);
      stop();
      if (!card.hasAttribute('data-active')) card.style.setProperty('--edge-proximity', '0');
      if (event.matches) card.style.setProperty('--cursor-angle', '45deg');
    };
    const onBlur = () => {
      stop();
      delete card.dataset.active;
      card.style.setProperty('--edge-proximity', '0');
    };
    const onVisibility = () => { if (document.hidden) onBlur(); };
    media?.addEventListener('change', onMotionChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);

    if (animated && !reducedRef.current && !document.hidden) {
      card.classList.add('sweep-active');
      started = performance.now();
      const tick = now => {
        raf = 0;
        if (!alive || document.hidden || reducedRef.current) return;
        if (now - lastDraw < 1000 / 30) { raf = requestAnimationFrame(tick); return; }
        lastDraw = now;
        const elapsed = now - started;
        const edge = elapsed < 500 ? 100 * easeOutCubic(clamp(elapsed / 500, 0, 1))
          : elapsed < 2500 ? 100 : 100 * (1 - easeInCubic(clamp((elapsed - 2500) / 1500, 0, 1)));
        const progress = elapsed < 1500 ? 0.5 * easeInCubic(clamp(elapsed / 1500, 0, 1))
          : 0.5 + 0.5 * easeOutCubic(clamp((elapsed - 1500) / 2250, 0, 1));
        card.style.setProperty('--edge-proximity', edge.toFixed(3));
        card.style.setProperty('--cursor-angle', `${(110 + 355 * progress).toFixed(3)}deg`);
        if (elapsed < 4000) raf = requestAnimationFrame(tick);
        else { card.classList.remove('sweep-active'); card.style.setProperty('--edge-proximity', '0'); }
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      alive = false;
      stop();
      stopSweepRef.current = null;
      media?.removeEventListener('change', onMotionChange);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      if (!card.hasAttribute('data-active')) card.style.setProperty('--edge-proximity', '0');
    };
  }, [animated]);

  return (
    <div
      ref={cardRef}
      className={`border-glow-card${isLightColor(background) ? ' border-glow-card--light' : ''}${className ? ` ${className}` : ''}`}
      onPointerEnter={updatePointer}
      onPointerMove={event => { if (event.pointerType !== 'touch' || event.buttons) updatePointer(event, event.pointerType === 'touch'); }}
      onPointerDown={event => updatePointer(event, event.pointerType === 'touch')}
      onPointerUp={event => { if (event.pointerType === 'touch') reset(); }}
      onPointerCancel={reset}
      onPointerLeave={reset}
      onFocusCapture={() => {
        stopSweepRef.current?.();
        const card = cardRef.current;
        if (card) { card.dataset.active = ''; card.style.setProperty('--edge-proximity', '100'); card.style.setProperty('--cursor-angle', '45deg'); }
      }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) reset(); }}
      style={{
        '--card-bg': background,
        '--edge-sensitivity': finite(edgeSensitivity, 30, 0, 99),
        '--border-radius': `${finite(borderRadius, 28, 0, 500)}px`,
        '--glow-padding': `${finite(glowRadius, 40, 0, 150)}px`,
        '--cone-spread': finite(coneSpread, 25, 5, 45),
        '--fill-opacity': finite(fillOpacity, 0.5, 0, 1),
        ...glowVars,
        ...gradientVars
      }}
    >
      <span className="edge-light" aria-hidden="true" />
      <div className="border-glow-inner">{children}</div>
    </div>
  );
}
