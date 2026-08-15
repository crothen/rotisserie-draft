import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { googleSignIn, useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toasts';
import { DashRow, loadDraftRows, loadLeagueRows, type RowData } from '../components/DashRows';
import { draftCreds, leagueCreds } from '../lib/creds';

export function LandingHeader({ page }: { page: 'landing' | 'contact' }) {
  const { realUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const signInOrDash = async () => {
    if (realUser) { navigate('/dashboard'); return; }
    try { await googleSignIn(); } catch (e) { toast((e as Error).message, true); }
  };
  return (
    <header className="landing-header">
      <Link className="wordmark" to="/">Rotisserie Draft</Link>
      <nav className="landing-nav">
        {page === 'landing'
          ? <a href="#" onClick={(e) => { e.preventDefault(); document.getElementById('sec-how')?.scrollIntoView({ behavior: 'smooth' }); }}>How it works</a>
          : <Link to="/">How it works</Link>}
        <Link to="/4cb">Card Blind</Link>
        <Link to="/contact">Contact</Link>
        <button className="btn btn-sm landing-signin" onClick={signInOrDash}>
          {realUser ? 'Dashboard' : 'Sign in'}
        </button>
      </nav>
    </header>
  );
}

export function LandingFooter({ showAbout }: { showAbout?: boolean }) {
  return (
    <footer className="landing-footer">
      <span>Built for slow drafting with friends. No ads. No tracking.</span>
      {showAbout && <Link to="/">About</Link>}
      <Link to="/4cb">Card Blind</Link>
      <Link to="/contact">Contact</Link>
      <Link to="/dashboard">Dashboard</Link>
    </footer>
  );
}

export function Landing() {
  const { realUser, ready } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<RowData[]>([]);
  const signedIn = !!realUser;
  const hasAnything = signedIn ||
    Object.keys(draftCreds.all()).length > 0 || Object.keys(leagueCreds.all()).length > 0;

  useEffect(() => {
    document.title = 'Rotisserie Draft';
    if (!ready || !hasAnything) return;
    let alive = true;
    (async () => {
      const uid = realUser?.uid || null;
      const [drafts, leagues] = await Promise.all([loadDraftRows(uid), loadLeagueRows(uid)]);
      const list = [
        ...drafts.filter((r) => r.sortKey < 3 && !r.archivedTag),
        ...leagues.filter((r) => r.sortKey < 3),
      ].sort((a, b) => a.sortKey - b.sortKey || b.at - a.at).slice(0, 6);
      if (alive) setRows(list);
    })();
    return () => { alive = false; };
  }, [ready, realUser, hasAnything]);

  const signInOrDash = async () => {
    if (realUser) { navigate('/dashboard'); return; }
    try { await googleSignIn(); } catch (e) { toast((e as Error).message, true); }
  };

  return (
    <>
      <LandingHeader page="landing" />
      <div className="landing">
        {rows.length > 0 && (
          <section className="mydrafts" id="landing-drafts">
            <div className="mydrafts-head">
              <span className="eyebrow" style={{ margin: 0 }}>Your ongoing drafts</span>
              <Link to="/dashboard">Dashboard</Link>
            </div>
            <div>{rows.map((r) => <DashRow key={r.id} row={r} />)}</div>
          </section>
        )}
        <section className="hero">
          <p className="eyebrow">A slow draft format for Magic: The Gathering</p>
          <h1>Draft the whole cube.<br />Face up.</h1>
          <p className="lead">The entire card pool is visible to every player. Picks happen one at a
            time in snake order, and a draft runs over hours or days at your own pace. Push
            notifications make sure nobody misses a turn.</p>
          <div className="hero-cta">
            <Link className="btn btn-primary btn-lg" to="/new">Start a draft</Link>
            <button className="btn btn-lg landing-signin" onClick={signInOrDash}>
              {signedIn ? 'Dashboard' : 'Sign in or register'}
            </button>
          </div>
          <p className="finehint">Free and without ads. Creating a draft requires a Google account.
            Players join with a link, no account needed.</p>
        </section>

        <section className="how" id="sec-how">
          <p className="eyebrow">How it works</p>
          <div className="steps2">
            <div className="stepn"><div className="num">01</div><h3>Create a draft</h3>
              <p>Import a cube from <a href="https://cubecobra.com" target="_blank" rel="noopener noreferrer">CubeCobra</a>,
                paste any card list, build a pool from sets — or draft an entire format like Modern or
                Legacy. Choose the number of players, the deck size, and when the draft switches to two
                picks per turn.</p></div>
            <div className="stepn"><div className="num">02</div><h3>Invite your group</h3>
              <p>Share a single link. Everyone chooses a name and receives a private link to
                rejoin, or signs in with Google to switch devices at any time. Once the table is
                full, the creator gets a notification and starts the draft with a randomized
                seat order.</p></div>
            <div className="stepn"><div className="num">03</div><h3>Draft in the open</h3>
              <p>Browse the full pool with filters and card previews, follow every deck as it
                grows, and track the whole draft on a live grid board.</p></div>
            <div className="stepn"><div className="num">04</div><h3>Never miss a turn</h3>
              <p>Receive a push notification when you are up. Queue cards to draft automatically
                while you are away. If another player takes a queued card, the draft pauses and
                waits for your decision. Reminders nudge slow pickers, and bots can fill empty
                seats.</p></div>
          </div>
        </section>

        <LandingFooter />
      </div>
    </>
  );
}
