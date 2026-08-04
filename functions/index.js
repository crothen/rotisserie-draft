// Cloud Functions for web-sandbox
// Rotisserie Draft: cube proxy, push notifications, auto-queue picks, reminders

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');
const webpush = require('web-push');

initializeApp();
const db = getFirestore();

// SHA-256 of the site owner's Google account email (lowercase).
// The hash identifies the owner without publishing the address.
const OWNER_HASH = '91fa8e4aaa27cba1007cef4cce055e11b2b60e9c651effd795a8a6f5a9a82fc8';

const VAPID_PRIVATE = defineSecret('VAPID_PRIVATE_KEY');
const VAPID_PUBLIC =
  'BBwWu4Duu4THhbcxb1fJofvfaWQgu13WHe6OnvDkHA23yU7fcCfpe-MShsMtsqOc84K_ruonzvVh_Z0M12zsGqY';

let vapidReady = false;
function ensureVapid() {
  if (!vapidReady) {
    webpush.setVapidDetails(
      'https://rotisserie-draft.ch',
      VAPID_PUBLIC,
      VAPID_PRIVATE.value()
    );
    vapidReady = true;
  }
}

// ---------------------------------------------------------------
// Shared draft logic (mirrored in projects/rotisserie/app.js)
// ---------------------------------------------------------------

// Snake order: 1..N, N..1, ... After `singleRounds` rounds each turn
// takes 2 cards, until every player holds `totalPicks` cards.
function buildSeq(n, totalPicks, singleRounds) {
  const seq = [];
  const count = Array(n).fill(0);
  let round = 0;
  while (seq.length < n * totalPicks) {
    const per = round < singleRounds ? 1 : 2;
    const idxs = [...Array(n).keys()];
    if (round % 2 === 1) idxs.reverse();
    for (const i of idxs) {
      for (let k = 0; k < per; k++) {
        if (count[i] < totalPicks) {
          seq.push(i);
          count[i]++;
        }
      }
    }
    round++;
  }
  return seq;
}

function draftSettings(d) {
  const s = d.settings || {};
  return {
    players: s.players || 8,
    totalPicks: s.totalPicks || 40,
    singleRounds: s.singleRounds ?? 20,
    reminderHours: s.reminderHours ?? 24,
  };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function sendPush(draftId, pid, payload) {
  ensureVapid();
  const ref = db.doc(`rd-drafts/${draftId}/private/${pid}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const subs = snap.data().pushSubs || [];
  if (!subs.length) return;
  const dead = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub);
        else console.warn(`push to ${pid} failed:`, e.statusCode || e.message);
      }
    })
  );
  if (dead.length) {
    await ref.update({ pushSubs: subs.filter((s) => !dead.includes(s)) });
  }
}

// Card pools can exceed Firestore's 1MB document limit (set drafts
// with rarity multipliers), so they are stored chunked:
// meta/pool {cards, chunks} plus meta/pool_1, pool_2, …
async function readPool(draftId) {
  const head = await db.doc(`rd-drafts/${draftId}/meta/pool`).get();
  if (!head.exists) return [];
  const data = head.data();
  let cards = data.cards || [];
  for (let i = 1; i < (data.chunks || 1); i++) {
    const part = await db.doc(`rd-drafts/${draftId}/meta/pool_${i}`).get();
    if (part.exists) cards = cards.concat(part.data().cards || []);
  }
  return cards;
}

// ---------------------------------------------------------------
// HTTP: Scryfall set catalog, cached in Firestore. GET returns the
// cache (refreshing when stale/missing); POST with the owner's token
// forces a sync.
// ---------------------------------------------------------------
const SETS_MAX_AGE_MS = 7 * 24 * 3600e3;
const SET_TYPES = new Set([
  'core', 'expansion', 'masters', 'draft_innovation', 'commander',
  'masterpiece', 'remastered', 'starter', 'funny', 'box', 'from_the_vault',
  'premium_deck', 'duel_deck', 'archenemy', 'planechase', 'spellbook',
]);

// Scryfall rejects requests with a default HTTP-library User-Agent.
const SCRYFALL_HEADERS = {
  'User-Agent': 'rotisserie-draft.ch/1.0 (+https://rotisserie-draft.ch)',
  Accept: 'application/json',
};

async function syncSets() {
  const res = await fetch('https://api.scryfall.com/sets', { headers: SCRYFALL_HEADERS });
  if (!res.ok) throw new Error('Scryfall sets error ' + res.status);
  const data = await res.json();
  const sets = (data.data || [])
    .filter((s) => !s.digital && SET_TYPES.has(s.set_type) && (s.card_count || 0) >= 30)
    .map((s) => ({
      code: s.code,
      name: s.name,
      type: s.set_type,
      released: s.released_at || '',
      count: s.card_count || 0,
    }))
    .sort((a, b) => (b.released || '').localeCompare(a.released || ''));
  // the catalog is ~1000 entries; keep it inside one document
  await db.doc('rd-meta/sets').set({ sets, at: Date.now() });
  return sets;
}

exports.rdSets = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method === 'POST') {
      let decoded;
      try { decoded = await requireAuth(req); } catch {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (emailHash(decoded) !== OWNER_HASH) {
        res.status(403).json({ error: 'Not the site administrator' });
        return;
      }
      const sets = await syncSets();
      res.json({ sets, at: Date.now(), synced: true });
      return;
    }
    const snap = await db.doc('rd-meta/sets').get();
    const cached = snap.exists ? snap.data() : null;
    if (cached && Date.now() - (cached.at || 0) < SETS_MAX_AGE_MS) {
      res.json({ sets: cached.sets || [], at: cached.at });
      return;
    }
    const sets = await syncSets();
    res.json({ sets, at: Date.now(), synced: true });
  } catch (e) {
    const snap = await db.doc('rd-meta/sets').get().catch(() => null);
    if (snap?.exists) { res.json({ sets: snap.data().sets || [], at: snap.data().at, stale: true }); return; }
    res.status(502).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// HTTP: CubeCobra proxy (CubeCobra has no CORS headers)
// Returns [{name, elo}] — elo feeds bot picks. Falls back to the
// plain cubelist endpoint (elo 0) if cubeJSON fails.
// ---------------------------------------------------------------
exports.rdFetchCube = onRequest({ cors: true }, async (req, res) => {
  const cube = String(req.query.cube || '').trim();
  if (!/^[\w-]{1,80}$/.test(cube)) {
    res.status(400).json({ error: 'Invalid cube id' });
    return;
  }
  try {
    const r = await fetch(`https://cubecobra.com/cube/api/cubeJSON/${cube}`);
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const main = j?.cards?.mainboard;
      if (Array.isArray(main) && main.length) {
        const cards = main
          .map((c) => ({
            name: c.details?.name || '',
            elo: Math.round(c.details?.elo || 0),
            // cube owner explicitly picked this printing -> Scryfall print id
            customId: c.details?.isDefault === false && c.cardID ? c.cardID : null,
          }))
          .filter((c) => c.name);
        res.json({ cards });
        return;
      }
    }
    const r2 = await fetch(`https://cubecobra.com/cube/api/cubelist/${cube}`);
    if (!r2.ok) {
      res.status(502).json({ error: `CubeCobra returned ${r2.status}` });
      return;
    }
    const text = await r2.text();
    if (text.trim().startsWith('<')) {
      res.status(404).json({ error: 'Cube not found on CubeCobra' });
      return;
    }
    const cards = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, elo: 0 }));
    res.json({ cards });
  } catch (e) {
    res.status(502).json({ error: 'Failed to reach CubeCobra: ' + e.message });
  }
});

// Shared: verify the caller's Firebase ID token.
async function requireAuth(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  return getAuth().verifyIdToken(token);
}
function emailHash(decoded) {
  return crypto.createHash('sha256')
    .update(String(decoded.email || '').toLowerCase()).digest('hex');
}

// ---------------------------------------------------------------
// HTTP: admin pings a player (ID token; caller must be the draft's
// adminUid or the site owner)
// ---------------------------------------------------------------
exports.rdPing = onRequest(
  { cors: true, secrets: [VAPID_PRIVATE] },
  async (req, res) => {
    let decoded;
    try { decoded = await requireAuth(req); } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { draftId, pid, message } = req.body || {};
    if (typeof draftId !== 'string' || !/^[\w-]{1,40}$/.test(draftId) ||
        typeof pid !== 'string' || !/^[\w-]{1,40}$/.test(pid)) {
      res.status(400).json({ error: 'Bad request' });
      return;
    }
    const snap = await db.doc(`rd-drafts/${draftId}`).get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const d = snap.data();
    if (decoded.uid !== d.adminUid && emailHash(decoded) !== OWNER_HASH) {
      res.status(403).json({ error: 'Not admin' });
      return;
    }
    const name = d.players?.[pid]?.name || 'player';
    await sendPush(draftId, pid, {
      title: d.name || 'Rotisserie Draft',
      body: (message || '').trim() || `It's your turn, ${name}!`,
      url: `/?d=${draftId}`,
      tag: 'rd-ping',
    });
    res.json({ ok: true });
  }
);

// ---------------------------------------------------------------
// HTTP: bind the caller's auth uid to a seat. Authorized by the
// seat's rejoin secret, by a Google account already on the seat, or
// by an existing binding (returns the secret for device migration).
// Only this function may extend the uid allowlists.
// ---------------------------------------------------------------
exports.rdClaim = onRequest({ cors: true }, async (req, res) => {
  let decoded;
  try { decoded = await requireAuth(req); } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { draftId, pid, secret } = req.body || {};
  if (typeof draftId !== 'string' || !/^[\w-]{1,40}$/.test(draftId) ||
      typeof pid !== 'string' || !/^[\w-]{1,40}$/.test(pid)) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  const dRef = db.doc(`rd-drafts/${draftId}`);
  const dSnap = await dRef.get();
  if (!dSnap.exists) { res.status(404).json({ error: 'Draft not found' }); return; }
  const d = dSnap.data();
  if (!d.players?.[pid]) { res.status(404).json({ error: 'Seat not found' }); return; }
  const pRef = db.doc(`rd-drafts/${draftId}/private/${pid}`);
  const pSnap = await pRef.get();
  const priv = pSnap.exists ? pSnap.data() : {};
  const bySecret = !!secret && !!priv.secret && secret === priv.secret;
  const byGoogle = !!d.players[pid].uid && d.players[pid].uid === decoded.uid;
  const alreadyBound = (d.uids || {})[decoded.uid] === pid || (priv.uids || {})[decoded.uid] === true;
  if (!bySecret && !byGoogle && !alreadyBound) {
    res.status(403).json({ error: 'Not authorized for this seat' });
    return;
  }
  await dRef.update({ [`uids.${decoded.uid}`]: pid });
  await pRef.set({ uids: { [decoded.uid]: true } }, { merge: true });
  // persist a Google account on the seat for future sign-in rejoin
  if (decoded.firebase?.sign_in_provider !== 'anonymous' && d.players[pid].uid !== decoded.uid) {
    await dRef.update({ [`players.${pid}.uid`]: decoded.uid });
    await pRef.set({ uid: decoded.uid }, { merge: true });
  }
  res.json({ ok: true, pid, secret: priv.secret || null });
});

// ---------------------------------------------------------------
// HTTP: submit a pick. Server-authoritative — clients cannot write
// the pick log directly. Validates seat, turn and card availability.
// ---------------------------------------------------------------
exports.rdPick = onRequest({ cors: true }, async (req, res) => {
  let decoded;
  try { decoded = await requireAuth(req); } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { draftId, cardId } = req.body || {};
  if (typeof draftId !== 'string' || !/^[\w-]{1,40}$/.test(draftId) ||
      !Number.isInteger(cardId) || cardId < 0) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  const dRef = db.doc(`rd-drafts/${draftId}`);
  const poolCards = await readPool(draftId);
  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(dRef);
      const d = snap.data();
      if (!d) throw new Error('Draft not found');
      if (d.archived) throw new Error('This draft is archived (read only)');
      if (d.status !== 'active') throw new Error('The draft is not active');
      const pid = (d.uids || {})[decoded.uid];
      if (!pid || !d.players?.[pid]) throw new Error('You are not seated in this draft');
      if (d.players[pid].dropped) throw new Error('You were dropped from this draft');
      const s = draftSettings(d);
      const seq = buildSeq(d.order.length, s.totalPicks, s.singleRounds);
      const picks = d.picks || [];
      if (picks.length >= seq.length) throw new Error('The draft is complete');
      if (d.order[seq[picks.length]] !== pid) throw new Error('It is not your turn');
      if (picks.some((p) => p.c === cardId)) throw new Error('That card was just picked');
      const pool = poolCards;
      if (cardId >= pool.length) throw new Error('Unknown card');
      t.update(dRef, {
        picks: [...picks, { p: pid, c: cardId, n: pool[cardId].n, at: Date.now() }],
        turnStartedAt: Date.now(),
      });
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Pick failed' });
  }
});

// ---------------------------------------------------------------
// HTTP: contact form — stores the message server-side so no email
// address is ever exposed on the site. Owner reads via dashboard.
// ---------------------------------------------------------------
exports.rdContact = onRequest({ cors: true }, async (req, res) => {
  const { name, email, message, website } = req.body || {};
  if (typeof website === 'string' && website.length) {
    res.json({ ok: true }); // honeypot field — silently drop bots
    return;
  }
  const msg = typeof message === 'string' ? message.trim() : '';
  if (msg.length < 3 || msg.length > 3000) {
    res.status(400).json({ error: 'Message must be 3–3000 characters.' });
    return;
  }
  // crude flood guard: max 20 stored messages per hour globally
  const hourAgo = Date.now() - 3600e3;
  const recent = await db.collection('rd-contact').where('at', '>', hourAgo).get();
  if (recent.size >= 20) {
    res.status(429).json({ error: 'Too many messages right now — try again later.' });
    return;
  }
  await db.collection('rd-contact').add({
    name: (typeof name === 'string' ? name : '').slice(0, 120),
    email: (typeof email === 'string' ? email : '').slice(0, 200),
    message: msg,
    at: Date.now(),
    ua: String(req.headers['user-agent'] || '').slice(0, 300),
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// HTTP: owner inbox — list/delete contact messages. Auth via
// Firebase ID token; the caller's email hash must match OWNER_HASH.
// ---------------------------------------------------------------
exports.rdInbox = onRequest({ cors: true }, async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const decoded = await getAuth().verifyIdToken(token);
    const hash = crypto.createHash('sha256')
      .update(String(decoded.email || '').toLowerCase()).digest('hex');
    if (hash !== OWNER_HASH) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { op, id } = req.body || {};
  if (op === 'delete') {
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) {
      res.status(400).json({ error: 'Bad id' });
      return;
    }
    await db.doc(`rd-contact/${id}`).delete();
    res.json({ ok: true });
    return;
  }
  const snaps = await db.collection('rd-contact').orderBy('at', 'desc').limit(100).get();
  res.json({ messages: snaps.docs.map((d) => ({ id: d.id, ...d.data() })) });
});

// ---------------------------------------------------------------
// Firestore trigger: lobby auto-start, queue auto-picks, snipe +
// turn notifications, draft completion
// ---------------------------------------------------------------
exports.rdOnDraftWrite = onDocumentWritten(
  { document: 'rd-drafts/{draftId}', secrets: [VAPID_PRIVATE] },
  async (event) => {
    if (!event.data.after.exists) return;
    const after = event.data.after.data();
    if (after.archived) return; // archived drafts are frozen
    const before = event.data.before.exists ? event.data.before.data() : {};
    const draftId = event.params.draftId;
    const ref = event.data.after.ref;
    const url = `/?d=${draftId}`;
    const title = after.name || 'Rotisserie Draft';
    const s = draftSettings(after);

    // --- Lobby: starting is an explicit admin action. When the lobby
    // fills up, push-notify the creator (if they hold a seat). ---
    if (after.status === 'lobby') {
      const count = Object.keys(after.players || {}).length;
      const wasFull = before.status === 'lobby' &&
        Object.keys(before.players || {}).length >= draftSettings(before).players;
      if (count >= s.players && !wasFull) {
        const adminPid = Object.entries(after.players || {})
          .find(([, p]) => p.uid && p.uid === after.adminUid)?.[0];
        if (adminPid) {
          await sendPush(draftId, adminPid, {
            title,
            body: 'The lobby is full — start the draft when you are ready!',
            url,
            tag: 'rd-full',
          });
        }
      }
      return;
    }

    if (after.status !== 'active' && after.status !== 'done') return;
    const order = after.order || [];
    if (!order.length) return;

    const seq = buildSeq(order.length, s.totalPicks, s.singleRounds);
    const picks = after.picks || [];
    const beforePicks = before.picks || [];
    const newPicks = picks.slice(beforePicks.length);
    const activated = before.status === 'lobby' && after.status === 'active';

    // --- Queue upkeep on new picks: drop cards the owner picked
    // themselves; MARK cards sniped by someone else (tb = taken by)
    // so the owner sees it and decides — they are not skipped over. ---
    if (newPicks.length) {
      const privSnaps = await db.collection(`rd-drafts/${draftId}/private`).get();
      for (const pdoc of privSnaps.docs) {
        const q = pdoc.data().queue || [];
        const q2 = [];
        const sniped = [];
        let changed = false;
        for (const item of q) {
          const pick = item.tb ? null : newPicks.find((p) => p.c === item.c);
          if (!pick) { q2.push(item); continue; }
          changed = true;
          if (pick.p === pdoc.id) continue; // own pick — drop silently
          const pickerName = after.players?.[pick.p]?.name || 'someone';
          q2.push({ ...item, tb: pickerName });
          sniped.push({ item, pickerName });
        }
        if (changed) await pdoc.ref.update({ queue: q2 });
        for (const s2 of sniped) {
          await sendPush(draftId, pdoc.id, {
            title,
            body: `${s2.item.n} was picked by ${s2.pickerName} — pick another card!`,
            url,
            tag: 'rd-snipe',
          });
        }
      }
    }

    // --- Draft complete? ---
    if (picks.length >= seq.length) {
      if (after.status !== 'done') {
        await ref.update({ status: 'done', finishedAt: Date.now() });
        for (const pid of order) {
          await sendPush(draftId, pid, {
            title,
            body: 'The draft is complete. Check out the final decks.',
            url,
            tag: 'rd-done',
          });
        }
      }
      return;
    }
    if (after.status === 'done') return;

    // --- Dropped player: their turn is skipped with a marker pick
    // (c: -1) so the sequence and totals keep working. Chains through
    // consecutive dropped turns via retrigger. ---
    if (after.players?.[order[seq[picks.length]]]?.dropped) {
      await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const d = snap.data();
        if (!d || d.status !== 'active') return;
        const dPicks = d.picks || [];
        if (dPicks.length >= seq.length) return;
        const cp = d.order[seq[dPicks.length]];
        if (!d.players?.[cp]?.dropped) return;
        t.update(ref, {
          picks: [...dPicks, { p: cp, c: -1, n: '', at: Date.now(), skip: true }],
          turnStartedAt: Date.now(),
        });
      });
      return;
    }

    // --- Current player: try auto-pick from queue.
    // Only the TOP entry counts: if it was taken by someone else the
    // draft stops here so the player can decide for themselves.
    // (Bots skip dead entries — nobody is deciding for them.) ---
    const curPid = order[seq[picks.length]];
    const isBot = !!after.players?.[curPid]?.bot;
    const privRef = db.doc(`rd-drafts/${draftId}/private/${curPid}`);
    const privSnap = await privRef.get();
    const queue = privSnap.exists ? privSnap.data().queue || [] : [];
    const allPicked = new Set(picks.map((p) => p.c));
    let avail = null;
    let stalledOn = null;
    for (const item of queue) {
      if (item.tb || allPicked.has(item.c)) {
        if (isBot) continue;
        stalledOn = item;
        break;
      }
      avail = item;
      break;
    }
    if (avail) {
      let didPick = false;
      await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const d = snap.data();
        if (!d || d.status !== 'active') return;
        const dPicks = d.picks || [];
        if (dPicks.length >= seq.length) return;
        if (d.order[seq[dPicks.length]] !== curPid) return;
        if (dPicks.some((p) => p.c === avail.c)) return;
        t.update(ref, {
          picks: [...dPicks, { p: curPid, c: avail.c, n: avail.n, at: Date.now(), auto: true }],
          turnStartedAt: Date.now(),
        });
        didPick = true;
      });
      if (didPick) {
        await privRef.update({ queue: queue.filter((i) => i !== avail) });
        await sendPush(draftId, curPid, {
          title,
          body: `Auto-picked ${avail.n} from your queue.`,
          url,
          tag: 'rd-auto',
        });
        return; // the write re-triggers this function for the next turn
      }
    }

    // --- Bot turn: score = CubeCobra elo + color affinity. The
    // affinity bonus grows with every on-color card the bot already
    // holds, so early picks follow ratings and later picks commit to
    // the bot's colors. Colorless cards get a partial fits-anywhere
    // bonus. Jitter breaks ties (pure random for elo-less pools). ---
    if (after.players?.[curPid]?.bot) {
      const pool = await readPool(draftId);
      const counts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      for (const p of picks) {
        if (p.p !== curPid) continue;
        for (const ch of pool[p.c]?.c || '') {
          if (counts[ch] != null) counts[ch]++;
        }
      }
      const K = 28; // elo points of bonus per on-color card already drafted
      const top2 = Object.values(counts).sort((a, b) => b - a).slice(0, 2);
      const colorlessBonus = 0.5 * K * ((top2[0] + top2[1]) / 2);
      let bestId = -1;
      let bestScore = -Infinity;
      pool.forEach((c, i) => {
        if (allPicked.has(i)) return;
        const cols = c.c || '';
        const bonus = cols.length
          ? (K * [...cols].reduce((sum, ch) => sum + (counts[ch] || 0), 0)) / cols.length
          : colorlessBonus;
        const score = (c.e || 0) + bonus + Math.random() * 60;
        if (score > bestScore) { bestScore = score; bestId = i; }
      });
      if (bestId >= 0) {
        await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          const d = snap.data();
          if (!d || d.status !== 'active') return;
          const dPicks = d.picks || [];
          if (dPicks.length >= seq.length) return;
          if (d.order[seq[dPicks.length]] !== curPid) return;
          if (dPicks.some((p) => p.c === bestId)) return;
          t.update(ref, {
            picks: [...dPicks, { p: curPid, c: bestId, n: pool[bestId].n, at: Date.now(), auto: true }],
            turnStartedAt: Date.now(),
          });
        });
        return; // re-trigger chains through consecutive bot turns
      }
    }

    // --- Notify on turn change / draft start ---
    const prevPid =
      !activated && beforePicks.length < seq.length && before.order
        ? before.order[seq[beforePicks.length]]
        : null;
    if (activated) {
      const firstName = after.players?.[curPid]?.name || '?';
      for (const pid of order) {
        await sendPush(draftId, pid, {
          title,
          body:
            pid === curPid
              ? `The draft has started — you are up first!`
              : `The draft has started! ${firstName} picks first.`,
          url,
          tag: 'rd-start',
        });
      }
    } else if (newPicks.length && curPid !== prevPid) {
      const myCount = picks.filter((p) => p.p === curPid).length;
      const double = seq[picks.length + 1] === seq[picks.length] ? ' (2 picks)' : '';
      await sendPush(draftId, curPid, {
        title,
        body: stalledOn
          ? `${stalledOn.n} was taken by ${stalledOn.tb || 'someone'} — it's your turn${double}, pick another card!`
          : `It's your turn${double} — pick ${myCount + 1}/${s.totalPicks}.`,
        url,
        tag: 'rd-turn',
      });
    }
  }
);

// ---------------------------------------------------------------
// Scheduled: remind the current player after N hours of inactivity
// ---------------------------------------------------------------
exports.rdReminder = onSchedule(
  { schedule: 'every 30 minutes', secrets: [VAPID_PRIVATE] },
  async () => {
    const snaps = await db
      .collection('rd-drafts')
      .where('status', '==', 'active')
      .get();
    for (const docSnap of snaps.docs) {
      const d = docSnap.data();
      if (d.archived) continue;
      const s = draftSettings(d);
      if (!s.reminderHours || !d.turnStartedAt) continue;
      if (Date.now() - d.turnStartedAt < s.reminderHours * 3600e3) continue;
      if (d.lastReminderAt && d.lastReminderAt >= d.turnStartedAt) continue;
      const order = d.order || [];
      if (!order.length) continue;
      const seq = buildSeq(order.length, s.totalPicks, s.singleRounds);
      const picks = d.picks || [];
      if (picks.length >= seq.length) continue;
      const curPid = order[seq[picks.length]];
      if (d.players?.[curPid]?.dropped || d.players?.[curPid]?.bot) continue;
      const name = d.players?.[curPid]?.name || 'player';
      await docSnap.ref.update({ lastReminderAt: Date.now() });
      await sendPush(docSnap.id, curPid, {
        title: d.name || 'Rotisserie Draft',
        body: `Reminder: it is still your turn, ${name} — the table is waiting!`,
        url: `/?d=${docSnap.id}`,
        tag: 'rd-reminder',
      });
    }
  }
);
