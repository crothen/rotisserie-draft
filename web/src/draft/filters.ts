// Shared pool filter state + logic for the Pool and Format Search tabs.
import { useState } from 'react';
import type { PoolCard } from '../lib/types';

export const COLOR_KEYS = ['W', 'U', 'B', 'R', 'G', 'M', 'C'] as const;
export const COLOR_TITLES: Record<string, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolor', C: 'Colorless',
};
export const TYPE_FILTERS = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'];

export interface PoolFilters {
  search: string;
  colors: Set<string>;
  types: Set<string>;
  sets: Set<string>;
  hidePicked: boolean;
  sort: 'pool' | 'name' | 'cmc' | 'color' | 'rating';
}

export function usePoolFilters() {
  const [filters, setFilters] = useState<PoolFilters>({
    search: '', colors: new Set(), types: new Set(), sets: new Set(), hidePicked: false, sort: 'pool',
  });
  const toggle = (key: 'colors' | 'types' | 'sets', value: string) => {
    setFilters((f) => {
      const next = new Set(f[key]);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...f, [key]: next };
    });
  };
  return { filters, setFilters, toggle };
}

/** Color/type matching shared by both pool variants. */
export function matchesFilters(c: PoolCard, f: PoolFilters): boolean {
  if (f.colors.size) {
    const isLand = (c.t || '').includes('Land');
    const cc = c.c || '';
    let ok = false;
    for (const col of f.colors) {
      if (col === 'M' && cc.length > 1) ok = true;
      else if (col === 'C' && !cc.length && !isLand) ok = true;
      else if (cc.includes(col)) ok = true;
    }
    if (!ok) return false;
  }
  if (f.types.size && ![...f.types].some((ty) => (c.t || '').includes(ty))) return false;
  return true;
}
