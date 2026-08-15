// League admin: round lifecycle, dispute resolution, banlist, players,
// archive/delete. Server-side ops go through the cbRound function.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toasts';
import { cbFormatLabel, cbSettings, toLocalInputValue } from '../lib/cbLogic';
import { leagueCreds } from '../lib/creds';
import type { GameResult, Match } from '../lib/types';
import { playerName, useLeagueCtx } from './context';
import {
  cbRoundOp, kickLeaguePlayer, saveBans, savePlannedRounds,
  setLeagueArchived, setLeaguePlayerDropped,
} from './actions';

export function AdminTab() {
  const { league, leagueId, rounds } = useLeagueCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const s = cbSettings(league);
  const n = league.curRound;
  const round = n ? rounds[n] : null;
  const canStart = !league.archived && league.status !== 'done' && (!n || round?.status === 'done');
  const activePids = Object.entries(league.players || {}).filter(([, p]) => !p.dropped);
  const waiting = round?.status === 'submission'
    ? activePids.filter(([pid]) => !round.submitted?.[pid]) : [];
  const unresolved = round?.status === 'playing'
    ? Object.entries(round.matches || {}).filter(([, m]) => !m.result) : [];

  const [deadline, setDeadline] = useState(() => toLocalInputValue(round?.status === 'submission' ? round.deadline : Date.now() + 3 * 24 * 3600e3));
  const [startDeadline, setStartDeadline] = useState(() => toLocalInputValue(Date.now() + 3 * 24 * 3600e3));
  const [bansText, setBansText] = useState((league.customBans || []).join('\n'));
  const [planned, setPlanned] = useState(s.rounds);

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    fn().then(() => { if (ok) toast(ok); }).catch((e) => toast((e as Error).message, true));

  return (
    <div className="adminbox">
      {round && round.status === 'submission' && (
        <div className="adm-section">
          <h3>Round {n} — submissions</h3>
          <p className="hint">{waiting.length
            ? `Waiting for: ${waiting.map(([, p]) => p.name).join(', ')}`
            : 'Everyone has submitted — you can reveal now.'}</p>
          <div className="adm-inline">
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            <button className="btn btn-sm" onClick={() => {
              const d = deadline ? new Date(deadline).getTime() : 0;
              run(() => cbRoundOp(leagueId, { op: 'deadline', deadline: d }), 'Deadline moved.');
            }}>Move deadline</button>
          </div>
          <div className="adm-actions">
            <button className="btn btn-sm btn-primary" onClick={() => {
              if (waiting.length && !confirm(
                `${waiting.length} player(s) have not submitted and will sit the round out. Reveal anyway?`)) return;
              run(() => cbRoundOp(leagueId, { op: 'reveal', force: waiting.length > 0 }), 'Decks revealed.');
            }}>Reveal decks now</button>
          </div>
        </div>
      )}
      {round && round.status === 'playing' && (
        <div className="adm-section">
          <h3>Round {n} — open matches</h3>
          {unresolved.length
            ? unresolved.map(([mid, m]) => <ResolveRow key={mid} mid={mid} m={m} />)
            : <p className="hint">All results are in.</p>}
        </div>
      )}
      {canStart && (
        <div className="adm-section">
          <h3>Start round {(n || 0) + 1}{(n || 0) + 1 > s.rounds ? ' (extends the league)' : ` of ${s.rounds}`}</h3>
          <p className="hint">The current banlist is snapshotted into the round. Players submit blind
            until the deadline; decks reveal automatically.</p>
          <div className="adm-inline">
            <input type="datetime-local" value={startDeadline} onChange={(e) => setStartDeadline(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => {
              const d = startDeadline ? new Date(startDeadline).getTime() : 0;
              run(() => cbRoundOp(leagueId, { op: 'start', deadline: d }), 'Round started.');
            }}>Start round</button>
          </div>
          {!!n && league.status !== 'done' && (
            <div className="adm-actions">
              <button className="btn btn-sm" onClick={() => {
                if (confirm('Finish the league now? No further rounds can be started.')) {
                  run(() => cbRoundOp(leagueId, { op: 'finish-league' }), 'League finished.');
                }
              }}>Finish the league now</button>
            </div>
          )}
        </div>
      )}
      <div className="adm-section">
        <h3>Banlist</h3>
        <p className="hint">One card per line, on top of {cbFormatLabel(s.format)} legality. Applies
          from the next round (each round keeps the banlist it started with). Classic 4CB bans every
          card of the round winner's deck — add them here.</p>
        <textarea spellCheck={false} style={{ minHeight: 110 }} value={bansText}
          onChange={(e) => setBansText(e.target.value)} />
        <div className="adm-actions">
          <button className="btn btn-sm" onClick={() => {
            const bans = bansText.split('\n').map((x) => x.trim()).filter(Boolean);
            run(() => saveBans(leagueId, bans),
              `Banlist saved (${bans.length} card${bans.length === 1 ? '' : 's'}) — applies from the next round.`);
          }}>Save banlist</button>
        </div>
      </div>
      <div className="adm-section">
        <h3>Settings</h3>
        <p className="hint">{s.handSize}-card blind · {cbFormatLabel(s.format)} ·{' '}
          {s.highlander ? 'highlander' : 'duplicates allowed'} — fixed after creation.</p>
        <div className="adm-inline">
          <label className="hint" style={{ margin: 0 }}>Planned rounds</label>
          <input type="number" className="adm-num" min={n || 1} max={50} value={planned}
            onChange={(e) => setPlanned(+e.target.value)} />
          <button className="btn btn-sm" onClick={() => {
            const v = Math.max(league.curRound || 1, Math.min(50, planned || 1));
            run(() => savePlannedRounds(leagueId, v), `Planned rounds set to ${v}.`);
          }}>Save</button>
        </div>
      </div>
      <div className="adm-section">
        <h3>Players</h3>
        {Object.entries(league.players || {}).length ? Object.entries(league.players || {}).map(([pid, p]) => (
          <div key={pid} className="admin-player">
            <div className="top">
              <span className="nm">{p.name}{p.dropped && <span className="droptag"> DROPPED</span>}</span>
              <span>
                {!league.curRound
                  ? <button className="btn btn-sm" onClick={() => {
                      if (!confirm(`Remove ${p.name} from the league?`)) return;
                      run(() => kickLeaguePlayer(leagueId, league, pid), 'Player removed.');
                    }}>Remove</button>
                  : <button className="btn btn-sm" onClick={() => {
                      const dropping = !p.dropped;
                      run(() => setLeaguePlayerDropped(leagueId, pid, dropping),
                        dropping ? 'Player dropped — they sit out future rounds.' : 'Player is back in.');
                    }}>{p.dropped ? 'Undrop' : 'Drop'}</button>}
              </span>
            </div>
          </div>
        )) : <p className="hint">No players yet.</p>}
      </div>
      <div className="adm-section">
        <h3>Danger zone</h3>
        <div className="adm-actions">
          <button className="btn btn-sm" onClick={() => {
            const archiving = !league.archived;
            if (archiving && !confirm('Archive this league? It becomes read only for everyone.')) return;
            run(() => setLeagueArchived(leagueId, archiving), archiving ? 'League archived.' : 'League unarchived.');
          }}>
            {league.archived ? 'Unarchive league' : 'Archive league (read only)'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => {
            if (!confirm('Delete this league and ALL its rounds, decks and results? This cannot be undone.')) return;
            run(async () => {
              await cbRoundOp(leagueId, { op: 'delete' });
              leagueCreds.clearSeat(leagueId);
              navigate('/4cb');
            }, 'League deleted.');
          }}>Delete league</button>
        </div>
      </div>
    </div>
  );
}

function ResolveRow({ mid, m }: { mid: string; m: Match }) {
  const { league, leagueId } = useLeagueCtx();
  const toast = useToast();
  const [g1, setG1] = useState('');
  const [g2, setG2] = useState('');
  const nameA = playerName(league, m.a);
  const nameB = playerName(league, m.b);

  const resolve = () => {
    if (!g1 || !g2) { toast('Pick a result for both games first.', true); return; }
    cbRoundOp(leagueId, { op: 'resolve', matchId: mid, result: [g1, g2] as GameResult[] })
      .then(() => toast('Result set.'))
      .catch((e) => toast((e as Error).message, true));
  };

  const sel = (gi: number, val: string, set: (v: string) => void) => (
    <select value={val} onChange={(e) => set(e.target.value)}>
      <option value="">Game {gi} ({gi === 1 ? nameA : nameB} on the play)…</option>
      <option value="W">{nameA} won</option>
      <option value="D">Draw</option>
      <option value="L">{nameB} won</option>
    </select>
  );

  return (
    <div className={'cb-match' + (m.disputed ? ' disputed' : '')}>
      <div className="cb-match-head">
        <span className="cb-vs">{nameA} vs {nameB}</span>
        {m.disputed
          ? <span className="droptag">DISPUTED</span>
          : <span className="hint">{Object.keys(m.reports || {}).length}/2 reported</span>}
      </div>
      {m.disputed && (
        <p className="hint">
          {Object.entries(m.reports || {}).map(([pid, rep]) =>
            `${playerName(league, pid)} reported: ${rep.map((g, i) =>
              `G${i + 1} ${g === 'D' ? 'draw' : g === 'W' ? nameA : nameB}`).join(', ')}`).join(' — ')}
        </p>
      )}
      <div className="adm-inline">
        {sel(1, g1, setG1)}
        {sel(2, g2, setG2)}
        <button className="btn btn-sm" onClick={resolve}>Set result</button>
      </div>
    </div>
  );
}
