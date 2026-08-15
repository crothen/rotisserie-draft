// The live draft overview table: rows = pick slots, columns = players.
import { useState } from 'react';
import { useCardHover } from '../components/CardTip';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { PlayerTags } from './PlayerTags';

export function GridTab() {
  const { draft, pool, v } = useDraftCtx();
  const { openCardModal } = useCardModals();
  const hover = useCardHover();
  const [mode, setMode] = useState<'names' | 'images'>('names');

  const n = v.order.length;
  // grid[playerIdx][slot] = global pick index in the draft sequence
  const grid: number[][] = v.order.map(() => []);
  const cnt = Array(n).fill(0);
  v.seq.forEach((pi, g) => { grid[pi][cnt[pi]++] = g; });
  const curG = v.picks.length;
  const curPi = curG < v.seq.length ? v.seq[curG] : -1;

  const rows = [];
  for (let slot = 0; slot < v.s.totalPicks; slot++) {
    const isDbl = slot >= v.s.singleRounds;
    const pairFirst = isDbl && (slot - v.s.singleRounds) % 2 === 0;
    const round = isDbl ? v.s.singleRounds + Math.floor((slot - v.s.singleRounds) / 2) : slot;
    const dir = round % 2 === 0 ? '→' : '←';
    const cells = v.order.map((pid, pi) => {
      const g = grid[pi][slot];
      if (g == null) return <td key={pid} className="gcell empty">—</td>;
      const pick = v.picks[g];
      if (pick?.skip) return <td key={pid} className="gcell skipped" title={`pick ${g + 1}: skipped`}>skip</td>;
      const cls = ['gcell'];
      if (g === curG) cls.push('cur');
      else if (!pick && curG < v.seq.length && v.seq[g] === v.seq[curG] &&
        g === curG + 1 && v.seq[curG + 1] === v.seq[curG]) cls.push('cur2');
      if (!pick) {
        return <td key={pid} className={cls.join(' ')} title={`pick ${g + 1} of ${v.seq.length}`}>{g === curG ? '▸' : '·'}</td>;
      }
      cls.push('filled');
      const pc = pool[pick.c];
      return (
        <td
          key={pid}
          className={cls.join(' ')}
          title={`pick ${g + 1}: ${pick.n}`}
          onClick={() => openCardModal(pick.c)}
          {...hover(pc?.img)}
        >
          {mode === 'images' && pc?.img
            ? <img className="gimg" loading="lazy" src={pc.img} alt={pick.n} />
            : <>{pick.n}{pick.auto && <span className="automark" title="auto pick"> A</span>}</>}
        </td>
      );
    });
    rows.push(
      <tr key={slot} className={isDbl ? (pairFirst ? 'dbl-a' : 'dbl-b') : ''}>
        <td className="rowlbl">{slot + 1} <span className="dir">{dir}</span>{pairFirst && <span className="x2">×2</span>}</td>
        {cells}
      </tr>,
    );
  }

  return (
    <>
      <div className="row2" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="viewtoggle">
          <button className={'mini-chip' + (mode === 'names' ? ' active' : '')} onClick={() => setMode('names')}>Names</button>
          <button className={'mini-chip' + (mode === 'images' ? ' active' : '')} onClick={() => setMode('images')}>Images</button>
        </div>
        <span className="hint" style={{ margin: 0 }}>
          Snake order top to bottom{v.s.singleRounds ? `, rows ${v.s.singleRounds + 1}+ take 2 cards per turn` : ''}.{' '}
          {matchMedia('(hover: hover)').matches ? 'Hover a card for its image, click for details.' : 'Tap a card to see it.'}
        </span>
      </div>
      <div className="grid-wrap" id="grid-wrap">
        <table className={'pick-grid' + (mode === 'images' ? ' img-mode' : '')}>
          <thead><tr>
            <th className="rowlbl">#</th>
            {v.order.map((pid, pi) => (
              <th key={pid} className={pi === curPi ? 'curcol' : ''}>
                {draft.players[pid]?.name || '?'}<PlayerTags p={draft.players[pid] || {}} />
                <div className="thsub">{v.picks.filter((p) => p.p === pid && !p.skip).length}/{v.s.totalPicks}</div>
              </th>
            ))}
          </tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </>
  );
}
