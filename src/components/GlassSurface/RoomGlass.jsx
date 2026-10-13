import { Component } from 'react';
import GlassSurface from './GlassSurface.jsx';
import './RoomGlass.css';

class RoomGlassBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <span className="room-glass-fallback" aria-hidden="true"/> : this.props.children;
  }
}

export default function RoomGlass() {
  return <RoomGlassBoundary><GlassSurface
    width="100%"
    height="100%"
    borderRadius={24}
    distortionScale={-40}
    redOffset={0}
    greenOffset={1.4}
    blueOffset={2.8}
    opacity={0.98}
    blur={4}
    displace={0.3}
    backgroundOpacity={0.2}
    saturation={1.1}
    className="room-hotspot-glass"
  /></RoomGlassBoundary>;
}
