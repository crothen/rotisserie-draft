// League actions: join/leave, submissions, reports, notes, admin ops.
import {
  deleteDoc, deleteField, doc, runTransaction, updateDoc,
} from 'firebase/firestore';
import { GoogleAuthProvider, linkWithPopup, signInWithPopup } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { apiPost, ensureAuthed, rid } from '../lib/api';
import { leagueCreds } from '../lib/creds';
import { cbSettings } from '../lib/cbLogic';
import type { GameResult, LeagueDoc } from '../lib/types';

const lref = (leagueId: string) => doc(db, 'cb-leagues', leagueId);

export async function joinLeague(leagueId: string, name: string, realUid: string | null) {
  await ensureAuthed();
  const uid = auth.currentUser!.uid;
  const pid = rid(10);
  const secret = rid(16);
  await runTransaction(db, async (t) => {
    const snap = await t.get(lref(leagueId));
    const l = snap.data() as LeagueDoc | undefined;
    if (!l) throw new Error('League not found');
    if (l.archived) throw new Error('This league is archived');
    if (l.status === 'done') throw new Error('This league is finished');
    const s = cbSettings(l);
    const players = l.players || {};
    if (Object.keys(players).length >= s.maxPlayers) throw new Error('The league is full');
    if (Object.values(players).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('That name is already taken');
    }
    t.update(lref(leagueId), {
      [`players.${pid}`]: { name, uid: realUid, joinedAt: Date.now() },
      [`uids.${uid}`]: pid,
    });
    t.set(doc(db, 'cb-leagues', leagueId, 'private', pid), {
      secret, pushSubs: [], uid: realUid, uids: { [uid]: true },
    });
  });
  return leagueCreds.save(leagueId, { pid, secret, name });
}

export async function leaveLeague(leagueId: string, me: string) {
  await ensureAuthed();
  const uid = auth.currentUser!.uid;
  await runTransaction(db, async (t) => {
    const snap = await t.get(lref(leagueId));
    const l = snap.data() as LeagueDoc | undefined;
    if (!l) throw new Error('League not found');
    if (l.curRound) throw new Error('The league has started — ask the admin to drop you instead.');
    t.update(lref(leagueId), {
      [`players.${me}`]: deleteField(),
      [`uids.${uid}`]: deleteField(),
    });
  });
  await deleteDoc(doc(db, 'cb-leagues', leagueId, 'private', me)).catch(() => {});
}

export async function linkGoogleToLeagueSeat(leagueId: string) {
  await ensureAuthed();
  const provider = new GoogleAuthProvider();
  if (auth.currentUser!.isAnonymous) {
    try {
      await linkWithPopup(auth.currentUser!, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        await signInWithPopup(auth, provider);
      } else { throw e; }
    }
  }
  const creds = leagueCreds.get(leagueId);
  if (creds?.pid) {
    await apiPost('/api/cb/claim', { leagueId, pid: creds.pid, secret: creds.secret || null });
  }
}

export async function submitDeck(leagueId: string, cards: string[]) {
  await ensureAuthed();
  return apiPost<{ cards: { n: string; img: string | null }[] }>('/api/cb/submit', { leagueId, cards });
}

export async function reportResult(leagueId: string, round: number, matchId: string, games: GameResult[]) {
  await ensureAuthed();
  await apiPost('/api/cb/report', { leagueId, round, matchId, games });
}

export async function sendMatchNote(leagueId: string, round: number, matchId: string, text: string) {
  await ensureAuthed();
  await apiPost('/api/cb/chat', { leagueId, round, matchId, text });
}

// ---- admin ops (server-side via cbRound) ----

export async function cbRoundOp(leagueId: string, body: Record<string, unknown>) {
  await ensureAuthed();
  return apiPost('/api/cb/round', { leagueId, ...body });
}

export async function saveBans(leagueId: string, bans: string[]) {
  await updateDoc(lref(leagueId), { customBans: bans });
}

export async function savePlannedRounds(leagueId: string, rounds: number) {
  await updateDoc(lref(leagueId), { 'settings.rounds': rounds });
}

export async function setLeaguePlayerDropped(leagueId: string, pid: string, dropped: boolean) {
  await updateDoc(lref(leagueId), {
    [`players.${pid}.dropped`]: dropped ? true : deleteField(),
  });
}

export async function kickLeaguePlayer(leagueId: string, l: LeagueDoc, pid: string) {
  const upd: Record<string, unknown> = { [`players.${pid}`]: deleteField() };
  for (const [uid, p] of Object.entries(l.uids || {})) {
    if (p === pid) upd[`uids.${uid}`] = deleteField();
  }
  await updateDoc(lref(leagueId), upd);
  await deleteDoc(doc(db, 'cb-leagues', leagueId, 'private', pid)).catch(() => {});
}

export async function setLeagueArchived(leagueId: string, archived: boolean) {
  await updateDoc(lref(leagueId), { archived });
}
