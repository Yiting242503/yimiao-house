import { Component } from 'react';
import BorderGlow from './BorderGlow.jsx';
import './AlbumBorder.css';

class AlbumBorderBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.children : this.props.effect; }
}

export default function AlbumBorder({ children }) {
  return <AlbumBorderBoundary effect={<BorderGlow
    className="album-border-glow"
    backgroundColor="#fffdf8"
    borderRadius={5}
    glowColor="32 70 55"
    colors={['#D59C50', '#C08B93', '#88A794']}
    edgeSensitivity={30}
    glowRadius={20}
    glowIntensity={1.2}
    coneSpread={25}
    fillOpacity={0.12}
    animated={false}
  >{children}</BorderGlow>}>{children}</AlbumBorderBoundary>;
}
