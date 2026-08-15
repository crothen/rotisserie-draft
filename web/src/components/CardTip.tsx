// Shared floating card-image preview on hover (desktop only). One
// instance lives at the app root; consumers spread {...cardHover(img)}
// onto any element.
import { createContext, useContext, useRef, type ReactNode } from 'react';

interface TipApi {
  show: (img: string) => void;
  move: (x: number, y: number) => void;
  hide: () => void;
}

const TipContext = createContext<TipApi>({ show: () => {}, move: () => {}, hide: () => {} });

export function CardTipProvider({ children }: { children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const api: TipApi = {
    show(img) {
      if (!el.current) return;
      el.current.innerHTML = `<img src="${img.replace(/"/g, '&quot;')}" alt="">`;
      el.current.style.display = 'block';
    },
    move(cx, cy) {
      if (!el.current) return;
      const w = 240, h = 335;
      let x = cx + 16;
      let y = cy - h / 2;
      if (x + w > innerWidth - 8) x = cx - w - 16;
      y = Math.max(8, Math.min(y, innerHeight - h - 8));
      el.current.style.left = x + 'px';
      el.current.style.top = y + 'px';
    },
    hide() {
      if (!el.current) return;
      el.current.style.display = 'none';
      el.current.innerHTML = '';
    },
  };
  return (
    <TipContext.Provider value={api}>
      {children}
      <div id="card-tip" ref={el} />
    </TipContext.Provider>
  );
}

const canHover = () => matchMedia('(hover: hover)').matches;

/** Event props for a hoverable card element. */
export function useCardHover() {
  const tip = useContext(TipContext);
  return (img: string | null | undefined) => {
    if (!img || !canHover()) return {};
    return {
      onMouseEnter: () => tip.show(img),
      onMouseMove: (e: React.MouseEvent) => tip.move(e.clientX, e.clientY),
      onMouseLeave: () => tip.hide(),
    };
  };
}

export const useCardTip = () => useContext(TipContext);
