import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { apiPost } from '../lib/api';
import { Topbar } from '../components/Topbar';
import { googleSignIn, useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toasts';
import { DashRow, ownerDraftRow, ownerLeagueRow, type RowData } from '../components/DashRows';
import type { DraftDoc, LeagueDoc, RoundDoc } from '../lib/types';

interface ContactMsg { id: string; name?: string; email?: string; message: string; at: number }
interface StapleInfo { format: string; count: number; at: number | null }

export function SiteAdmin() {
  const { realUser, ownerOk, ready } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState<[string, number][] | null>(null);
  const [drafts, setDrafts] = useState<RowData[] | null>(null);
  const [leagues, setLeagues] = useState<RowData[] | null>(null);
  const [setsInfo, setSetsInfo] = useState('Loading…');
  const [staples, setStaples] = useState<StapleInfo[] | null>(null);
  const [syncingSets, setSyncingSets] = useState(false);
  const [syncingStaples, setSyncingStaples] = useState(false);
  const [messages, setMessages] = useState<ContactMsg[] | null>(null);

  useEffect(() => { document.title = 'Site admin — Rotisserie Draft'; }, []);

  useEffect(() => {
    if (!ready || !ownerOk) return;
    let alive = true;
    (async () => {
      try {
        const snaps = await getDocs(collection(db, 'rd-drafts'));
        const st = { total: 0, lobby: 0, active: 0, done: 0, players: 0 };
        const rows: RowData[] = [];
        snaps.forEach((snap) => {
          const d = snap.data() as DraftDoc;
          st.total++;
          st[d.status] = (st[d.status] || 0) + 1;
          st.players += Object.keys(d.players || {}).length;
          rows.push(ownerDraftRow(snap.id, d));
        });
        rows.sort((a, b) => a.sortKey - b.sortKey || b.at - a.at);
        if (!alive) return;
        setStats([
          ['Drafts', st.total], ['In lobby', st.lobby], ['Active', st.active],
          ['Finished', st.done], ['Seats taken', st.players],
        ]);
        setDrafts(rows);
      } catch (e) { if (alive) { setDrafts([]); toast((e as Error).message, true); } }

      try {
        const snaps = await getDocs(collection(db, 'cb-leagues'));
        const rows = await Promise.all(snaps.docs.map(async (snap) => {
          const l = snap.data() as LeagueDoc;
          let round: RoundDoc | null = null;
          if (l.curRound) {
            const rs = await getDoc(doc(db, 'cb-leagues', snap.id, 'rounds', String(l.curRound)));
            round = rs.exists() ? (rs.data() as RoundDoc) : null;
          }
          return ownerLeagueRow(snap.id, l, round);
        }));
        rows.sort((a, b) => a.sortKey - b.sortKey || b.at - a.at);
        if (alive) setLeagues(rows);
      } catch (e) { if (alive) { setLeagues([]); toast((e as Error).message, true); } }

      fetch('/api/rd/sets').then((r) => r.json()).then((d) => {
        if (alive) setSetsInfo(`${(d.sets || []).length} sets cached` +
          (d.at ? ` · last synced ${new Date(d.at).toLocaleString()}` : ''));
      }).catch(() => {});
      fetch('/api/rd/staples?meta=1').then((r) => r.json()).then((d) => {
        if (alive) setStaples(d.formats || []);
      }).catch(() => {});
      loadMessages();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ownerOk]);

  const loadMessages = async () => {
    try {
      const { messages } = await apiPost<{ messages: ContactMsg[] }>('/api/rd/inbox', {});
      setMessages(messages);
    } catch (e) { toast((e as Error).message, true); setMessages([]); }
  };

  const syncSets = async () => {
    setSyncingSets(true);
    try {
      const d = await apiPost<{ sets: unknown[]; at: number }>('/api/rd/sets', {});
      setSetsInfo(`${(d.sets || []).length} sets cached · last synced ${new Date(d.at).toLocaleString()}`);
      toast(`Synced ${(d.sets || []).length} sets.`);
    } catch (e) { toast((e as Error).message, true); }
    setSyncingSets(false);
  };

  const syncStaples = async () => {
    setSyncingStaples(true);
    try {
      const d = await apiPost<{ counts: Record<string, number> }>('/api/rd/staples', {});
      toast('Staples synced: ' + Object.entries(d.counts || {}).map(([f, n]) => `${f} ${n}`).join(', '));
      const r = await fetch('/api/rd/staples?meta=1').then((x) => x.json());
      setStaples(r.formats || []);
    } catch (e) { toast((e as Error).message, true); }
    setSyncingStaples(false);
  };

  if (!ownerOk) {
    return (
      <>
        <Topbar title="Rotisserie Draft" sub="Site admin" />
        <div className="container"><div className="panel" style={{ borderBottom: 'none' }}>
          <h1>Site admin</h1>
          <p className="hint">{realUser
            ? 'This account is not the site administrator.'
            : 'Sign in with the administrator account to continue.'}</p>
          {realUser
            ? <Link className="btn" to="/dashboard">Back to the dashboard</Link>
            : <button className="btn btn-primary" onClick={() => googleSignIn().catch((e) => toast((e as Error).message, true))}>
                Sign in with Google
              </button>}
        </div></div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Rotisserie Draft" sub="Site admin" />
      <div className="container">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Overview</h2>
          <div className="specs">
            {stats
              ? stats.map(([l, v]) => <div key={l}><span className="spec-l">{l}</span><span className="spec-v">{v}</span></div>)
              : <p className="hint">Loading…</p>}
          </div>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>All drafts</h2>
          {drafts === null ? <p className="hint">Loading…</p>
            : drafts.length ? drafts.map((r) => <DashRow key={r.id} row={r} />)
            : <p className="hint">No drafts exist yet.</p>}
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>All Card Blind leagues</h2>
          {leagues === null ? <p className="hint">Loading…</p>
            : leagues.length ? leagues.map((r) => <DashRow key={r.id} row={r} />)
            : <p className="hint">No leagues exist yet.</p>}
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Set catalog</h2>
          <p className="hint">{setsInfo}</p>
          <button className="btn btn-sm" onClick={syncSets} disabled={syncingSets}>Sync sets from Scryfall</button>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Format staples</h2>
          <p className="hint">Top ~1000 cards per format by EDHREC rank — the default browse view
            and the bot brain for format drafts. Auto-refreshes when older than 30 days.</p>
          <p className="hint">
            {staples === null ? 'Loading…' : staples.map((f, i) => (
              <span key={f.format}>{i > 0 && ' · '}{f.format}: <b>{f.count}</b>
                {f.at ? ` (${new Date(f.at).toLocaleDateString()})` : ' (never synced)'}</span>
            ))}
          </p>
          <button className="btn btn-sm" onClick={syncStaples} disabled={syncingStaples}>
            {syncingStaples ? 'Syncing… (can take a minute)' : 'Sync staples for all formats'}
          </button>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Contact messages</h2>
          {messages === null ? <p className="hint">Loading…</p>
            : messages.length ? messages.map((m) => (
              <div className="dash-row" key={m.id}>
                <div className="dash-info">
                  <div className="dash-name">{m.name || 'anonymous'}
                    {m.email && <span className="dash-as">{m.email}</span>}
                    <span className="dash-as">{new Date(m.at || 0).toLocaleString()}</span></div>
                  <div className="dash-status" style={{ whiteSpace: 'pre-wrap' }}>{m.message}</div>
                </div>
                <button className="btn btn-sm btn-danger" onClick={async () => {
                  await apiPost('/api/rd/inbox', { op: 'delete', id: m.id });
                  loadMessages();
                }}>✕</button>
              </div>
            ))
            : <p className="hint">No messages.</p>}
        </div>
        <p className="hint" style={{ textAlign: 'center' }}><Link to="/dashboard">Back to the dashboard</Link></p>
      </div>
    </>
  );
}
