// Coordinate the native players without keeping media bytes or login state.
export function createVideoPlaybackCoordinator() {
  const players = new Map(), listeners = new Set();
  let current = null;
  const notify = () => listeners.forEach(listener => listener());
  const stop = player => {
    if (current !== player) return;
    current = null;
    notify();
  };
  return {
    register(player, suspend) {
      players.set(player, suspend);
      return () => { players.delete(player); stop(player); };
    },
    play(player) {
      if (!players.has(player)) return;
      const changed = current !== player;
      current = player;
      // Set the new owner before pausing others: their pause events must not
      // clear the new player's active state.
      for (const [other, suspend] of players) if (other !== player) suspend();
      if (changed) notify();
    },
    stop,
    suspend(player) {
      stop(player);
      players.get(player)?.();
    },
    suspendAll() {
      const changed = current !== null;
      current = null;
      for (const suspend of players.values()) suspend();
      if (changed) notify();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    isPlaying: () => current !== null
  };
}

export const videoPlayback = createVideoPlaybackCoordinator();
