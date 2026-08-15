import { useEffect, useState } from 'react';

/** Re-render every `ms` to keep countdown labels fresh. */
export function useTicker(ms = 60_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
