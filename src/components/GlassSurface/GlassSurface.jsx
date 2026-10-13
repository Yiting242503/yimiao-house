import { useEffect, useId, useRef, useState } from 'react';

import './GlassSurface.css';

const BLENDS = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
const CHANNELS = new Set(['R', 'G', 'B', 'A']);
const finite = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
const length = value => typeof value === 'number' ? `${value}px` : value;

function supportsSVGBackdrop(filterId) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const ua = navigator.userAgent;
  const webkit = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  if (webkit || /Firefox|FxiOS|CriOS/.test(ua)) return false;
  return typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', `url("#${filterId}")`);
}

// React Bits' gradient displacement map: neutral center, refracted RGB edges.
function displacementMap(settings, width, height, redGradId, blueGradId) {
  const edge = Math.min(width, height) * settings.borderWidth * 0.5;
  const svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/>
      </linearGradient>
      <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="black"/>
    <rect width="${width}" height="${height}" rx="${settings.borderRadius}" fill="url(#${redGradId})"/>
    <rect width="${width}" height="${height}" rx="${settings.borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode:${settings.mixBlendMode}"/>
    <rect x="${edge}" y="${edge}" width="${Math.max(0, width - edge * 2)}" height="${Math.max(0, height - edge * 2)}" rx="${settings.borderRadius}" fill="hsl(0 0% ${settings.brightness}% / ${settings.opacity})" style="filter:blur(${settings.blur}px)"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export default function GlassSurface({
  children,
  width = 200,
  height = 80,
  borderRadius = 20,
  borderWidth = 0.07,
  brightness = 50,
  opacity = 0.93,
  blur = 11,
  displace = 0,
  backgroundOpacity = 0,
  saturation = 1,
  distortionScale = -180,
  redOffset = 0,
  greenOffset = 10,
  blueOffset = 20,
  xChannel = 'R',
  yChannel = 'G',
  mixBlendMode = 'difference',
  className = '',
  style = {}
}) {
  const uniqueId = useId().replace(/[^a-zA-Z0-9_-]/g, '-');
  const filterId = `glass-filter-${uniqueId}`;
  const redGradId = `glass-red-grad-${uniqueId}`;
  const blueGradId = `glass-blue-grad-${uniqueId}`;
  const containerRef = useRef(null);
  const feImageRef = useRef(null);
  const settingsRef = useRef(null);
  const scheduleRef = useRef(null);
  const [svgSupported, setSvgSupported] = useState(false);
  const roundedRadius = finite(borderRadius, 20, 0, 500);
  const outputBlur = finite(displace, 0, 0, 50);
  const displacement = finite(distortionScale, -180, -1000, 1000);
  const selectX = CHANNELS.has(xChannel) ? xChannel : 'R';
  const selectY = CHANNELS.has(yChannel) ? yChannel : 'G';
  const decorative = children === undefined || children === null;

  settingsRef.current = {
    borderRadius: roundedRadius,
    borderWidth: finite(borderWidth, 0.07, 0, 1),
    brightness: finite(brightness, 50, 0, 100),
    opacity: finite(opacity, 0.93, 0, 1),
    blur: finite(blur, 11, 0, 50),
    mixBlendMode: BLENDS.has(mixBlendMode) ? mixBlendMode : 'difference'
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const supported = supportsSVGBackdrop(filterId);
    setSvgSupported(supported);
    let alive = true;
    let raf = 0;
    let previous = '';
    const update = () => {
      raf = 0;
      if (!alive || !supported || !feImageRef.current) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      const settings = settingsRef.current;
      const key = JSON.stringify([w, h, settings]);
      if (key === previous) return;
      previous = key;
      feImageRef.current.setAttribute('href', displacementMap(settings, w, h, redGradId, blueGradId));
    };
    const schedule = () => {
      if (alive && supported && !raf) raf = requestAnimationFrame(update);
    };
    scheduleRef.current = schedule;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(container);
    if (!observer) window.addEventListener('resize', schedule);
    schedule();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', schedule);
      scheduleRef.current = null;
    };
  }, [filterId, redGradId, blueGradId]);

  useEffect(() => { scheduleRef.current?.(); }, [width, height, borderRadius, borderWidth, brightness, opacity, blur, mixBlendMode]);

  return (
    <div
      ref={containerRef}
      className={`glass-surface ${svgSupported ? 'glass-surface--svg' : 'glass-surface--fallback'}${decorative ? ' glass-surface--decorative' : ''}${className ? ` ${className}` : ''}`}
      data-glass-renderer={svgSupported ? 'svg' : 'fallback'}
      aria-hidden={decorative ? true : undefined}
      style={{
        ...style,
        width: length(width),
        height: length(height),
        borderRadius: `${roundedRadius}px`,
        '--glass-frost': finite(backgroundOpacity, 0, 0, 1),
        '--glass-saturation': finite(saturation, 1, 0, 5),
        '--filter-id': `url("#${filterId}")`
      }}
    >
      <svg className="glass-surface__filter" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
            <feImage ref={feImageRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" id={`${filterId}-red-channel`} result="dispRed" scale={displacement + finite(redOffset, 0, -500, 500)} xChannelSelector={selectX} yChannelSelector={selectY} />
            <feColorMatrix in="dispRed" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red" />
            <feDisplacementMap in="SourceGraphic" in2="map" id={`${filterId}-green-channel`} result="dispGreen" scale={displacement + finite(greenOffset, 10, -500, 500)} xChannelSelector={selectX} yChannelSelector={selectY} />
            <feColorMatrix in="dispGreen" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green" />
            <feDisplacementMap in="SourceGraphic" in2="map" id={`${filterId}-blue-channel`} result="dispBlue" scale={displacement + finite(blueOffset, 20, -500, 500)} xChannelSelector={selectX} yChannelSelector={selectY} />
            <feColorMatrix in="dispBlue" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue" />
            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" result="output" />
            <feGaussianBlur in="output" stdDeviation={outputBlur} />
          </filter>
        </defs>
      </svg>
      {!decorative ? <div className="glass-surface__content">{children}</div> : null}
    </div>
  );
}
