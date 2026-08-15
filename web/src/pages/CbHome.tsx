import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { rid } from '../lib/api';
import { Topbar } from '../components/Topbar';
import { googleSignIn, useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toasts';
import { DashRow, loadLeagueRows, type RowData } from '../components/DashRows';
import { CB_FORMATS } from '../lib/cbLogic';
import { leagueCreds } from '../lib/creds';
import { recordLeagueMembership } from '../lib/membership';

export function CbHome() {
  const { realUser, ready } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<RowData[]>([]);
  const [name, setName] = useState('');
  const [handSize, setHandSize] = useState(4);
  const [format, setFormat] = useState('modern');
  const [rounds, setRounds] = useState(3);
  const [maxPlayers, setMaxPlayers] = useState(16);
  const [highlander, setHighlander] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    document.title = 'Card Blind — Rotisserie Draft';
    if (!ready) return;
    let alive = true;
    loadLeagueRows(realUser?.uid || null).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [ready, realUser]);

  const create = async () => {
    if (!realUser) { toast('Please sign in to create a league.', true); return; }
    const leagueName = name.trim();
    if (!leagueName) { toast('Give the league a name first.', true); return; }
    setCreating(true);
    try {
      const leagueId = rid(12);
      await setDoc(doc(db, 'cb-leagues', leagueId), {
        name: leagueName, createdAt: Date.now(),
        adminUid: realUser.uid,
        archived: false,
        status: 'lobby',
        curRound: 0,
        customBans: [],
        settings: {
          handSize: Math.max(2, Math.min(10, handSize || 4)),
          highlander,
          format,
          rounds: Math.max(1, Math.min(50, rounds || 3)),
          maxPlayers: Math.max(2, Math.min(32, maxPlayers || 16)),
        },
        players: {}, uids: {},
      });
      leagueCreds.save(leagueId, { leagueName });
      await recordLeagueMembership(realUser.uid, leagueId, leagueName, 'admin');
      navigate(`/4cb?l=${leagueId}`);
    } catch (e) {
      toast((e as Error).message, true);
      setCreating(false);
    }
  };

  return (
    <>
      <Topbar title="Card Blind" sub="4CB leagues" />
      <div className="container">
        <div className="panel">
          <h1>Four Card Blind</h1>
          <p className="hint">A Magic variant played in leagues. Every round, each player <b>blindly
            submits a tiny deck</b> (classically 4 cards — your whole opening hand, no library).
            When the deadline hits, all decks are revealed and <b>every deck plays every other
            deck</b>: two games, one on the play and one on the draw, resolved by the players —
            both sides play optimally, there is no hidden information and no luck. You report the
            results here; a match is worth up to 6 points (WW 6 · WD 4 · WL/DD 2 ·
            DL 1 · LL 0). Highest total wins the round, the banlist evolves, and the next
            round begins.</p>
          <p className="hint" style={{ marginTop: 10 }}><Link to="/4cb/rules">Read the full format rules →</Link></p>
        </div>
        {rows.length > 0 && (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Your leagues</h2>
            {rows.map((r) => <DashRow key={r.id} row={r} />)}
          </div>
        )}
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Start a league</h2>
          <div className="field"><label>League name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Modern 4CB Autumn League" /></div>
          <div className="row">
            <div className="field"><label>Cards per deck</label>
              <input type="number" min={2} max={10} value={handSize} onChange={(e) => setHandSize(+e.target.value)} /></div>
            <div className="field"><label>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                {CB_FORMATS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select></div>
            <div className="field"><label>Rounds</label>
              <input type="number" min={1} max={50} value={rounds} onChange={(e) => setRounds(+e.target.value)} /></div>
            <div className="field"><label>Max players</label>
              <input type="number" min={2} max={32} value={maxPlayers} onChange={(e) => setMaxPlayers(+e.target.value)} /></div>
          </div>
          <div className="field">
            <label className="checkline" style={{ textTransform: 'none', letterSpacing: 0 }}>
              <input type="checkbox" checked={highlander} onChange={(e) => setHighlander(e.target.checked)} />
              {' '}Highlander — max 1 copy of each card (basic lands excepted)
            </label>
          </div>
          <p className="hint">Cards must be legal in the chosen format. You can add your own bans on
            top at any time — they apply from the next round.</p>
          {realUser
            ? <button className="btn btn-primary btn-block" onClick={create} disabled={creating}>Create league</button>
            : <>
              <p className="hint">Creating a league requires an account, so you can manage it later from any device.</p>
              <button className="btn btn-primary btn-block"
                onClick={() => googleSignIn().catch((e) => toast((e as Error).message, true))}>
                Sign in with Google to create
              </button>
            </>}
        </div>
        <p className="hint" style={{ textAlign: 'center' }}>
          <Link to="/">About</Link> · <Link to="/dashboard">Dashboard</Link> · <Link to="/contact">Contact</Link>
        </p>
      </div>
    </>
  );
}
