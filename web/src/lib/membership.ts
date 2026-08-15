// Mirror membership into rd-users/{uid} so the dashboard finds drafts
// and leagues across devices. Safe to call often (merge writes).
import { deleteField, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { draftCreds, leagueCreds } from './creds';
import type { UserDoc } from './types';

export async function recordDraftMembership(uid: string, draftId: string, name: string, role: 'admin' | 'player') {
  try {
    await setDoc(doc(db, 'rd-users', uid), {
      drafts: { [draftId]: { name: name || '', role, at: Date.now() } },
    }, { merge: true });
  } catch (e) { console.warn('recordDraftMembership failed', e); }
}

export async function recordLeagueMembership(uid: string, leagueId: string, name: string, role: 'admin' | 'player') {
  try {
    await setDoc(doc(db, 'rd-users', uid), {
      leagues: { [leagueId]: { name: name || '', role, at: Date.now() } },
    }, { merge: true });
  } catch (e) { console.warn('recordLeagueMembership failed', e); }
}

export async function removeDraftMembership(uid: string, draftId: string) {
  await setDoc(doc(db, 'rd-users', uid), { drafts: { [draftId]: deleteField() } }, { merge: true });
}

export async function removeLeagueMembership(uid: string, leagueId: string) {
  await setDoc(doc(db, 'rd-users', uid), { leagues: { [leagueId]: deleteField() } }, { merge: true });
}

export interface Entry { name: string; admin: boolean; pid: string | null }

async function loadUserDoc(uid: string | null): Promise<UserDoc | null> {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'rd-users', uid));
    return snap.exists() ? (snap.data() as UserDoc) : null;
  } catch (e) {
    console.warn('rd-users load failed', e);
    return null;
  }
}

/** Drafts known to this device (localStorage) merged with the account. */
export async function collectDraftEntries(uid: string | null): Promise<Record<string, Entry>> {
  const entries: Record<string, Entry> = {};
  for (const [id, c] of Object.entries(draftCreds.all())) {
    entries[id] = { name: c.draftName || id, admin: false, pid: c.pid || null };
  }
  const u = await loadUserDoc(uid);
  for (const [id, info] of Object.entries(u?.drafts || {})) {
    entries[id] = {
      name: info.name || entries[id]?.name || id,
      admin: entries[id]?.admin || info.role === 'admin',
      pid: entries[id]?.pid || null,
    };
  }
  return entries;
}

export async function collectLeagueEntries(uid: string | null): Promise<Record<string, Entry>> {
  const entries: Record<string, Entry> = {};
  for (const [id, c] of Object.entries(leagueCreds.all())) {
    entries[id] = { name: c.leagueName || id, admin: false, pid: c.pid || null };
  }
  const u = await loadUserDoc(uid);
  for (const [id, info] of Object.entries(u?.leagues || {})) {
    entries[id] = {
      name: info.name || entries[id]?.name || id,
      admin: entries[id]?.admin || info.role === 'admin',
      pid: entries[id]?.pid || null,
    };
  }
  return entries;
}
