// Per-player deck views: type-grouped list, mana curve, sideboard,
// plain-text export.
import { useEffect, useState } from 'react';
import { ManaCost } from '../components/ManaCost';
import { useToast } from '../components/Toasts';
import type { Pick } from '../lib/types';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { setSideboard } from './actions';
import { PlayerTags } from './PlayerTags';
import { TYPE_FILTERS } from './filters';

type GiPick = Pick & { gi: number };

export function DecksTab() {
  const ctx = useDraftCtx();
  const { draft, pool, v, me, priv, draftId, archived } = ctx;
  const { openCardModal } = useCardModals();
  const toast = useToast();
  const [selPlayer, setSelPlayer] = useState<string>(me || v.order[0]);
  const [view, setView] = useState<'list' | 'curve'>('list');
  const [groupByType, setGroupByType] = useState(true);

  useEffect(() => {
    if (!draft.players[selPlayer]) setSelPlayer(me || v.order[0]);
  }, [draft.players, selPlayer, me, v.order]);

  const own = selPlayer === me;
  const canEdit = own && !archived;
  const sb = own ? new Set(priv?.sideboard || []) : new Set<number>();
  const selPicks: GiPick[] = v.picks.map((p, gi) => ({ ...p, gi })).filter((p) => p.p === selPlayer && !p.skip);
  const mainPicks = selPicks.filter((p) => !sb.has(p.c));
  const sbPicks = selPicks.filter((p) => sb.has(p.c));
  const curve = own && view === 'curve';

  const moveToSb = async (c: number) => {
    const cur = priv?.sideboard || [];
    if (!cur.includes(c)) await setSideboard(draftId, me!, [...cur, c]);
  };
  const moveToMain = async (c: number) => {
    await setSideboard(draftId, me!, (priv?.sideboard || []).filter((x) => x !== c));
  };

  const pickRow = (p: GiPick, toSb: boolean | null) => (
    <div key={p.gi} className="pick-row" onClick={() => openCardModal(p.c)}>
      <span className="num">{p.gi + 1}</span>
      <span>{pool[p.c]?.n || p.n}</span>
      {p.auto && <span className="automark" title="auto-picked from queue">A</span>}
      <span className="mana"><ManaCost cost={pool[p.c]?.m} /></span>
      {canEdit && toSb !== null && (
        <button
          className="btn btn-sm sb-btn"
          title={toSb ? 'Move to sideboard' : 'Move to maindeck'}
          onClick={(e) => {
            e.stopPropagation();
            (toSb ? moveToSb(p.c) : moveToMain(p.c)).catch((err) => toast((err as Error).message, true));
          }}
        >
          {toSb ? 'SB' : 'Main'}
        </button>
      )}
    </div>
  );

  const exportDeck = () => {
    let text = mainPicks.map((p) => p.n).join('\n');
    const sbNames = sbPicks.map((p) => p.n);
    if (sbNames.length) text += '\n\nSideboard:\n' + sbNames.join('\n');
    const playerName = draft.players[selPlayer]?.name || 'deck';
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${playerName.replace(/\W+/g, '_')}_rotisserie.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  let body;
  if (!selPicks.length) {
    body = <div className="empty">No picks yet.</div>;
  } else if (curve) {
    body = (
      <>
        <CurveView picks={mainPicks} />
        {sbPicks.length > 0 && (
          <>
            <h3>Sideboard ({sbPicks.length}) — not in the curve</h3>
            <div className="pick-rows">{sbPicks.map((p) => pickRow(p, canEdit ? false : null))}</div>
          </>
        )}
      </>
    );
  } else {
    let list;
    if (groupByType) {
      const groups: Record<string, GiPick[]> = {};
      for (const p of mainPicks) {
        const t = pool[p.c]?.t || '';
        const g = TYPE_FILTERS.find((ty) => t.includes(ty)) || 'Other';
        (groups[g] ||= []).push(p);
      }
      list = TYPE_FILTERS.concat('Other').filter((g) => groups[g]?.length).map((g) => (
        <div key={g} className="type-group">
          <h3>{g} ({groups[g].length})</h3>
          <div className="pick-rows">
            {groups[g].sort((a, b) => (pool[a.c]?.v || 0) - (pool[b.c]?.v || 0)).map((p) => pickRow(p, canEdit ? true : null))}
          </div>
        </div>
      ));
    } else {
      list = <div className="pick-rows">{mainPicks.map((p) => pickRow(p, canEdit ? true : null))}</div>;
    }
    body = (
      <>
        {list}
        {own && (
          <>
            <h3>Sideboard ({sbPicks.length})</h3>
            <p className="hint">Only you can see your sideboard. Sideboard cards are excluded from the
              mana curve.</p>
            {sbPicks.length
              ? <div className="pick-rows">{sbPicks.map((p) => pickRow(p, canEdit ? false : null))}</div>
              : <p className="hint">Empty — use the SB buttons to move cards here.</p>}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className="chips" style={{ marginBottom: 12 }}>
        {v.order.map((pid) => {
          const count = v.picks.filter((p) => p.p === pid && !p.skip).length;
          const p2 = draft.players[pid] || {};
          return (
            <button
              key={pid}
              className={'chip' + (pid === selPlayer ? ' active' : '') + (pid === v.curPid ? ' turn' : '')}
              onClick={() => setSelPlayer(pid)}
            >
              {p2.name || '?'}<PlayerTags p={p2} /> <span className="cnt">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="row2" style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {own && (
          <div className="viewtoggle">
            <button className={'mini-chip' + (!curve ? ' active' : '')} onClick={() => setView('list')}>List</button>
            <button className={'mini-chip' + (curve ? ' active' : '')} onClick={() => setView('curve')}>Curve</button>
          </div>
        )}
        {!curve && (
          <label className="checkline">
            <input type="checkbox" checked={groupByType} onChange={(e) => setGroupByType(e.target.checked)} />
            {' '}group by type
          </label>
        )}
        <button className="btn btn-sm" onClick={exportDeck}>Export list</button>
      </div>
      {body}
    </>
  );
}

/** Mana curve of the maindeck: columns by mana value, lands separate. */
function CurveView({ picks }: { picks: GiPick[] }) {
  const { pool } = useDraftCtx();
  const { openCardModal } = useCardModals();
  const buckets: GiPick[][] = Array.from({ length: 8 }, () => []);
  const lands: GiPick[] = [];
  for (const p of picks) {
    const c = pool[p.c] || { t: '', v: 0 };
    if ((c.t || '').includes('Land')) { lands.push(p); continue; }
    buckets[Math.min(Math.max(0, Math.round(c.v || 0)), 7)].push(p);
  }
  const col = (label: string, cards: GiPick[]) => (
    <div key={label} className="curve-col">
      <div className="curve-head">{label}<br /><b>{cards.length}</b></div>
      <div className="curve-stack">
        {cards
          .sort((a, b) => (pool[a.c]?.n || '').localeCompare(pool[b.c]?.n || ''))
          .map((p) => {
            const c = pool[p.c] || { n: p.n, img: null };
            return c.img
              ? <img key={p.gi} src={c.img.replace('/normal/', '/small/')} alt={c.n}
                  loading="lazy" onClick={() => openCardModal(p.c)} />
              : <div key={p.gi} className="curve-noimg" onClick={() => openCardModal(p.c)}>{c.n}</div>;
          })}
      </div>
    </div>
  );
  const cols = buckets.map((cards, i) => col(i === 7 ? '7+' : String(i), cards));
  if (lands.length) cols.push(col('Lands', lands));
  return <div className="curve">{cols}</div>;
}
