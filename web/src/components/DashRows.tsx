// Dashboard / landing rows for drafts and leagues, with their loaders.
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { draftView, settingsOf } from '../lib/draftLogic';
import { cbFormatLabel, cbSettings, fmtLeft } from '../lib/cbLogic';
import { collectDraftEntries, collectLeagueEntries } from '../lib/membership';
import { removeWatched, watchedList } from '../lib/creds';
import type { DraftDoc, LeagueDoc, RoundDoc } from '../lib/types';

export interface RowData {
  id: string;
  sortKey: number;
  at: number;
  action: boolean;         // highlighted (my turn / needs me)
  name: string;
  admin: boolean;
  archivedTag: boolean;
  asLabel: string;         // "as Alice" / "not joined" / "watching"
  status: string;
  meta: string;
  href: string;
  watchMode?: boolean;
}

function draftRow(id: string, d: DraftDoc, opts: { admin?: boolean; pid?: string | null; watchMode?: boolean; realUid?: string | null }): RowData {
  const s = settingsOf(d);
  let pid = opts.pid || null;
  if (!pid && opts.realUid) {
    pid = Object.entries(d.players || {}).find(([, p]) => p.uid === opts.realUid)?.[0] || null;
  }
  const playerNames = Object.values(d.players || {}).map((p) => p.name);
  let statusTxt = '', myTurn = false, sortKey = 0;
  if (d.archived) {
    statusTxt = 'Archived — read only';
    sortKey = 4;
  } else if (d.status === 'lobby') {
    statusTxt = `Lobby — waiting for players (${playerNames.length}/${s.players})`;
    sortKey = 2;
  } else if (d.status === 'done') {
    statusTxt = 'Complete';
    sortKey = 3;
  } else {
    const v = draftView(d);
    const curName = (v.curPid && d.players?.[v.curPid]?.name) || '?';
    myTurn = !!pid && v.curPid === pid;
    statusTxt = `Pick ${v.picks.length + 1}/${v.seq.length} — ${myTurn ? 'YOUR turn' : `${curName}'s turn`}`;
    sortKey = myTurn ? 0 : 1;
  }
  const myName = pid ? d.players?.[pid]?.name : null;
  const meta = [
    `${playerNames.length}/${s.players} players: ${playerNames.join(', ') || '—'}`,
    d.source === 'format' ? `all of ${cbFormatLabel(d.format)}` : '',
    `${s.totalPicks} cards each`,
    `${s.singleRounds} single rounds`,
    s.reminderHours ? `${s.reminderHours}h reminder` : 'no reminder',
  ].filter(Boolean).join(' · ');
  const admin = !!opts.admin || (!!opts.realUid && d.adminUid === opts.realUid);
  return {
    id, sortKey, at: d.createdAt || 0, action: myTurn,
    name: d.name || id,
    admin,
    archivedTag: !!d.archived,
    asLabel: opts.watchMode ? 'watching' : myName ? `as ${myName}` : 'not joined',
    status: statusTxt,
    meta,
    href: opts.watchMode ? `/?d=${id}&w=1` : `/?d=${id}`,
    watchMode: opts.watchMode,
  };
}

function leagueRow(id: string, l: LeagueDoc, round: RoundDoc | null, opts: { admin?: boolean; pid?: string | null; realUid?: string | null }): RowData {
  const s = cbSettings(l);
  let pid = opts.pid || null;
  if (!pid && opts.realUid) {
    pid = Object.entries(l.players || {}).find(([, p]) => p.uid === opts.realUid)?.[0] || null;
  }
  const admin = !!opts.admin || (!!opts.realUid && l.adminUid === opts.realUid);
  let statusTxt = '';
  let action = false;
  let sortKey = 2;
  if (l.archived) {
    statusTxt = 'Archived — read only';
    sortKey = 4;
  } else if (l.status === 'done') {
    statusTxt = `Complete after ${l.curRound} round${l.curRound === 1 ? '' : 's'}`;
    sortKey = 3;
  } else if (!l.curRound) {
    statusTxt = admin ? 'Waiting for you to start round 1' : 'Waiting for the admin to start round 1';
    action = admin;
    sortKey = action ? 0 : 1;
  } else {
    const rn = `Round ${l.curRound}/${s.rounds}`;
    if (!round) statusTxt = rn;
    else if (round.status === 'submission') {
      const mine = pid ? (round.submitted?.[pid] ? 'deck submitted ✓' : 'submit your deck!') : 'submissions open';
      statusTxt = `${rn} — ${mine} Closes in ${fmtLeft(round.deadline)}.`;
      action = !!pid && !round.submitted?.[pid];
    } else if (round.status === 'playing') {
      const myOpen = pid ? Object.values(round.matches || {})
        .filter((m) => (m.a === pid || m.b === pid) && !m.result && !m.reports?.[pid!]).length : 0;
      statusTxt = `${rn} — decks revealed, matches in progress` +
        (myOpen ? ` — report ${myOpen} result${myOpen === 1 ? '' : 's'}!` : '');
      action = myOpen > 0;
    } else {
      statusTxt = `${rn} — round complete` + (admin ? ' — start the next round!' : '');
      action = admin && l.curRound < s.rounds;
    }
    sortKey = action ? 0 : 1;
  }
  const names = Object.values(l.players || {}).map((p) => p.name);
  const meta = [
    `${s.handSize}-card blind · ${cbFormatLabel(s.format)}${s.highlander ? ' · highlander' : ''}`,
    `${names.length}/${s.maxPlayers} players: ${names.join(', ') || '—'}`,
  ].join(' · ');
  const myName = pid ? l.players?.[pid]?.name : null;
  return {
    id, sortKey, at: l.createdAt || 0, action,
    name: l.name || id,
    admin,
    archivedTag: !!l.archived,
    asLabel: myName ? `as ${myName}` : 'not joined',
    status: statusTxt,
    meta,
    href: `/4cb?l=${id}`,
  };
}

const bySort = (a: RowData, b: RowData) => a.sortKey - b.sortKey || b.at - a.at;

export async function loadDraftRows(uid: string | null): Promise<RowData[]> {
  const entries = await collectDraftEntries(uid);
  const rows = await Promise.all(Object.entries(entries).map(async ([id, e]) => {
    try {
      const snap = await getDoc(doc(db, 'rd-drafts', id));
      if (!snap.exists()) return null; // deleted draft — drop silently
      return draftRow(id, snap.data() as DraftDoc, { admin: e.admin, pid: e.pid, realUid: uid });
    } catch { return null; }
  }));
  return rows.filter((r): r is RowData => !!r).sort(bySort);
}

export async function loadWatchedRows(): Promise<RowData[]> {
  const rows = await Promise.all(Object.entries(watchedList()).map(async ([id]) => {
    try {
      const snap = await getDoc(doc(db, 'rd-drafts', id));
      if (!snap.exists()) { removeWatched(id); return null; }
      return draftRow(id, snap.data() as DraftDoc, { watchMode: true });
    } catch { return null; }
  }));
  return rows.filter((r): r is RowData => !!r).sort(bySort);
}

export async function loadLeagueRows(uid: string | null): Promise<RowData[]> {
  const entries = await collectLeagueEntries(uid);
  const rows = await Promise.all(Object.entries(entries).map(async ([id, e]) => {
    try {
      const snap = await getDoc(doc(db, 'cb-leagues', id));
      if (!snap.exists()) return null;
      const l = snap.data() as LeagueDoc;
      let round: RoundDoc | null = null;
      if (l.curRound) {
        try {
          const rs = await getDoc(doc(db, 'cb-leagues', id, 'rounds', String(l.curRound)));
          round = rs.exists() ? (rs.data() as RoundDoc) : null;
        } catch { /* status stays coarse */ }
      }
      return leagueRow(id, l, round, { admin: e.admin, pid: e.pid, realUid: uid });
    } catch { return null; }
  }));
  return rows.filter((r): r is RowData => !!r).sort(bySort);
}

/** Site owner variants: every draft / league in the system. */
export function ownerDraftRow(id: string, d: DraftDoc): RowData {
  return draftRow(id, d, { admin: true });
}
export function ownerLeagueRow(id: string, l: LeagueDoc, round: RoundDoc | null): RowData {
  return leagueRow(id, l, round, { admin: true });
}

export function DashRow({ row, onUnwatch }: { row: RowData; onUnwatch?: (id: string) => void }) {
  return (
    <div className={'dash-row' + (row.action ? ' myturn' : '')}>
      <div className="dash-info">
        <div className="dash-name">
          {row.name}
          {row.admin && <span className="admintag" title="you are the admin">admin</span>}
          {row.archivedTag && <span className="droptag" title="read only">ARCHIVED</span>}
          <span className="dash-as">{row.asLabel}</span>
        </div>
        <div className="dash-status">{row.status}</div>
        <div className="dash-meta">{row.meta}</div>
      </div>
      <a className={'btn btn-sm' + (row.action ? ' btn-primary' : '')} href={row.href}>
        {row.watchMode ? 'Watch' : 'Open'}
      </a>
      {row.watchMode && onUnwatch && (
        <button className="btn btn-sm" title="Remove from watching" onClick={() => onUnwatch(row.id)}>✕</button>
      )}
    </div>
  );
}
