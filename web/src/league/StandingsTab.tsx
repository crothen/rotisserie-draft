import { cbLeagueTotals, cbRoundPoints } from '../lib/cbLogic';
import type { RoundDoc } from '../lib/types';
import { playerName, useLeagueCtx } from './context';

/** Single-round points table (also embedded on the Round tab). */
export function RoundTableView({ round }: { round: RoundDoc }) {
  const { league, me } = useLeagueCtx();
  const pts = cbRoundPoints(round);
  const rows = Object.keys(round.decks || {})
    .map((pid) => [pid, pts[pid] || 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <p className="hint">No matches were played.</p>;
  const open = Object.values(round.matches || {}).filter((m) => !m.result).length;
  return (
    <>
      <div className="grid-wrap"><table className="cb-table">
        <thead><tr><th>#</th><th>Player</th><th>Points</th></tr></thead>
        <tbody>
          {rows.map(([pid, p], i) => (
            <tr key={pid} className={pid === me ? 'me' : ''}>
              <td>{i + 1}</td><td>{playerName(league, pid)}</td><td>{p}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {open > 0 && <p className="hint">{open} match{open === 1 ? '' : 'es'} still unreported.</p>}
    </>
  );
}

export function StandingsTab() {
  const { league, rounds, me } = useLeagueCtx();
  const played = Object.values(rounds)
    .filter((r) => r.status !== 'submission')
    .sort((a, b) => a.n - b.n);
  if (!played.length) {
    return <div className="panel empty">Standings appear once the first decks are revealed.</div>;
  }
  const totals = cbLeagueTotals(rounds);
  const pids = new Set(Object.keys(league.players || {}));
  played.forEach((r) => Object.keys(r.decks || {}).forEach((p) => pids.add(p)));
  const rows = [...pids]
    .map((pid) => [pid, totals[pid] || 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>League standings</h2>
      <div className="grid-wrap"><table className="cb-table">
        <thead><tr>
          <th>#</th><th>Player</th>
          {played.map((r) => <th key={r.n} title={`Round ${r.n}`}>R{r.n}</th>)}
          <th>Total</th>
        </tr></thead>
        <tbody>
          {rows.map(([pid, total], i) => (
            <tr key={pid} className={pid === me ? 'me' : ''}>
              <td>{i + 1}</td>
              <td>{playerName(league, pid)}{league.players?.[pid]?.dropped && <span className="droptag"> DROPPED</span>}</td>
              {played.map((r) => (
                <td key={r.n}>{(r.decks || {})[pid] ? (cbRoundPoints(r)[pid] || 0) : '—'}</td>
              ))}
              <td><b>{total}</b></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {played.some((r) => r.status === 'playing') &&
        <p className="hint">Includes the running round — points update as results are confirmed.</p>}
    </div>
  );
}
