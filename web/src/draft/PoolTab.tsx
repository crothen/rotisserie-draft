// Classic pool browser: full stored pool with filters and sorting.
import { useEffect, useMemo, useState } from 'react';
import { matchesQuery, parseQuery } from '../lib/cardQuery';
import type { PoolCard } from '../lib/types';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { ColorChips, TypeChips } from './FilterChips';
import { matchesFilters, usePoolFilters, type PoolFilters } from './filters';
import { WishHeart } from './WishHeart';

export function PoolTab() {
  const { draft, pool, v, priv } = useDraftCtx();
  const { openCardModal } = useCardModals();
  const { filters, setFilters, toggle } = usePoolFilters();

  // render in pages of 600 — cubes list lands last, so a hard cap hid them
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [filters]);

  const ids = useMemo(() => filterPool(pool, v.pickedIds, filters), [pool, v.pickedIds, filters]);
  const availTotal = pool.length - v.pickedIds.size;
  const queueIds = new Set((priv?.queue || []).filter((i) => !i.tb).map((i) => i.c));
  const shown = ids.slice(0, limit);
  const declaredSets = draft.sets || [];

  return (
    <>
      <div className="pool-controls">
        <div className="row2">
          <input
            type="text" autoComplete="off" spellCheck={false}
            placeholder="Search — Scryfall syntax works (o:flying c:u cmc:2 t:goblin)…" value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          <select value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as PoolFilters['sort'] }))}>
            {([['pool', 'Cube order'], ['name', 'Name'], ['cmc', 'Mana value'], ['color', 'Color'], ['rating', 'Rating']] as const)
              .map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
          </select>
        </div>
        <div className="row2">
          <ColorChips filters={filters} onToggle={(c) => toggle('colors', c)} />
          <label className="checkline">
            <input type="checkbox" checked={filters.hidePicked}
              onChange={(e) => setFilters((f) => ({ ...f, hidePicked: e.target.checked }))} />
            {' '}hide picked
          </label>
        </div>
        <div className="row2">
          <TypeChips filters={filters} onToggle={(t) => toggle('types', t)} />
        </div>
        {declaredSets.length > 1 && (
          <div className="row2">
            {declaredSets.map((st) => (
              <button key={st.code} className={'mini-chip' + (filters.sets.has(st.code) ? ' active' : '')}
                title={st.name} onClick={() => toggle('sets', st.code)}>
                {st.code.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pool-count">
        {ids.length} shown · {availTotal}/{pool.length} still available
      </div>
      <div className="card-grid">
        {shown.map((i) => {
          const c = pool[i];
          const picked = v.pickedIds.has(i);
          const picker = picked ? draft.players[v.picks.find((p) => p.c === i)?.p || '']?.name : null;
          return (
            <div key={i} className={'cardc' + (picked ? ' picked' : '')} onClick={() => openCardModal(i)}>
              {c.img
                ? <img src={c.img.replace('/normal/', '/small/')} alt={c.n} loading="lazy" />
                : <div className="noimg">{c.n}</div>}
              {queueIds.has(i) && !picked && <span className="q-tag" title="in your queue">Q</span>}
              {!picked && <WishHeart card={{ c: i, n: c.n }} />}
              {picked && <span className="picked-tag">{picker || '?'}</span>}
            </div>
          );
        })}
      </div>
      {ids.length > shown.length && (
        <button className="btn btn-block" style={{ marginTop: 10 }}
          onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({ids.length - shown.length} more cards)
        </button>
      )}
    </>
  );
}

const PAGE = 600;

function filterPool(pool: PoolCard[], pickedIds: Set<number>, f: PoolFilters): number[] {
  const terms = parseQuery(f.search);
  const out: number[] = [];
  pool.forEach((c, i) => {
    if (!c) return;
    if (f.hidePicked && pickedIds.has(i)) return;
    if (terms.length && !matchesQuery(c, terms)) return;
    if (!matchesFilters(c, f)) return;
    if (f.sets.size && !f.sets.has(c.s || '')) return;
    out.push(i);
  });
  const by: Record<string, (a: number, b: number) => number> = {
    pool: () => 0,
    name: (a, b) => pool[a].n.localeCompare(pool[b].n),
    cmc: (a, b) => pool[a].v - pool[b].v || pool[a].n.localeCompare(pool[b].n),
    color: (a, b) => (pool[a].c || 'Z').localeCompare(pool[b].c || 'Z') || pool[a].v - pool[b].v,
    rating: (a, b) => (pool[b].e || 0) - (pool[a].e || 0) || pool[a].n.localeCompare(pool[b].n),
  };
  if (f.sort !== 'pool') out.sort(by[f.sort]);
  return out;
}
