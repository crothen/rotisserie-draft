import { useEffect, useState } from 'react';

/** Tab state routed via location.hash (#pool, #round, …), matching the
 *  pre-React app's URLs. */
export function useHashTab(tabs: string[], fallback: string): [string, (t: string) => void] {
  const initial = () => {
    const h = location.hash.slice(1);
    return tabs.includes(h) ? h : fallback;
  };
  const [tab, setTabState] = useState<string>(initial);
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      if (tabs.includes(h)) setTabState(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.join()]);
  const setTab = (t: string) => {
    setTabState(t);
    if (location.hash !== '#' + t) location.hash = t;
  };
  return [tab, setTab];
}
