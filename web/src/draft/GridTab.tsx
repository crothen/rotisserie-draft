// The live draft overview table: rows = pick slots, columns = players.
// Playback is a purely visual scrubber over the pick sequence: only the
// first `reveal` picks are shown, so a reviewer can walk through the
// draft without spoiling later picks. Nothing is persisted.
import { useEffect, useState } from 'react';
import { useCardHover } from '../components/CardTip';
import { roundStarts } from '../lib/draftLogic';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { PlayerTags } from './PlayerTags';

export function GridTab() {
  const { draft, pool, v } = useDraftCtx();
  const { openCardModal } = useCardModals();
  const hover = useCardHover();
  const [mode, setMode] = useState<'names' | 'images'>('names');
  // null = live view; a number = how many picks are revealed
  const [reveal, setReveal] = useState<number | null>(null);

  const n = v.order.length;
  const made = v.picks.length;
  const playback = reveal != null;
  const shownCount = playback ? Math.min(reveal, made) : made;
  const starts = roundStarts(n, v.s.totalPicks, v.s.singleRounds);
  const clamp = (x: number) => Math.max(0, Math.min(made, x));
  const roundOf = (g: number) => Math.max(0, starts.filter((s) => s <= g).length - 1);
  // ▶▶ reveals the rest of the row that holds the next hidden pick
  // (a fully hidden row gets revealed whole); ◀◀ hides back to the
  // start of the row that holds the last revealed pick.
  const rowEnd = (g: number) => clamp(starts[roundOf(g) + 1] ?? v.seq.length);
  const rowStart = (g: number) => clamp(starts[roundOf(g)] ?? 0);
  const step = (d: number) => setReveal((r) => clamp((r ?? made) + d));
  const jumpFwd = () => setReveal((r) => rowEnd(r ?? made));
  const jumpBack = () => setReveal((r) => rowStart(Math.max(0, (r ?? made) - 1)));

  useEffect(() => {
    if (!playback) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) jumpFwd(); else step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) jumpBack(); else step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback, made, n]);

  // grid[playerIdx][slot] = global pick index in the draft sequence
  const grid: number[][] = v.order.map(() => []);
  const cnt = Array(n).fill(0);
  v.seq.forEach((pi, g) => { grid[pi][cnt[pi]++] = g; });
  // the "current" marker follows the playback position
  const curG = shownCount;
  const curPi = curG < v.seq.length ? v.seq[curG] : -1;
  const visible = (g: number) => g < shownCount;

  const rows = [];
  for (let slot = 0; slot < v.s.totalPicks; slot++) {
    const isDbl = slot >= v.s.singleRounds;
    const pairFirst = isDbl && (slot - v.s.singleRounds) % 2 === 0;
    const round = isDbl ? v.s.singleRounds + Math.floor((slot - v.s.singleRounds) / 2) : slot;
    const dir = round % 2 === 0 ? '→' : '←';
    const cells = v.order.map((pid, pi) => {
      const g = grid[pi][slot];
      if (g == null) return <td key={pid} className="gcell empty">—</td>;
      const pick = visible(g) ? v.picks[g] : undefined;
      if (pick?.skip) return <td key={pid} className="gcell skipped" title={`pick ${g + 1}: skipped`}>skip</td>;
      const cls = ['gcell'];
      if (g === curG) cls.push('cur');
      else if (!pick && curG < v.seq.length && v.seq[g] === v.seq[curG] &&
        g === curG + 1 && v.seq[curG + 1] === v.seq[curG]) cls.push('cur2');
      if (!pick) {
        const hidden = playback && g < made;
        if (hidden) cls.push('hidden');
        return (
          <td key={pid} className={cls.join(' ')} title={`pick ${g + 1} of ${v.seq.length}`}>
            {mode === 'images' && hidden ? <div className="gimg back" /> : g === curG ? '▸' : '·'}
          </td>
        );
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
        {playback ? (
          <div className="playback" title="Playback: ← → step one pick, Shift+← → jump a row">
            <button className="btn" onClick={jumpBack} title="Hide back to the start of this row (Shift+←)">◀◀</button>
            <button className="btn" onClick={() => step(-1)} disabled={shownCount <= 0} title="Hide one pick (←)">◀</button>
            <input
              type="number" min={0} max={made} value={shownCount}
              onChange={(e) => setReveal(clamp(Number(e.target.value) || 0))}
            />
            <span className="of">/ {made}</span>
            <button className="btn" onClick={() => step(1)} disabled={shownCount >= made} title="Reveal one pick (→)">▶</button>
            <button className="btn" onClick={jumpFwd} disabled={shownCount >= made} title="Reveal the rest of this row (Shift+→)">▶▶</button>
            <button className="mini-chip active" onClick={() => setReveal(null)} title="Back to the live view">Live</button>
          </div>
        ) : (
          <button className="mini-chip" onClick={() => setReveal(0)} disabled={!made}
            title="Hide all picks, then reveal them step by step">Playback</button>
        )}
        <span className="hint" style={{ margin: 0 }}>
          {playback
            ? <>Showing the first <b>{shownCount}</b> of {made} picks — only on your screen, nothing changes for others.</>
            : <>Snake order top to bottom{v.s.singleRounds ? `, rows ${v.s.singleRounds + 1}+ take 2 cards per turn` : ''}.{' '}
              {matchMedia('(hover: hover)').matches ? 'Hover a card for its image, click for details.' : 'Tap a card to see it.'}</>}
        </span>
      </div>
      <div className="grid-wrap" id="grid-wrap">
        <table className={'pick-grid' + (mode === 'images' ? ' img-mode' : '')}>
          <thead><tr>
            <th className="rowlbl">#</th>
            {v.order.map((pid, pi) => (
              <th key={pid} className={pi === curPi ? 'curcol' : ''}>
                {draft.players[pid]?.name || '?'}<PlayerTags p={draft.players[pid] || {}} />
                <div className="thsub">
                  {v.picks.filter((p, g) => p.p === pid && !p.skip && visible(g)).length}/{v.s.totalPicks}
                </div>
              </th>
            ))}
          </tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </>
  );
}
