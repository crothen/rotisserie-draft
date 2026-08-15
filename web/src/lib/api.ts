import { signInAnonymously } from 'firebase/auth';
import { auth } from './firebase';

/** POST to a backend endpoint with the caller's ID token attached. */
export async function apiPost<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.currentUser) headers.Authorization = 'Bearer ' + (await auth.currentUser.getIdToken());
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Request failed');
  return data as T;
}

/** Ensure there is SOME auth session (anonymous if needed). */
export async function ensureAuthed() {
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!;
}

export const rid = (n = 12) => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => chars[b % chars.length]).join('');
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
