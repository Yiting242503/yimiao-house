import { useEffect, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { RotateCcw, ScanLine, ZoomIn, ZoomOut } from 'lucide-react';
import HoloCard from './HoloCard.jsx';
import './AlbumPhoto.css';

export default function AlbumPhoto({image,alt}) {
  const host=useRef(null),card=useRef(null),zoom=useRef(null),loadFrame=useRef(0);
  const [size,setSize]=useState({width:640,height:460});
  const [scale,setScale]=useState(1);
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{
    const query=window.matchMedia('(prefers-reduced-motion: reduce)');
    const change=event=>setReduced(event.matches);
    query.addEventListener('change',change);
    const observer=new ResizeObserver(([entry])=>{
      const {width,height}=entry.contentRect;
      if(width&&height)setSize({width,height});
    });
    observer.observe(host.current);
    return()=>{observer.disconnect();query.removeEventListener('change',change);cancelAnimationFrame(loadFrame.current);};
  },[]);
  useEffect(()=>{zoom.current?.centerView(1,0);},[size.width,size.height]);
  const duration=reduced?0:160;
  // Wheel deltas are measured in pixels, so trackpad gestures need a small step.
  const reset=()=>zoom.current?.centerView(1,duration);
  const fitWidth=()=>{
    const element=card.current?.querySelector('.holo-card');
    if(!element)return;
    const target=Math.min(20,Math.max(1,(size.width-32)/element.offsetWidth));
    zoom.current?.setTransform((size.width-element.offsetWidth*target)/2,16,target,duration);
  };
  const keys=event=>{
    if(event.target.closest('button'))return;
    if(['+','=','-','0'].includes(event.key)){
      event.preventDefault();event.stopPropagation();
      if(event.key==='0')reset();else if(event.key==='-')zoom.current?.zoomOut(0.25,duration);else zoom.current?.zoomIn(0.25,duration);
    }
  };
  return <div className="zoom-photo-frame" onKeyDownCapture={keys} data-zoom={scale.toFixed(3)}>
    <div ref={host} className="zoom-photo-host" onLoadCapture={()=>{
      cancelAnimationFrame(loadFrame.current);
      loadFrame.current=requestAnimationFrame(()=>zoom.current?.centerView(1,0));
    }}>
      <TransformWrapper ref={zoom} minScale={1} maxScale={20} centerOnInit centerZoomedOut smooth wheel={{step:0.003}} pinch={{step:3.5}} panning={{disabled:scale<=1.001,velocityDisabled:true}} doubleClick={{mode:'toggle',step:1,animationTime:duration}} zoomAnimation={{disabled:true}} velocityAnimation={{disabled:true}} autoAlignment={{animationTime:duration}} onTransform={(_,state)=>setScale(state.scale)}>
        <TransformComponent wrapperClass="zoom-photo-viewport" contentClass="zoom-photo-content">
          <div ref={card} className="zoom-photo-card"><HoloCard image={image} alt={alt} preset="bursts" intensity={0.55} frame={1.4} glare={0.22} edgeSparkle={0.45} tiltMax={8} hoverScale={1.015} radius={8} width={Math.max(1,size.width-40)} maxHeight={Math.max(1,size.height-40)} idle={false} hoverOnly/></div>
        </TransformComponent>
      </TransformWrapper>
    </div>
    <div className="photo-zoom-controls" role="group" aria-label="照片缩放">
      <button className="icon-button" type="button" title="缩小照片" aria-label="缩小照片" disabled={scale<=1.001} onClick={()=>zoom.current?.zoomOut(0.25,duration)}><ZoomOut size={18}/></button>
      <output aria-label="照片缩放比例">{Math.round(scale*100)}%</output>
      <button className="icon-button" type="button" title="放大照片" aria-label="放大照片" disabled={scale>=19.99} onClick={()=>zoom.current?.zoomIn(0.25,duration)}><ZoomIn size={18}/></button>
      <span className="zoom-tool-divider"/>
      <button className="icon-button" type="button" title="适合宽度" aria-label="照片适合宽度" onClick={fitWidth}><ScanLine size={18}/></button>
      <button className="icon-button" type="button" title="还原大小" aria-label="还原照片大小" onClick={reset}><RotateCcw size={18}/></button>
    </div>
  </div>;
}
