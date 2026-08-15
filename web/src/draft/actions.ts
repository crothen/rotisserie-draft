// Draft actions: join/leave, picks, queue, sideboard, chat, admin ops.
// All writes match the pre-React app byte-for-byte (rules depend on it).
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  runTransaction, setDoc, updateDoc, arrayUnion,
} from 'firebase/firestore';
import { GoogleAuthProvider, linkWithPopup, signInWithPopup } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { apiPost, ensureAuthed, rid } from '../lib/api';
import { draftCreds } from '../lib/creds';
import { settingsOf } from '../lib/draftLogic';
import type { DraftDoc, PlayerInfo, PrivDoc, QueueItem } from '../lib/types';

const dref = (draftId: string) => doc(db, 'rd-drafts', draftId);
const pref = (draftId: string, pid: string) => doc(db, 'rd-drafts', draftId, 'private', pid);

export async function joinDraft(draftId: string, name: string, realUid: string | null) {
  const pid = rid(10);
  const secret = rid(16);
  await ensureAuthed();
  const uid = auth.currentUser!.uid;
  await runTransaction(db, async (t) => {
    const snap = await t.get(dref(draftId));
    const d = snap.data() as DraftDoc | undefined;
    if (!d) throw new Error('Draft not found.');
    if (d.status !== 'lobby') throw new Error('The draft has already started.');
    const players = d.players || {};
    if (Object.keys(players).length >= settingsOf(d).players) throw new Error('The draft is full.');
    if (Object.values(players).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('That name is taken.');
    }
    t.update(dref(draftId), {
      [`players.${pid}`]: { name, uid: realUid, joinedAt: Date.now() },
      [`uids.${uid}`]: pid,
    });
    t.set(pref(draftId, pid), {
      secret, queue: [], pushSubs: [], uid: realUid, uids: { [uid]: true },
    });
  });
  return draftCreds.save(draftId, { pid, secret, name });
}

/** Remove a seat (bot or human) while in the lobby. Transactional so a
 *  removal cannot race the lobby-full auto-start. */
export async function removePlayerFromLobby(draftId: string, pid: string, selfUid: string | null = null) {
  await runTransaction(db, async (t) => {
    const snap = await t.get(dref(draftId));
    const d = snap.data() as DraftDoc | undefined;
    if (!d || d.status !== 'lobby') throw new Error('The draft has already started.');
    if (!d.players?.[pid]) throw new Error('That player already left.');
    const updates: Record<string, unknown> = { [`players.${pid}`]: deleteField() };
    // security rules only let a player touch their own uid binding
    for (const [u, boundPid] of Object.entries(d.uids || {})) {
      if (boundPid === pid && (!selfUid || u === selfUid)) updates[`uids.${u}`] = deleteField();
    }
    t.update(dref(draftId), updates);
  });
  await deleteDoc(pref(draftId, pid));
}

export async function linkGoogleToSeat(draftId: string) {
  await ensureAuthed();
  const provider = new GoogleAuthProvider();
  if (auth.currentUser!.isAnonymous) {
    try {
      // upgrade the anonymous session in place (uid is preserved)
      await linkWithPopup(auth.currentUser!, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        await signInWithPopup(auth, provider); // existing Google user: switch sessions
      } else { throw e; }
    }
  }
  const creds = draftCreds.get(draftId);
  if (creds?.pid) {
    // server persists the Google uid on the seat and binds this session
    await apiPost('/api/rd/claim', { draftId, pid: creds.pid, secret: creds.secret || null });
  }
}

// ---------- picks & queue ----------

export async function pickByIndex(draftId: string, cardId: number) {
  await ensureAuthed();
  await apiPost('/api/rd/pick', { draftId, cardId });
}

export async function pickByName(draftId: string, cardName: string) {
  await ensureAuthed();
  return apiPost<{ name?: string }>('/api/rd/pick', { draftId, cardName });
}

export async function addToQueue(draftId: string, me: string, item: QueueItem) {
  await updateDoc(pref(draftId, me), { queue: arrayUnion(item) });
}

export async function setQueue(draftId: string, me: string, queue: QueueItem[]) {
  await updateDoc(pref(draftId, me), { queue });
}

export async function setSideboard(draftId: string, me: string, sideboard: number[]) {
  await updateDoc(pref(draftId, me), { sideboard });
}

export async function sendChatMsg(draftId: string, pid: string, name: string, text: string) {
  await addDoc(collection(db, 'rd-drafts', draftId, 'chat'), {
    pid, name, text, at: Date.now(),
  });
}

// ---------- admin ----------

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Explicit admin action: randomize seats and begin the draft. */
export async function startDraft(draftId: string) {
  await runTransaction(db, async (t) => {
    const snap = await t.get(dref(draftId));
    const cur = snap.data() as DraftDoc | undefined;
    if (!cur || cur.status !== 'lobby') throw new Error('The draft has already started.');
    const pids = Object.keys(cur.players || {});
    if (pids.length < 2) throw new Error('At least 2 players are needed.');
    t.update(dref(draftId), {
      status: 'active',
      order: shuffleArr(pids),
      turnStartedAt: Date.now(),
      startedAt: Date.now(),
    });
  });
}

export async function saveDraftSettings(
  draftId: string, d: DraftDoc,
  input: { name: string; players: number; totalPicks: number; singleRounds: number; reminderHours: number },
) {
  const joined = Object.keys(d.players || {}).length;
  if (input.players < 2 || input.players > 16) throw new Error('Players must be between 2 and 16.');
  if (input.players < joined) throw new Error(`${joined} players have already joined — players cannot be lower than that.`);
  if (input.totalPicks < 4 || input.totalPicks > 100) throw new Error('Cards per player must be between 4 and 100.');
  if (input.singleRounds > input.totalPicks) throw new Error('Single rounds cannot exceed cards per player.');
  if (d.source !== 'format') {
    const poolSnap = await getDoc(doc(db, 'rd-drafts', draftId, 'meta', 'pool'));
    const chunks = poolSnap.exists() ? (poolSnap.data().chunks || 1) : 1;
    const firstLen = poolSnap.exists() ? (poolSnap.data().cards || []).length : 0;
    const poolSize = chunks > 1 ? (chunks - 1) * 500 + firstLen : firstLen;
    if (input.players * input.totalPicks > poolSize) {
      throw new Error(`The pool has ${poolSize} cards but ${input.players} × ${input.totalPicks} picks needs ${input.players * input.totalPicks}.`);
    }
  }
  await updateDoc(dref(draftId), {
    name: input.name,
    settings: {
      players: input.players, totalPicks: input.totalPicks,
      singleRounds: input.singleRounds, reminderHours: input.reminderHours,
    },
  });
  draftCreds.save(draftId, { draftName: input.name });
}

export async function setReminderHours(draftId: string, h: number) {
  await updateDoc(dref(draftId), { 'settings.reminderHours': h });
}

export async function setPlayerFlag(draftId: string, pid: string, field: 'dropped' | 'bot', value: boolean | null) {
  await updateDoc(dref(draftId), {
    [`players.${pid}.${field}`]: value === null ? deleteField() : value,
  });
}

export async function toggleArchive(draftId: string, archiving: boolean) {
  await updateDoc(dref(draftId), {
    archived: archiving ? true : deleteField(),
    archivedAt: archiving ? Date.now() : deleteField(),
  });
}

const BOT_NAMES = ['Silas', 'Urza', 'Mishra', 'Karn', 'Teferi', 'Jhoira', 'Venser', 'Saheeli', 'Tezzeret', 'Daretti', 'Feldon', 'Slobad'];

export async function addBot(draftId: string, d: DraftDoc) {
  const s = settingsOf(d);
  const players = d.players || {};
  if (d.status !== 'lobby') throw new Error('Bots can only be added in the lobby.');
  if (Object.keys(players).length >= s.players) throw new Error('The lobby is already full.');
  const taken = new Set(Object.values(players).map((p) => p.name));
  const base = BOT_NAMES.find((n) => !taken.has(`Bot ${n}`)) || `Bot-${rid(4)}`;
  const pid = 'bot-' + rid(8);
  // private doc first: when the players entry lands, the lobby may
  // fill and the draft starts immediately
  await setDoc(pref(draftId, pid), { secret: rid(16), queue: [], pushSubs: [], bot: true });
  await updateDoc(dref(draftId), {
    [`players.${pid}`]: { name: `Bot ${base}`, uid: null, bot: true, joinedAt: Date.now() },
  });
  return base;
}

export async function pingPlayer(draftId: string, pid: string, message: string) {
  await apiPost('/api/rd/ping', { draftId, pid, message });
}

/** Cascade-delete the draft and everything linked to it. */
export async function deleteDraftFully(draftId: string) {
  for (const sub of ['private', 'chat', 'meta']) {
    const snaps = await getDocs(collection(db, 'rd-drafts', draftId, sub));
    await Promise.all(snaps.docs.map((s) => deleteDoc(s.ref)));
  }
  await deleteDoc(dref(draftId));
}

/** Fetch every seat's rejoin secret (admin: private-link buttons). */
export async function fetchSeatSecrets(draftId: string): Promise<Record<string, string>> {
  const snaps = await getDocs(collection(db, 'rd-drafts', draftId, 'private'));
  const secrets: Record<string, string> = {};
  snaps.forEach((s) => { secrets[s.id] = (s.data() as PrivDoc).secret || ''; });
  return secrets;
}

export function playerTagText(p: PlayerInfo) {
  return { bot: !!p.bot, dropped: !!p.dropped };
}
