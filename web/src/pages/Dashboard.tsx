import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Topbar } from '../components/Topbar';
import { useAuth } from '../hooks/useAuth';
import { DashRow, loadDraftRows, loadLeagueRows, loadWatchedRows, type RowData } from '../components/DashRows';
import { draftCreds, removeWatched, watchedList } from '../lib/creds';

export function Dashboard() {
  const { realUser, ownerOk, ready } = useAuth();
  const [drafts, setDrafts] = useState<RowData[] | null>(null);
  const [leagues, setLeagues] = useState<RowData[]>([]);
  const [watched, setWatched] = useState<RowData[]>([]);

  const reload = useCallback(async () => {
    const uid = realUser?.uid || null;
    const [d, l, w] = await Promise.all([loadDraftRows(uid), loadLeagueRows(uid), loadWatchedRows()]);
    setDrafts(d);
    setLeagues(l);
    setWatched(w.filter((r) => !draftCreds.get(r.id)?.pid));
  }, [realUser]);

  useEffect(() => {
    document.title = 'Dashboard — Rotisserie Draft';
    if (ready) reload();
  }, [ready, reload]);

  const nothingYet = 'No drafts yet. Sign in with Google to see drafts from other devices, or create one below.';

  return (
    <>
      <Topbar title="Rotisserie Draft" sub="Dashboard" />
      <div className="container">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Your drafts</h2>
          {drafts === null
            ? <p className="hint">{realUser || Object.keys(draftCreds.all()).length ? 'Loading…' : nothingYet}</p>
            : drafts.length
              ? drafts.map((r) => <DashRow key={r.id} row={r} />)
              : <p className="hint">{nothingYet}</p>}
        </div>
        {leagues.length > 0 && (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Your Card Blind leagues</h2>
            {leagues.map((r) => <DashRow key={r.id} row={r} />)}
          </div>
        )}
        <div className="panel newcta">
          <Link className="btn btn-cta" to="/new">Start a new draft</Link>
          <Link className="btn" to="/4cb">Card Blind leagues (4CB)</Link>
        </div>
        {(watched.length > 0 || Object.keys(watchedList()).length > 0) && (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Watching</h2>
            {watched.length
              ? watched.map((r) => (
                <DashRow key={r.id} row={r} onUnwatch={(id) => { removeWatched(id); reload(); }} />
              ))
              : <p className="hint">Nothing being watched.</p>}
          </div>
        )}
        <p className="hint" style={{ textAlign: 'center' }}>
          <Link to="/">About</Link> · <Link to="/contact">Contact</Link>
          {ownerOk && <> · <Link to="/admin">Site admin</Link></>}
        </p>
      </div>
    </>
  );
}
