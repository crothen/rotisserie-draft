// localStorage credential stores. Keys and shapes are shared with the
// pre-React app so existing players keep their seats.

export interface Creds {
  pid?: string;
  secret?: string;
  name?: string;
  draftName?: string;
  leagueName?: string;
}

function store(key: string) {
  const all = (): Record<string, Creds> => {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  };
  return {
    all,
    get: (id: string): Creds | null => all()[id] || null,
    save(id: string, patch: Creds) {
      const a = all();
      a[id] = { ...(a[id] || {}), ...patch };
      localStorage.setItem(key, JSON.stringify(a));
      return a[id];
    },
    clearSeat(id: string) {
      const a = all();
      if (a[id]) {
        delete a[id].pid;
        delete a[id].secret;
        delete a[id].name;
        localStorage.setItem(key, JSON.stringify(a));
      }
      return a[id] || null;
    },
  };
}

/** Rotisserie draft creds: { [draftId]: {pid, secret, name, draftName} } */
export const draftCreds = store('rd_creds');
/** Card Blind league creds: { [leagueId]: {pid, secret, name, leagueName} } */
export const leagueCreds = store('cb_creds');

// ---- watched drafts (observer links) ----
export interface WatchedEntry { name: string; at: number }

export function watchedList(): Record<string, WatchedEntry> {
  try { return JSON.parse(localStorage.getItem('rd_watched') || '{}'); } catch { return {}; }
}
export function saveWatched(draftId: string, name: string) {
  const all = watchedList();
  all[draftId] = { name: name || all[draftId]?.name || '', at: Date.now() };
  localStorage.setItem('rd_watched', JSON.stringify(all));
}
export function removeWatched(draftId: string) {
  const all = watchedList();
  delete all[draftId];
  localStorage.setItem('rd_watched', JSON.stringify(all));
}

// ---- chat read-marker ----
export const chatSeenKey = (draftId: string) => `rd_chatseen_${draftId}`;
