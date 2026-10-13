import { Component, useCallback, useState } from 'react';
import { ArrowLeft, Pause, Play, RotateCcw, LoaderCircle } from 'lucide-react';
import AeroShards from './AeroShards.jsx';
import './AeroPreview.css';

const palettes = [
  { name: '珍珠', background: '#F6F3ED', shard: '#C999AE', accent: '#ADD8CE' },
  { name: '日光', background: '#F4F2EA', shard: '#CCA56F', accent: '#91B6A4' },
  { name: '夜色', background: '#171C20', shard: '#80BDAF', accent: '#E6A792', dark: true },
  { name: '晨雾', background: '#F0F5F4', shard: '#92B7C3', accent: '#D5A7AE' },
  { name: '花信', background: '#F8EFF1', shard: '#D18199', accent: '#D5B576' },
  { name: '青瓷', background: '#EEF3EB', shard: '#769A8B', accent: '#D4B787' },
  { name: '海盐', background: '#EDF3F8', shard: '#82A7C7', accent: '#B7A7D8' },
  { name: '月白', background: '#F3F2F8', shard: '#ABA3C9', accent: '#C9AD93' },
  { name: '暮霞', background: '#2B2028', shard: '#E1A099', accent: '#BDB2D4', dark: true },
  { name: '星河', background: '#171E2D', shard: '#98AADB', accent: '#B8D7C7', dark: true }
];

class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function AeroPreview() {
  const [flow, setFlow] = useState('stream');
  const [material, setMaterial] = useState('pearl');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const reportFailure = useCallback(() => setFailed(true), []);
  const palette = palettes[paletteIndex];
  const retry = () => { setFailed(false); setAttempt(value => value + 1); };
  const dark = Boolean(palette.dark);

  return <main className={`aero-preview${dark ? ' aero-preview--dark' : ''}`} style={{ backgroundColor: palette.background }}>
    <div className="aero-preview__scene" role="img" aria-label="流动的珍珠光泽立体碎片">
      <SceneBoundary key={attempt} onError={reportFailure}>
        <AeroShards backgroundColor={palette.background} shardColor={palette.shard} accentColor={palette.accent}
          flow={flow} material={material} paused={paused} density={1.3} bloom={0.55} grain={0.025} chromaticAberration={0.0015}
          onError={reportFailure} />
      </SceneBoundary>
    </div>
    <header className="aero-preview__header">
      <a href="/" className="aero-preview__back" title="返回小屋"><ArrowLeft size={18} /><span>返回小屋</span></a>
      <h1>AeroShards</h1>
    </header>
    {!failed && <span className="aero-preview__loading" role="status"><LoaderCircle size={20} className="spin" /><span>正在加载</span></span>}
    {failed && <div className="aero-preview__error" role="alert">
      <h2>暂时无法显示这个效果</h2>
      <p>需要支持 WebGPU 的浏览器与可用的图形加速。</p>
      <button onClick={retry}><RotateCcw size={17} />重试</button>
    </div>}
    <div className="aero-preview__toolbar" aria-label="效果设置">
      <div className="aero-preview__modes" role="group" aria-label="流动形态">
        {[['stream', '流动'], ['vortex', '旋涡'], ['ribbon', '丝带']].map(([value, label]) =>
          <button key={value} aria-pressed={flow === value} onClick={() => setFlow(value)}>{label}</button>)}
      </div>
      <label className="aero-preview__material"><span>材质</span><select aria-label="材质" value={material} onChange={event => setMaterial(event.target.value)}>
        <option value="pearl">珍珠</option><option value="chrome">铬金属</option><option value="satin">缎面</option>
      </select></label>
      <div className="aero-preview__palette">
        <output className="aero-preview__palette-name" aria-live="polite">{palette.name}</output>
        <div className="aero-preview__swatches" role="group" aria-label="配色">
          {palettes.map((item, index) => <button key={item.name} className="aero-preview__swatch"
            style={{ '--swatch': item.shard, '--swatch-background': item.background }} title={item.name}
            aria-label={`${item.name}配色`} aria-pressed={index === paletteIndex} onClick={() => setPaletteIndex(index)} />)}
        </div>
      </div>
      <button className="aero-preview__icon" aria-label={paused ? '播放动画' : '暂停动画'} title={paused ? '播放动画' : '暂停动画'} onClick={() => setPaused(value => !value)}>
        {paused ? <Play size={18} /> : <Pause size={18} />}
      </button>
    </div>
  </main>;
}
