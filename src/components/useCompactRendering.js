import { useEffect, useState } from 'react';

const query = '(max-width: 760px), (pointer: coarse)';

export default function useCompactRendering() {
  const [compact, setCompact] = useState(() => Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setCompact(media.matches);
    update();media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return compact;
}
