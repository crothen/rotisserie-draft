import { useState } from 'react';
import { useToast, useCopy } from '../components/Toasts';
import { shareOrCopy } from '../components/Topbar';
import { useAuth } from '../hooks/useAuth';
import { settingsOf } from '../lib/draftLogic';
import { cbFormatLabel } from '../lib/cbLogic';
import { draftCreds } from '../lib/creds';
import { removeDraftMembership } from '../lib/membership';
import { auth } from '../lib/firebase';
import { useDraftCtx } from './context';
import { AdminPanel } from './AdminPanel';
import { joinDraft, linkGoogleToSeat, removePlayerFromLobby } from './actions';

export function Lobby() {
  const ctx = useDraftCtx();
  const { draft, draftId, me, api } = ctx;
  const { realUser } = useAuth();
  const toast = useToast();
  const copy = useCopy();
  const [name, setName] = useState('');
  const s = settingsOf(draft);
  const players = Object.entries(draft.players || {})
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const joined = !!me && !!draft.players?.[me];
  const inviteLink = `${location.origin}/?d=${draftId}`;
  const privLink = joined ? `${location.origin}/?d=${draftId}&p=${me}&s=${api.creds?.secret || ''}` : '';

  const join = async () => {
    const n = name.trim();
    if (!n) { toast('Enter a name first', true); return; }
    try {
      const creds = await joinDraft(draftId, n, realUser?.uid || null);
      api.setCreds(creds);
      api.setSeatBound(true);
      toast(`Joined as ${n}.`);
    } catch (e) { toast((e as Error).message, true); }
  };

  const leave = async () => {
    if (!me) return;
    if (!confirm('Leave this draft? Your seat opens up again.')) return;
    try {
      await removePlayerFromLobby(draftId, me, auth.currentUser?.uid || null);
      api.setSeatBound(false);
      api.setCreds(draftCreds.clearSeat(draftId));
      if (realUser && !ctx.amAdmin) await removeDraftMembership(realUser.uid, draftId).catch(() => {});
      toast('You left the draft.');
    } catch (e) { toast((e as Error).message, true); }
  };

  const linkGoogle = async () => {
    try {
      api.setSeatBound(false);
      await linkGoogleToSeat(draftId);
      api.setSeatBound(true);
      toast('Google account linked.');
    } catch (e) {
      if ((e as { code?: string }).code !== 'auth/popup-closed-by-user') toast((e as Error).message, true);
    }
  };

  const togglePush = () => api.togglePush()
    .then(() => toast(api.pushOn ? 'Notifications off.' : 'Notifications enabled.'))
    .catch((e) => toast((e as Error).message, true));

  return (
    <div className="container">
      <div className="lobby-grid">
        <div className="lobby-main">
          <div className="lobby-head">
            <h1>Lobby</h1>
            <span className="lobby-count">{players.length} of {s.players} seats filled</span>
          </div>
          <div className="specs">
            <div><span className="spec-l">Players</span><span className="spec-v">{s.players}</span></div>
            <div><span className="spec-l">Cards each</span><span className="spec-v">{s.totalPicks}</span></div>
            <div><span className="spec-l">Single rounds</span><span className="spec-v">{s.singleRounds}</span></div>
            <div><span className="spec-l">Then</span><span className="spec-v">2 per turn</span></div>
            <div><span className="spec-l">Reminder</span><span className="spec-v">{s.reminderHours ? s.reminderHours + 'h' : 'off'}</span></div>
            {draft.cubeUrl && <div><span className="spec-l">Source</span><span className="spec-v">
              <a href={draft.cubeUrl} target="_blank" rel="noopener noreferrer">cube ↗</a></span></div>}
            {draft.source === 'format' && <div><span className="spec-l">Pool</span>
              <span className="spec-v">All of {cbFormatLabel(draft.format)}</span></div>}
            {!!draft.sets?.length && <div><span className="spec-l">Sets</span>
              <span className="spec-v">{draft.sets.map((x) => x.code.toUpperCase()).join(', ')}</span></div>}
            {draft.rarityCopies && <div><span className="spec-l">Copies (C/U/R/M)</span>
              <span className="spec-v">{draft.rarityCopies.common}/{draft.rarityCopies.uncommon}/{draft.rarityCopies.rare}/{draft.rarityCopies.mythic}</span></div>}
          </div>
          <div className="seats">
            {players.map(([pid, p]) => {
              const isMe = pid === me;
              const sub = [isMe ? 'you' : null, p.bot ? 'bot' : null].filter(Boolean).join(' · ');
              return (
                <div key={pid} className={'seat' + (isMe ? ' me' : '')}>
                  <div className="s-name">{p.name}</div>
                  {sub && <div className="s-sub">{sub}</div>}
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, s.players - players.length) }, (_, i) => (
              <div key={`empty-${i}`} className="seat empty">Open seat</div>
            ))}
          </div>
          <p className="hint">The draft begins when the creator starts it — the seat order is randomized then.</p>

          {ctx.archived ? (
            <p className="hint">This draft is archived — read only.</p>
          ) : !joined ? (
            <div className="joinblock">
              <h2>Take a seat</h2>
              <div className="join-row">
                <input type="text" maxLength={24} placeholder="Your name" value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') join(); }} />
                <button className="btn btn-primary" onClick={join}>Join draft</button>
              </div>
            </div>
          ) : (
            <div className="youblock">
              <div className="you-actions">
                <button className="btn btn-sm" onClick={() => copy(privLink, 'Private link')}>Copy private link</button>
                {!draft.players[me!].uid
                  ? <button className="btn btn-sm" onClick={linkGoogle}>Link Google account</button>
                  : <span className="chip">Google linked</span>}
                <button className="btn btn-sm" onClick={togglePush}>
                  {api.pushOn ? 'Turn notifications off' : 'Enable notifications'}
                </button>
                <button className="btn btn-sm btn-danger" onClick={leave}>Leave draft</button>
              </div>
              <p className="hint">The private link rejoins this draft on any device. With Google linked,
                signing in is enough.</p>
            </div>
          )}

          <div className="inviteblock">
            <h2>Invite players</h2>
            <div className="invite-row">
              <button className="btn btn-primary" onClick={() => copy(inviteLink, 'Invite link')}>Copy invite link</button>
              <button className="btn" onClick={() =>
                shareOrCopy(inviteLink, draft.name, `Join our rotisserie draft "${draft.name}"`, 'Invite link', copy)}>
                Share
              </button>
              <code className="invite-url">{inviteLink}</code>
            </div>
          </div>
        </div>
        {ctx.amAdmin && <aside className="lobby-side"><AdminPanel /></aside>}
      </div>
    </div>
  );
}
