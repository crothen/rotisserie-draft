import { useState } from 'react';
import { useCopy, useToast } from '../components/Toasts';
import { useAuth } from '../hooks/useAuth';
import { cbSettings } from '../lib/cbLogic';
import { leagueCreds } from '../lib/creds';
import { removeLeagueMembership } from '../lib/membership';
import { useLeagueCtx } from './context';
import { joinLeague, leaveLeague, linkGoogleToLeagueSeat } from './actions';

export function PlayersTab() {
  const { league, leagueId, me, amAdmin, api } = useLeagueCtx();
  const { realUser } = useAuth();
  const toast = useToast();
  const copy = useCopy();
  const [name, setName] = useState('');
  const s = cbSettings(league);
  const seats = Object.entries(league.players || {});
  const joined = !!me && !!league.players?.[me];
  const canJoin = !joined && !league.archived && league.status !== 'done' && seats.length < s.maxPlayers;
  const inviteLink = `${location.origin}/4cb?l=${leagueId}`;
  const privLink = joined && api.creds?.secret ? `${inviteLink}&p=${me}&s=${api.creds.secret}` : '';

  const join = async () => {
    const n = name.trim();
    if (!n) { toast('Enter a name first.', true); return; }
    if (n.length > 30) { toast('Keep the name under 30 characters.', true); return; }
    try {
      const creds = await joinLeague(leagueId, n, realUser?.uid || null);
      api.setCreds(creds);
      api.setSeatBound(true);
      toast(`Welcome, ${n}!`);
    } catch (e) { toast((e as Error).message, true); }
  };

  const leave = async () => {
    if (!me) return;
    if (!confirm('Leave this league? Your seat opens up again.')) return;
    try {
      await leaveLeague(leagueId, me);
      api.setSeatBound(false);
      api.setCreds(leagueCreds.clearSeat(leagueId));
      if (realUser && !amAdmin) await removeLeagueMembership(realUser.uid, leagueId).catch(() => {});
      toast('You left the league.');
    } catch (e) { toast((e as Error).message, true); }
  };

  const linkGoogle = async () => {
    try {
      await linkGoogleToLeagueSeat(leagueId);
      toast('Google account linked — you can now rejoin from any device.');
    } catch (e) {
      if ((e as { code?: string }).code !== 'auth/popup-closed-by-user') toast((e as Error).message, true);
    }
  };

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Players ({seats.length}/{s.maxPlayers})</h2>
        {seats.length ? seats.map(([pid, p]) => (
          <div key={pid} className={'seat' + (pid === me ? ' me' : '')}>
            <span>
              {p.name}
              {p.uid && p.uid === league.adminUid && <span className="admintag"> admin</span>}
              {p.dropped && <span className="droptag"> DROPPED</span>}
            </span>
            <span className="hint">joined {new Date(p.joinedAt || 0).toLocaleDateString()}</span>
          </div>
        )) : <p className="hint">Nobody has joined yet.</p>}
      </div>
      {canJoin && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Join this league</h2>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Your name</label>
              <input type="text" maxLength={30} placeholder="Player name" value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') join(); }} />
            </div>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={join}>Join</button>
          </div>
          <p className="hint">No account needed — you get a private rejoin link. Sign in with Google to
            play from any device.</p>
        </div>
      )}
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Links</h2>
        <div className="link-row">
          <span className="lbl">Invite</span><span className="url">{inviteLink}</span>
          <button className="btn btn-sm" onClick={() => copy(inviteLink, 'Invite link')}>Copy</button>
        </div>
        {privLink && (
          <>
            <div className="link-row">
              <span className="lbl">Your rejoin link</span><span className="url">••••••</span>
              <button className="btn btn-sm" onClick={() => copy(privLink, 'Private rejoin link')}>Copy</button>
            </div>
            <p className="hint">The rejoin link restores your seat on another device — keep it to yourself.</p>
          </>
        )}
        {joined && !realUser && <button className="btn btn-sm" onClick={linkGoogle}>Link a Google account</button>}
        {joined && !league.curRound && <button className="btn btn-sm btn-danger" onClick={leave}>Leave the league</button>}
      </div>
    </>
  );
}
