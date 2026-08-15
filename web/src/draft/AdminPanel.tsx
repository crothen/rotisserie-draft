// Draft admin controls (lobby aside + Admin tab share this component).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCopy, useToast } from '../components/Toasts';
import { settingsOf } from '../lib/draftLogic';
import { draftCreds } from '../lib/creds';
import { removeDraftMembership } from '../lib/membership';
import { useAuth } from '../hooks/useAuth';
import { useDraftCtx } from './context';
import { PlayerTags } from './PlayerTags';
import {
  addBot, deleteDraftFully, fetchSeatSecrets, pingPlayer, removePlayerFromLobby,
  saveDraftSettings, setPlayerFlag, setReminderHours, startDraft, toggleArchive,
} from './actions';

export function AdminPanel() {
  const ctx = useDraftCtx();
  const { draft, draftId, v, amAdmin } = ctx;
  const { realUser } = useAuth();
  const toast = useToast();
  const copy = useCopy();
  const navigate = useNavigate();
  const s = settingsOf(draft);
  const players = Object.entries(draft.players || {});
  const inLobby = draft.status === 'lobby';
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  // settings form (lobby)
  const [name, setName] = useState(draft.name || '');
  const [nPlayers, setNPlayers] = useState(s.players);
  const [nTotal, setNTotal] = useState(s.totalPicks);
  const [nSingle, setNSingle] = useState(s.singleRounds);
  const [nRemind, setNRemind] = useState(s.reminderHours);

  useEffect(() => {
    if (!amAdmin) return;
    fetchSeatSecrets(draftId).then(setSecrets).catch(() => {});
  }, [draftId, amAdmin, players.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!amAdmin) return null;

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    fn().then(() => { if (ok) toast(ok); }).catch((e) => toast((e as Error).message, true));

  // stable ordering: seat order once drafting, join order in the lobby
  const seatOrder = draft.order || [];
  const sorted = [...players].sort((a, b) => {
    const ia = seatOrder.indexOf(a[0]);
    const ib = seatOrder.indexOf(b[0]);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    return (a[1].joinedAt || 0) - (b[1].joinedAt || 0);
  });

  const doStart = () => {
    if (players.length < s.players &&
      !confirm(`Only ${players.length} of ${s.players} seats are filled. Start anyway?`)) return;
    run(() => startDraft(draftId), 'Draft started.');
  };

  const doDelete = async () => {
    const nm = draft.name || 'this draft';
    if (!confirm(`Delete "${nm}" and ALL its data — pool, picks, queues, links? This cannot be undone.`)) return;
    try {
      await deleteDraftFully(draftId);
      draftCreds.clearSeat(draftId);
      if (realUser) await removeDraftMembership(realUser.uid, draftId).catch(() => {});
      toast('Draft deleted.');
      navigate('/');
    } catch (e) { toast('Delete failed: ' + (e as Error).message, true); }
  };

  return (
    <div id="admin-panel" className="adminbox">
      <h2>Admin</h2>
      {inLobby ? (
        <div className="adm-section">
          <div className="adm-actions">
            {players.length >= 2 && (
              <button className={'btn btn-sm' + (players.length >= s.players ? ' btn-primary' : '')} onClick={doStart}>
                Start draft ({players.length} players)
              </button>
            )}
            <button className="btn btn-sm" onClick={() =>
              run(async () => { const b = await addBot(draftId, draft); toast(`Bot ${b} joined the table.`); })}>
              Add bot
            </button>
          </div>
          <p className="hint">The draft only starts when you start it — seat order is randomized then.
            Bots pick by CubeCobra ratings on their turn. To administrate from another device,
            sign in there with the same Google account.</p>
        </div>
      ) : (
        <div className="adm-section">
          <div className="adm-actions">
            <button className="btn btn-sm" onClick={() =>
              copy(`${location.origin}/?d=${draftId}&w=1`, 'Watcher link')}>
              Copy watcher link
            </button>
          </div>
          <p className="hint">The watcher link opens a read-only live view for spectators. To
            administrate from another device, sign in there with the same Google account.</p>
        </div>
      )}
      <div className="adm-section">
        <h3>Players</h3>
        <div id="admin-players">
          {sorted.length ? sorted.map(([pid, p]) => {
            const link = `${location.origin}/?d=${draftId}&p=${pid}&s=${secrets[pid] || ''}`;
            const origBot = pid.startsWith('bot-');
            return (
              <div key={pid} className="admin-player">
                <div className="top">
                  <span className="nm">{p.name}<PlayerTags p={p} />{v?.curPid === pid && <span className="dash-as"> turn</span>}</span>
                  {inLobby ? (
                    <>
                      {!p.bot && (
                        <button className="btn btn-sm" onClick={() => copy(link, `${p.name}'s link`)}>Private link</button>
                      )}
                      <button className="btn btn-sm btn-danger" onClick={() => {
                        if (!p.bot && !confirm(`Remove ${p.name} from the draft?`)) return;
                        run(() => removePlayerFromLobby(draftId, pid), `${p.name} removed.`);
                      }}>Remove</button>
                    </>
                  ) : (
                    <>
                      {!origBot && (
                        <>
                          <button className="btn btn-sm" onClick={() => copy(link, `${p.name}'s link`)}>Private link</button>
                          <button className="btn btn-sm" onClick={() => {
                            const msg = prompt(`Push message for ${p.name}:`, `It's your turn, ${p.name}!`);
                            if (msg === null) return;
                            run(() => pingPlayer(draftId, pid, msg), `Pinged ${p.name}`);
                          }}>Ping</button>
                        </>
                      )}
                      {p.dropped
                        ? <button className="btn btn-sm" onClick={() =>
                            run(() => setPlayerFlag(draftId, pid, 'dropped', null), 'Player is back in the draft.')}>Undrop</button>
                        : <button className="btn btn-sm btn-danger" onClick={() => {
                            if (!confirm(`Drop ${p.name}? Their turns will be skipped from now on (their picks stay).`)) return;
                            run(() => setPlayerFlag(draftId, pid, 'dropped', true), `${p.name} dropped.`);
                          }}>Drop</button>}
                      {!origBot && (p.bot
                        ? <button className="btn btn-sm" onClick={() =>
                            run(() => setPlayerFlag(draftId, pid, 'bot', null), 'Player picks for themselves again.')}>Make human</button>
                        : <button className="btn btn-sm" onClick={() => {
                            if (!confirm(`Let a bot draft for ${p.name} from now on?`)) return;
                            run(() => setPlayerFlag(draftId, pid, 'bot', true), `A bot now picks for ${p.name}.`);
                          }}>To bot</button>)}
                    </>
                  )}
                </div>
              </div>
            );
          }) : <p className="hint">Nobody joined yet.</p>}
        </div>
      </div>
      {inLobby ? (
        <div className="adm-section">
          <h3>Settings</h3>
          <div className="field"><label>Draft name</label>
            <input type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="adm-grid">
            <div className="field"><label>Players</label>
              <input type="number" min={2} max={16} value={nPlayers} onChange={(e) => setNPlayers(+e.target.value)} /></div>
            <div className="field"><label>Cards each</label>
              <input type="number" min={4} max={100} value={nTotal} onChange={(e) => setNTotal(+e.target.value)} /></div>
            <div className="field"><label>Single rounds</label>
              <input type="number" min={0} max={100} value={nSingle} onChange={(e) => setNSingle(+e.target.value)} /></div>
            <div className="field"><label>Reminder (h)</label>
              <input type="number" min={0} max={168} value={nRemind} onChange={(e) => setNRemind(+e.target.value)} /></div>
          </div>
          <button className="btn btn-sm" onClick={() =>
            run(() => saveDraftSettings(draftId, draft, {
              name: name.trim() || draft.name,
              players: nPlayers, totalPicks: nTotal,
              singleRounds: Math.max(0, nSingle), reminderHours: Math.max(0, Math.min(168, nRemind)),
            }), 'Settings saved.')}>
            Save settings
          </button>
          <p className="hint">Everyone in the lobby sees these.</p>
        </div>
      ) : (
        <div className="adm-section">
          <h3>Pick reminder</h3>
          <div className="adm-inline">
            <input type="number" className="adm-num" min={0} max={168} value={nRemind}
              onChange={(e) => setNRemind(+e.target.value)} />
            <span className="hint" style={{ margin: 0 }}>hours (0 = off)</span>
            <button className="btn btn-sm" onClick={() =>
              run(() => setReminderHours(draftId, Math.max(0, nRemind)), `Reminder set to ${Math.max(0, nRemind)}h`)}>
              Save
            </button>
          </div>
        </div>
      )}
      <div className="adm-section">
        <div className="adm-actions">
          <button className="btn btn-sm" onClick={() => {
            const archiving = !draft.archived;
            if (archiving && !confirm(`Archive "${draft.name}"? It stays visible to everyone but nothing can be picked, queued or posted anymore.`)) return;
            run(() => toggleArchive(draftId, archiving), archiving ? 'Draft archived (read only).' : 'Draft unarchived.');
          }}>
            {draft.archived ? 'Unarchive draft' : 'Archive draft'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={doDelete}>Delete this draft</button>
        </div>
        <p className="hint">Archiving freezes the draft: it stays visible to everyone but nothing can
          be picked, queued or posted anymore.</p>
        <p className="hint">Removes the pool, all picks, queues, and every link. Cannot be undone.</p>
      </div>
    </div>
  );
}
