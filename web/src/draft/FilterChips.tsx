import { ManaSymbol } from '../components/ManaCost';
import { COLOR_KEYS, COLOR_TITLES, TYPE_FILTERS, type PoolFilters } from './filters';

export function ColorChips({ filters, onToggle }: { filters: PoolFilters; onToggle: (c: string) => void }) {
  return (
    <>
      {COLOR_KEYS.map((c) => (
        <button
          key={c}
          className={'mini-chip' + (filters.colors.has(c) ? ' active' : '')}
          title={COLOR_TITLES[c]}
          onClick={() => onToggle(c)}
        >
          {c === 'M' ? 'M' : <ManaSymbol code={c} cls="ms msf" />}
        </button>
      ))}
    </>
  );
}

export function TypeChips({ filters, onToggle }: { filters: PoolFilters; onToggle: (t: string) => void }) {
  return (
    <>
      {TYPE_FILTERS.map((t) => (
        <button
          key={t}
          className={'mini-chip' + (filters.types.has(t) ? ' active' : '')}
          onClick={() => onToggle(t)}
        >
          {t}
        </button>
      ))}
    </>
  );
}
