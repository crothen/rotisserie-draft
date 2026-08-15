import { cbRoundPoints, fmtWhen } from '../lib/cbLogic';
import { playerName, useLeagueCtx } from './context';
import { CbDeck } from './DeckRow';
import { MatchRow } from './RoundTab';

export function HistoryTab() {
  const { league, rounds, me } = useLeagueCtx();
  const done = Object.values(rounds)
    .filter((r) => r.status === 'done')
    .sort((a, b) => b.n - a.n);
  if (!done.length) {
    return <div className="panel empty">Finished rounds appear here with their banlist, decks and results.</div>;
  }
  return (
    <>
      {done.map((r) => {
        const pts = cbRoundPoints(r);
        const best = Object.entries(pts).sort((a, b) => b[1] - a[1])[0];
        return (
          <div key={r.n} className="panel">
            <h2 style={{ marginTop: 0 }}>Round {r.n}</h2>
            <p className="hint">
              {r.finishedAt ? `Finished ${fmtWhen(r.finishedAt)}. ` : ''}
              {best
                ? <>Winner: <b>{playerName(league, best[0])}</b> ({best[1]} points).</>
                : 'No matches were played.'}
            </p>
            {(r.bans || []).length > 0 && (
              <div className="field">
                <label>Banned that round</label>
                <div className="chips">{r.bans.map((b) => <span key={b} className="chip">{b}</span>)}</div>
              </div>
            )}
            {Object.entries(r.decks || {}).map(([pid, cards]) => (
              <div key={pid} className="cb-deckrow">
                <div className="cb-deckname">{playerName(league, pid)}<span className="dash-as">{pts[pid] || 0} pts</span></div>
                <CbDeck cards={cards} />
              </div>
            ))}
            {Object.keys(r.matches || {}).length > 0 && (
              <div className="field">
                <label>Results</label>
                {Object.entries(r.matches).map(([mid, m]) => (
                  <MatchRow key={mid} round={r} mid={mid} m={m} mine={m.a === me || m.b === me} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
