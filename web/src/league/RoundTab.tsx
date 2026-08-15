// The current round: blind submission form before the reveal, decks +
// matches + result reporting + match notes after.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { useToast } from '../components/Toasts';
import { cbFormatLabel, cbMirror, cbSettings, fmtLeft, fmtWhen } from '../lib/cbLogic';
import { scryfallAutocomplete } from '../lib/scryfall';
import type { GameResult, Match, RoundDoc } from '../lib/types';
import { playerName, useLeagueCtx } from './context';
import { CbDeck } from './DeckRow';
import { reportResult, sendMatchNote, submitDeck } from './actions';
import { RoundTableView } from './StandingsTab';

export function RoundTab() {
  const { league, rounds, amAdmin } = useLeagueCtx();
  const n = league.curRound;
  if (!n) {
    return (
      <div className="panel empty">
        No round has started yet.<br /><br />
        {amAdmin
          ? 'Start round 1 from the Admin tab once everyone has joined.'
          : 'Join from the Players tab — the admin starts round 1 when the table is ready.'}
        <br /><br />
        <Link to="/4cb/rules">Read the format rules</Link>
      </div>
    );
  }
  const round = rounds[n];
  if (!round) return <div className="panel"><p className="hint">Loading round…</p></div>;
  return round.status === 'submission' ? <SubmissionView round={round} /> : <PlayView round={round} />;
}

function SubmissionView({ round }: { round: RoundDoc }) {
  const { league, leagueId, me, amAdmin, api } = useLeagueCtx();
  const toast = useToast();
  const s = cbSettings(league);
  const canPlay = !!me && !!league.players?.[me] && !league.players[me].dropped;
  const mySub = api.priv?.sub?.round === round.n ? api.priv.sub : null;
  const [cards, setCards] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const filledFrom = useRef<number>(-1);

  // (re)fill the inputs from the stored submission when it changes
  useEffect(() => {
    if (filledFrom.current === (mySub?.at || 0)) return;
    filledFrom.current = mySub?.at || 0;
    const names = (mySub?.cards || []).map((c) => c.n);
    while (names.length < s.handSize) names.push('');
    setCards(names.slice(0, s.handSize));
  }, [mySub?.at, s.handSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const activePids = Object.entries(league.players || {}).filter(([, p]) => !p.dropped);
  const bans = round.bans || [];

  const submit = async () => {
    const list = cards.map((c) => c.trim());
    if (list.some((c) => !c)) { toast(`Enter all ${s.handSize} card names first.`, true); return; }
    setSubmitting(true);
    try {
      await submitDeck(leagueId, list);
      toast('Deck submitted!');
    } catch (e) { toast((e as Error).message, true); }
    setSubmitting(false);
  };

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Round {round.n} — deck submission</h2>
        <div className="specs">
          <div><span className="spec-l">Deadline</span>
            <span className="spec-v">{fmtWhen(round.deadline)} ({fmtLeft(round.deadline)} left)</span></div>
          <div><span className="spec-l">Format</span>
            <span className="spec-v">{cbFormatLabel(s.format)}{s.highlander ? ' · highlander' : ''}</span></div>
          <div><span className="spec-l">Deck size</span><span className="spec-v">{s.handSize} cards</span></div>
        </div>
        {bans.length ? (
          <div className="field" style={{ marginTop: 12 }}>
            <label>Banned this round</label>
            <div className="chips">{bans.map((b) => <span key={b} className="chip">{b}</span>)}</div>
          </div>
        ) : <p className="hint">No extra bans this round — format legality applies.</p>}
      </div>
      {canPlay ? (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{mySub ? 'Your submitted deck' : 'Your deck'}</h2>
          {mySub && (
            <>
              <CbDeck cards={mySub.cards} />
              <p className="hint">Submitted {fmtWhen(mySub.at)}. You can change and resubmit until the deadline.
                Nobody — not even the league admin — can see it before the reveal.</p>
            </>
          )}
          {cards.map((v, i) => (
            <div key={i} className="field">
              <label>Card {i + 1}</label>
              <AutocompleteInput
                value={v}
                onValue={(val) => setCards((c) => c.map((x, j) => (j === i ? val : x)))}
                placeholder="Card name…"
                debounceMs={250}
                fetchItems={(q) => scryfallAutocomplete(q).then((names) => names.slice(0, 8).map((n) => ({ name: n })))}
              />
            </div>
          ))}
          <button className="btn btn-primary" disabled={submitting} onClick={submit}>
            {submitting ? 'Checking cards…' : mySub ? 'Resubmit deck' : 'Submit deck'}
          </button>
          <p className="hint">Legality, bans and duplicates are checked when you submit.
            New to the format? <Link to="/4cb/rules">Read the full rules</Link>.</p>
        </div>
      ) : (
        <div className="panel">
          <p className="hint">{me
            ? 'You are sitting this league out.'
            : <>Join from the <a href="#players">Players tab</a> to submit a deck for this round.</>}</p>
        </div>
      )}
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Submissions</h2>
        <div className="chips">
          {activePids.length ? activePids.map(([pid, p]) => (
            <span key={pid} className={'chip' + (round.submitted?.[pid] ? ' active' : '')}>
              {p.name}{round.submitted?.[pid] ? ' ✓' : ''}
            </span>
          )) : <span className="hint">No players yet.</span>}
        </div>
        <p className="hint">Decks are revealed automatically at the deadline
          {amAdmin ? ', or earlier from the Admin tab once everyone has submitted' : ''}.</p>
      </div>
    </>
  );
}

function PlayView({ round }: { round: RoundDoc }) {
  const { league, me } = useLeagueCtx();
  const matches = Object.entries(round.matches || {});
  const myMatches = me ? matches.filter(([, m]) => m.a === me || m.b === me) : [];
  const otherMatches = matches.filter(([mid]) => !myMatches.some(([m2]) => m2 === mid));
  const decks = round.decks || {};
  const sitOut = me && league.players?.[me] && !league.players[me].dropped && !decks[me] && round.status !== 'done';

  return (
    <>
      {round.status === 'done' && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Round {round.n} — complete</h2>
          <RoundTableView round={round} />
        </div>
      )}
      {sitOut && <div className="panel"><p className="hint">You did not submit a deck for this round and sit it out.</p></div>}
      {myMatches.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Your matches</h2>
          {myMatches.map(([mid, m]) => <MatchRow key={mid} round={round} mid={mid} m={m} mine />)}
        </div>
      )}
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Decks</h2>
        {Object.keys(decks).length ? Object.entries(decks).map(([pid, cards]) => (
          <div key={pid} className="cb-deckrow">
            <div className="cb-deckname">{playerName(league, pid)}{pid === me && <span className="dash-as"> (you)</span>}</div>
            <CbDeck cards={cards} />
          </div>
        )) : <p className="hint">No decks were submitted this round.</p>}
      </div>
      {otherMatches.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{myMatches.length ? 'Other matches' : 'Matches'}</h2>
          {otherMatches.map(([mid, m]) => <MatchRow key={mid} round={round} mid={mid} m={m} mine={false} />)}
        </div>
      )}
    </>
  );
}

export function MatchRow({ round, mid, m, mine }: { round: RoundDoc; mid: string; m: Match; mine: boolean }) {
  const { league, amAdmin, api } = useLeagueCtx();
  const chatKey = `${round.n}_${mid}`;
  const chat = api.chats[chatKey];
  const canChat = mine || amAdmin;
  const chatCount = chat?.msgs?.length || 0;
  const [open, setOpen] = useState(false);

  let body: React.ReactNode;
  if (m.result) {
    const aw = m.result.filter((g) => g === 'W').length;
    const bw = m.result.filter((g) => g === 'L').length;
    body = (
      <div className="cb-result">
        <b>{playerName(league, m.a)} {aw}–{bw} {playerName(league, m.b)}</b>
        <span className="dash-as">
          {m.result.map((g, i) =>
            `G${i + 1}: ${g === 'D' ? 'draw' : g === 'W' ? playerName(league, m.a) : playerName(league, m.b)}`).join(' · ')}
        </span>
        <span className="cb-pts">+{m.pts?.[m.a] ?? 0} / +{m.pts?.[m.b] ?? 0} pts</span>
        {m.resolvedBy === 'admin' && <span className="admintag">set by admin</span>}
      </div>
    );
  } else if (mine && round.status === 'playing') {
    body = <ReportWidget round={round} mid={mid} m={m} />;
  } else {
    const reported = Object.keys(m.reports || {}).length;
    body = (
      <p className="hint" style={{ margin: '6px 0 0' }}>
        {m.disputed
          ? '⚠ Conflicting reports — the admin will set the result.'
          : `Waiting for results (${reported}/2 reported).`}
      </p>
    );
  }

  return (
    <div className={'cb-match' + (m.disputed && !m.result ? ' disputed' : '')}>
      <div className="cb-match-head">
        <span className="cb-vs">{playerName(league, m.a)} vs {playerName(league, m.b)}</span>
        {canChat && (
          <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide notes' : `Notes${chatCount ? ` (${chatCount})` : ''}`}
          </button>
        )}
      </div>
      {body}
      {open && canChat && <MatchNotes round={round.n} matchId={mid} chatKey={chatKey} />}
    </div>
  );
}

function ReportWidget({ round, mid, m }: { round: RoundDoc; mid: string; m: Match }) {
  const { league, leagueId, me } = useLeagueCtx();
  const toast = useToast();
  const myRep = me ? m.reports?.[me] || null : null; // stored canonically (a's view)
  const myView = myRep ? (m.a === me ? myRep : cbMirror(myRep)) : null;
  const [sel, setSel] = useState<(GameResult | null)[]>(myView || [null, null]);
  const opp = playerName(league, m.a === me ? m.b : m.a);
  const oppReported = !!m.reports?.[m.a === me ? m.b : m.a];
  const meIsA = m.a === me;

  const send = async () => {
    if (sel.some((g) => !g)) { toast('Pick a result for both games first.', true); return; }
    try {
      await reportResult(leagueId, round.n, mid, sel as GameResult[]);
      toast('Result reported.');
    } catch (e) { toast((e as Error).message, true); }
  };

  return (
    <div className="cb-report">
      {m.disputed && (
        <p className="hint" style={{ color: 'var(--red)' }}>
          ⚠ Your report conflicts with {opp}'s. The admin was notified — you can also amend your report below.
        </p>
      )}
      {[0, 1].map((gi) => (
        <div key={gi} className="cb-game">
          <span className="cb-gamelbl">Game {gi + 1} — you're on the {(gi === 0 ? meIsA : !meIsA) ? 'play' : 'draw'}</span>
          <span className="viewtoggle">
            {([['W', 'Won'], ['D', 'Draw'], ['L', 'Lost']] as [GameResult, string][]).map(([val, lbl]) => (
              <button key={val} className={'mini-chip' + (sel[gi] === val ? ' active' : '')}
                onClick={() => setSel((s) => s.map((x, j) => (j === gi ? val : x)))}>
                {lbl}
              </button>
            ))}
          </span>
        </div>
      ))}
      <div className="adm-inline">
        <button className="btn btn-sm btn-primary" onClick={send}>{myRep ? 'Update report' : 'Report result'}</button>
        {myRep && (
          <span className="hint">
            You reported — {oppReported ? 'reports conflict.' : `waiting for ${opp} to confirm.`}
          </span>
        )}
      </div>
    </div>
  );
}

export function MatchNotes({ round, matchId, chatKey }: { round: number; matchId: string; chatKey: string }) {
  const { leagueId, api } = useLeagueCtx();
  const toast = useToast();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const msgs = api.chats[chatKey]?.msgs || [];

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      await sendMatchNote(leagueId, round, matchId, t);
    } catch (e) { toast((e as Error).message, true); }
  };

  return (
    <div className="cb-chat">
      <div className="cb-chat-msgs" id="cbchat-msgs" ref={listRef}>
        {msgs.length ? msgs.map((mm, i) => (
          <div key={i} className="cb-msg">
            <b>{mm.name}</b> <span className="dash-as">{fmtWhen(mm.at)}</span>
            <div>{mm.text}</div>
          </div>
        )) : <p className="hint">No notes yet. Only the two players and the league admin can read this.</p>}
      </div>
      <div className="cb-chat-send">
        <input
          type="text" maxLength={500} placeholder="Note for this match…" autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <button className="btn btn-sm" onClick={send}>Send</button>
      </div>
    </div>
  );
}
