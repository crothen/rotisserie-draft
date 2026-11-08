// Format drafts: staples browse + Scryfall search over the whole format.
import { useEffect, useMemo, useRef, useState } from 'react';
import { pickedNamesSet } from '../lib/draftLogic';
import { cbFormatLabel } from '../lib/cbLogic';
import { fetchStaples, formatSearch } from '../lib/scryfall';
import type { PoolCard } from '../lib/types';
import { useToast } from '../components/Toasts';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { ColorChips, TypeChips } from './FilterChips';
import { matchesFilters, usePoolFilters } from './filters';
import { WishHeart } from './WishHeart';

export function FormatSearchTab() {
  const { draft, v, priv } = useDraftCtx();
  const { openFormatCardModal } = useCardModals();
  const toast = useToast();
  const { filters, setFilters, toggle } = usePoolFilters();
  const [staples, setStaples] = useState<PoolCard[] | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PoolCard[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const label = cbFormatLabel(draft.format);

  useEffect(() => {
    let alive = true;
    fetchStaples(draft.format || 'modern')
      .then((cards) => { if (alive) setStaples(cards); })
      .catch((e) => { console.warn('staples load failed', e); if (alive) setStaples([]); });
    return () => { alive = false; };
  }, [draft.format]);

  const onSearch = (value: string) => {
    setQ(value);
    clearTimeout(timer.current);
    const query = value.trim();
    if (!query) { setResults(null); setTotal(null); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { cards, total } = await formatSearch(draft.format || 'modern', query);
        setResults(cards);
        setTotal(total);
      } catch (e) {
        setResults([]);
        setTotal(0);
        toast((e as Error).message, true);
      }
      setLoading(false);
    }, 350);
  };

  const searching = !!q.trim();
  const picked = pickedNamesSet(draft);
  const queueNames = new Set((priv?.queue || []).filter((i) => !i.tb).map((i) => (i.n || '').toLowerCase()));
  const base = searching ? (results || []) : (staples || []);
  const filtered = useMemo(() => base.filter((c) => {
    if (filters.hidePicked && picked.has(c.n.toLowerCase())) return false;
    return matchesFilters(c, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [base, filters, draft.picks.length]);
  const shown = filtered.slice(0, 200);

  const pickerOf = (name: string) => {
    const p = v.picks.find((pk) => !pk.skip && pk.n.toLowerCase() === name.toLowerCase());
    return p ? draft.players[p.p]?.name : null;
  };

  let countLine: string;
  if (loading) countLine = 'Searching Scryfall…';
  else if (searching) {
    countLine = `${total ?? filtered.length} match(es) in ${label}` +
      (filtered.length > 200 ? ' · showing the first 200 — refine your search' : '');
  } else {
    countLine = staples === null
      ? 'Loading staples…'
      : `Top ${staples.length} ${label} staples by EDHREC rank — search to reach every legal card`;
  }

  return (
    <>
      <div className="pool-controls">
        <div className="row2">
          <input
            type="text" autoComplete="off" spellCheck={false}
            placeholder={`Search all of ${label} — Scryfall syntax works (t:goblin c:r cmc<3)…`}
            value={q}
            onChange={(e) => onSearch(e.target.value)}
          />
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
      </div>
      <div className="pool-count">{countLine}</div>
      <div className="card-grid">
        {shown.map((c) => {
          const lower = c.n.toLowerCase();
          const isPicked = picked.has(lower);
          return (
            <div key={c.n} className={'cardc' + (isPicked ? ' picked' : '')} onClick={() => openFormatCardModal(c)}>
              {c.img
                ? <img src={c.img.replace('/normal/', '/small/')} alt={c.n} loading="lazy" />
                : <div className="noimg">{c.n}</div>}
              {queueNames.has(lower) && !isPicked && <span className="q-tag" title="in your queue">Q</span>}
              {!isPicked && <WishHeart card={{ c: null, n: c.n, ...(c.img ? { img: c.img } : {}) }} />}
              {isPicked && <span className="picked-tag">{pickerOf(c.n) || '?'}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}
