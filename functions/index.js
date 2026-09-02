// Cloud Functions for web-sandbox
// Rotisserie Draft: cube proxy, push notifications, auto-queue picks, reminders

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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

// Pick-queue decision tree — mirrored from web/src/lib/draftLogic.ts
// (resolveQueue), keep in sync. Each entry says what auto-pick does
// when its card is already gone: 'stop'/unset → wait for the player,
// 'next' → look at the next entry, 'alt' → take entry.alt instead.
// `skipDead` (bots) skips every gone entry regardless. 'next' chains
// through consecutive gone entries; a gone/missing fallback stalls on
// its parent; passed-over entries are consumed with the pick.
// Returns { pick, from, stalledOn, consumed }.
function resolveQueue(queue, gone, skipDead = false) {
  const passed = [];
  for (const item of queue) {
    if (!item.tb && !gone(item)) {
      return { pick: { c: item.c, n: item.n }, from: item, stalledOn: null, consumed: [...passed, item] };
    }
    if (skipDead || item.ifTaken === 'next') { passed.push(item); continue; }
    if (item.ifTaken === 'alt' && item.alt && !gone(item.alt)) {
      return { pick: { c: item.alt.c, n: item.alt.n }, from: item, stalledOn: null, consumed: [...passed, item] };
    }
    return { pick: null, from: null, stalledOn: item, consumed: [] };
  }
  return { pick: null, from: null, stalledOn: null, consumed: [] };
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
  return sendPushDoc(`rd-drafts/${draftId}/private/${pid}`, payload, pid);
}
// Core push sender: works for any private doc holding a pushSubs array
// (drafts and card-blind leagues share the shape). Never throws — a
// failed notification must not break the operation that triggered it.
async function sendPushDoc(path, payload, pid = '?') {
  try {
    ensureVapid();
  } catch (e) {
    console.warn('push skipped (VAPID unavailable):', e.message);
    return;
  }
  const ref = db.doc(path);
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
// Format drafts: the pool is implicit ("every card legal in X").
// Picks are validated by name on Scryfall and carry the card data,
// so the client derives its pool from the pick log.
// ---------------------------------------------------------------
const RD_FORMATS = new Set(['legacy', 'vintage', 'modern', 'premodern', 'pioneer', 'standard', 'pauper']);

// Mirrors extractScryfallCard in public/app.js — keep the shapes in sync.
function extractCard(card) {
  return {
    n: card.name,
    img: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null,
    m: card.mana_cost || (card.card_faces || []).map((f) => f.mana_cost).filter(Boolean).join(' // ') || '',
    t: card.type_line || card.card_faces?.[0]?.type_line || '',
    c: (card.colors?.length ? card.colors : (card.card_faces || []).flatMap((f) => f.colors || [])).join(''),
    v: card.cmc ?? 0,
    r: card.rarity || '',
  };
}

// Resolve + validate a named card for a format draft. Throws with a
// user-facing message.
async function resolveFormatCard(name, format) {
  const res = await fetch(
    'https://api.scryfall.com/cards/named?exact=' + encodeURIComponent(name),
    { headers: SCRYFALL_HEADERS });
  if (res.status === 404) throw new Error(`"${name}" was not found on Scryfall`);
  if (!res.ok) throw new Error('Scryfall error ' + res.status);
  const card = await res.json();
  const leg = card.legalities?.[format];
  if (leg !== 'legal' && leg !== 'restricted') {
    throw new Error(`${card.name} is not legal in ${format}`);
  }
  const type = card.type_line || card.card_faces?.[0]?.type_line || '';
  if (/\bBasic\b/.test(type)) {
    throw new Error('Basic lands are not drafted — add them when you build your deck');
  }
  return { name: card.name, info: extractCard(card) };
}

// Append a validated pick to a format draft. Turn and duplicate checks
// run inside the transaction; `c` indexes the derived (picked-only) pool.
async function applyFormatPick(draftId, pid, resolved, auto = false) {
  const dRef = db.doc(`rd-drafts/${draftId}`);
  await db.runTransaction(async (t) => {
    const snap = await t.get(dRef);
    const d = snap.data();
    if (!d) throw new Error('Draft not found');
    if (d.archived) throw new Error('This draft is archived (read only)');
    if (d.status !== 'active') throw new Error('The draft is not active');
    const s = draftSettings(d);
    const seq = buildSeq(d.order.length, s.totalPicks, s.singleRounds);
    const picks = d.picks || [];
    if (picks.length >= seq.length) throw new Error('The draft is complete');
    if (d.order[seq[picks.length]] !== pid) throw new Error('It is not your turn');
    const lower = resolved.name.toLowerCase();
    if (picks.some((p) => !p.skip && p.n.toLowerCase() === lower)) {
      throw new Error(`${resolved.name} was already picked`);
    }
    const c = picks.filter((p) => !p.skip).length;
    t.update(dRef, {
      picks: [...picks, {
        p: pid, c, n: resolved.name, at: Date.now(), card: resolved.info,
        ...(auto ? { auto: true } : {}),
      }],
      turnStartedAt: Date.now(),
    });
  });
}

// ---------------------------------------------------------------
// HTTP: per-format staples catalog (top ~1000 by EDHREC rank), used
// for the default pool browse and for bot picks in format drafts.
// GET ?format=modern returns the cache, refreshing when stale;
// POST with the owner's token force-syncs (one format or all).
// ---------------------------------------------------------------
const STAPLES_MAX_AGE_MS = 30 * 24 * 3600e3;
const STAPLES_COUNT = 1000;

async function syncStaples(format) {
  const cards = [];
  let url = 'https://api.scryfall.com/cards/search?q=' +
    encodeURIComponent(`format:${format} -t:basic -is:funny`) +
    '&order=edhrec&dir=asc&unique=cards';
  let page = 0;
  while (url && cards.length < STAPLES_COUNT && page < 10) {
    const res = await fetch(url, { headers: SCRYFALL_HEADERS });
    if (!res.ok) throw new Error(`Scryfall staples error ${res.status} for ${format}`);
    const data = await res.json();
    for (const card of data.data || []) {
      if (cards.length >= STAPLES_COUNT) break;
      // e: elo-like rating for the bot scorer, best staple first
      cards.push({ ...extractCard(card), e: STAPLES_COUNT - cards.length });
    }
    url = data.has_more ? data.next_page : null;
    page++;
    await new Promise((r) => setTimeout(r, 110));
  }
  await db.doc(`rd-meta/staples-${format}`).set({ format, cards, at: Date.now() });
  return cards;
}

exports.rdStaples = onRequest({ cors: true, timeoutSeconds: 300 }, async (req, res) => {
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
      const one = req.body?.format;
      const formats = one ? [one] : [...RD_FORMATS];
      if (formats.some((f) => !RD_FORMATS.has(f))) {
        res.status(400).json({ error: 'Unknown format' });
        return;
      }
      const counts = {};
      for (const f of formats) counts[f] = (await syncStaples(f)).length;
      res.json({ ok: true, counts, at: Date.now() });
      return;
    }
    // ?meta=1 — cache summaries for every format, never triggers a sync
    if (req.query.meta) {
      const out = [];
      for (const f of RD_FORMATS) {
        const snap = await db.doc(`rd-meta/staples-${f}`).get();
        out.push({
          format: f,
          count: snap.exists ? (snap.data().cards || []).length : 0,
          at: snap.exists ? snap.data().at || null : null,
        });
      }
      res.json({ formats: out });
      return;
    }
    const format = String(req.query.format || '');
    if (!RD_FORMATS.has(format)) {
      res.status(400).json({ error: 'Unknown format' });
      return;
    }
    const snap = await db.doc(`rd-meta/staples-${format}`).get();
    const cached = snap.exists ? snap.data() : null;
    if (cached && Date.now() - (cached.at || 0) < STAPLES_MAX_AGE_MS) {
      res.json({ format, cards: cached.cards || [], at: cached.at });
      return;
    }
    const cards = await syncStaples(format);
    res.json({ format, cards, at: Date.now(), synced: true });
  } catch (e) {
    // serve a stale cache over an error
    const format = String(req.query?.format || req.body?.format || '');
    const snap = RD_FORMATS.has(format)
      ? await db.doc(`rd-meta/staples-${format}`).get().catch(() => null) : null;
    if (snap?.exists) {
      res.json({ format, cards: snap.data().cards || [], at: snap.data().at, stale: true });
      return;
    }
    res.status(502).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// HTTP: submit a pick. Server-authoritative — clients cannot write
// the pick log directly. Validates seat, turn and card availability.
// Classic drafts pick by pool index; format drafts pick by card name.
// ---------------------------------------------------------------
exports.rdPick = onRequest({ cors: true }, async (req, res) => {
  let decoded;
  try { decoded = await requireAuth(req); } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { draftId, cardId, cardName } = req.body || {};
  const byName = typeof cardName === 'string' && !!cardName.trim() && cardName.length <= 200;
  if (typeof draftId !== 'string' || !/^[\w-]{1,40}$/.test(draftId) ||
      (!byName && (!Number.isInteger(cardId) || cardId < 0))) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  const dRef = db.doc(`rd-drafts/${draftId}`);

  // ---- format draft: validate the name on Scryfall, then append ----
  const preSnap = await dRef.get();
  if (!preSnap.exists) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }
  if (preSnap.data().source === 'format') {
    try {
      const d0 = preSnap.data();
      if (!byName) throw new Error('Format drafts pick by card name');
      if (!RD_FORMATS.has(d0.format)) throw new Error('Unknown draft format');
      const pid = (d0.uids || {})[decoded.uid];
      if (!pid || !d0.players?.[pid]) throw new Error('You are not seated in this draft');
      if (d0.players[pid].dropped) throw new Error('You were dropped from this draft');
      const resolved = await resolveFormatCard(cardName.trim(), d0.format);
      await applyFormatPick(draftId, pid, resolved);
      res.json({ ok: true, name: resolved.name });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Pick failed' });
    }
    return;
  }
  if (byName) {
    res.status(400).json({ error: 'This draft picks from its pool' });
    return;
  }

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
    const isFormat = after.source === 'format';

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
          // format-draft queue items have no pool index — match by name
          const pick = item.tb ? null : (isFormat
            ? newPicks.find((p) => !p.skip && p.n && item.n &&
                p.n.toLowerCase() === item.n.toLowerCase())
            : newPicks.find((p) => p.c === item.c));
          if (!pick) { q2.push(item); continue; }
          changed = true;
          if (pick.p === pdoc.id) continue; // own pick — drop silently
          const pickerName = after.players?.[pick.p]?.name || 'someone';
          q2.push({ ...item, tb: pickerName });
          sniped.push({ item, pickerName });
        }
        if (changed) await pdoc.ref.update({ queue: q2 });
        for (const s2 of sniped) {
          const plan = s2.item.ifTaken === 'next'
            ? 'your queue will skip to the next card.'
            : s2.item.ifTaken === 'alt' && s2.item.alt?.n
              ? `you will get ${s2.item.alt.n} instead.`
              : 'pick another card!';
          await sendPush(draftId, pdoc.id, {
            title,
            body: `${s2.item.n} was picked by ${s2.pickerName} — ${plan}`,
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
    // resolveQueue walks the queue as a decision tree: a gone entry
    // either stops the draft so the player can decide (default), skips
    // to the next entry, or hands over to its fallback card. (Bots skip
    // dead entries — nobody is deciding for them.) ---
    const curPid = order[seq[picks.length]];
    const isBot = !!after.players?.[curPid]?.bot;
    const privRef = db.doc(`rd-drafts/${draftId}/private/${curPid}`);
    const privSnap = await privRef.get();
    const queue = privSnap.exists ? privSnap.data().queue || [] : [];
    const allPicked = new Set(picks.map((p) => p.c));
    const takenNames = new Set(picks.filter((p) => !p.skip).map((p) => p.n.toLowerCase()));
    const gone = isFormat
      ? (card) => takenNames.has((card.n || '').toLowerCase())
      : (card) => card.c != null && allPicked.has(card.c);
    const { pick: avail, from, stalledOn, consumed } = resolveQueue(queue, gone, isBot);
    const remaining = () => queue.filter((i) => !consumed.includes(i));
    // "instead of A" when the pick came from a fallback or skipped past
    // sniped entries
    const insteadOf = avail && (from?.n !== avail.n || consumed.length > 1)
      ? ` (instead of ${consumed.filter((i) => i.n !== avail.n).map((i) => i.n).join(', ')})`
      : '';
    if (avail && isFormat) {
      // re-validate on the server — queue entries are client-written
      let resolved = null;
      try {
        resolved = await resolveFormatCard(avail.n, after.format);
      } catch (e) {
        await privRef.update({ queue: remaining() });
        await sendPush(draftId, curPid, {
          title,
          body: `${avail.n} was removed from your queue (${e.message}) — pick manually!`,
          url,
          tag: 'rd-auto',
        });
        return;
      }
      let didPick = true;
      try {
        await applyFormatPick(draftId, curPid, resolved, true);
      } catch { didPick = false; }
      if (didPick) {
        await privRef.update({ queue: remaining() });
        await sendPush(draftId, curPid, {
          title,
          body: `Auto-picked ${resolved.name} from your queue${insteadOf}.`,
          url,
          tag: 'rd-auto',
        });
        return; // the write re-triggers this function for the next turn
      }
    } else if (avail) {
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
        await privRef.update({ queue: remaining() });
        await sendPush(draftId, curPid, {
          title,
          body: `Auto-picked ${avail.n} from your queue${insteadOf}.`,
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
    if (after.players?.[curPid]?.bot && isFormat) {
      // Format-draft bots pick from the cached staples catalog with the
      // same elo + color-affinity scoring as pool bots.
      const stSnap = await db.doc(`rd-meta/staples-${after.format}`).get();
      const staples = stSnap.exists ? stSnap.data().cards || [] : [];
      const counts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      for (const p of picks) {
        if (p.p !== curPid || p.skip) continue;
        for (const ch of p.card?.c || '') {
          if (counts[ch] != null) counts[ch]++;
        }
      }
      const K = 28;
      const top2 = Object.values(counts).sort((a, b) => b - a).slice(0, 2);
      const colorlessBonus = 0.5 * K * ((top2[0] + top2[1]) / 2);
      let best = null;
      let bestScore = -Infinity;
      for (const c of staples) {
        if (takenNames.has(c.n.toLowerCase())) continue;
        const cols = c.c || '';
        const bonus = cols.length
          ? (K * [...cols].reduce((sum, ch) => sum + (counts[ch] || 0), 0)) / cols.length
          : colorlessBonus;
        const score = (c.e || 0) + bonus + Math.random() * 60;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best) {
        const { e, ...info } = best;
        try { await applyFormatPick(draftId, curPid, { name: best.n, info }, true); } catch {}
      } else {
        // staples missing or exhausted — skip so the draft keeps moving
        console.warn(`format bot has no staples candidate (${after.format}), skipping turn`);
        await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          const d = snap.data();
          if (!d || d.status !== 'active') return;
          const dPicks = d.picks || [];
          if (dPicks.length >= seq.length) return;
          if (d.order[seq[dPicks.length]] !== curPid) return;
          t.update(ref, {
            picks: [...dPicks, { p: curPid, c: -1, n: '', at: Date.now(), skip: true }],
            turnStartedAt: Date.now(),
          });
        });
      }
      return; // re-trigger chains through consecutive bot turns
    }
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
// ===============================================================
// Card Blind (4CB/3CB) leagues — blind N-card decks, round-robin
// matches resolved by the players, self-reported results.
// Collections: cb-leagues/{id}, …/rounds/{n}, …/private/{pid}
// ===============================================================

const CB_FORMATS = ['legacy', 'vintage', 'modern', 'premodern', 'pioneer', 'standard', 'pauper'];

function leagueSettings(l) {
  const s = l.settings || {};
  return {
    handSize: s.handSize || 4,
    highlander: s.highlander !== false,
    format: CB_FORMATS.includes(s.format) ? s.format : 'modern',
    rounds: s.rounds || 3,
    maxPlayers: s.maxPlayers || 16,
  };
}

// Match = two games (game 1: player a on the play, game 2: player b).
// Points from a two-game result seen from one player's perspective:
// WW 6 · WD 4 · WL 2 · DD 2 · DL 1 · LL 0  (mirrored in app.js)
function matchPoints(res) {
  const w = res.filter((g) => g === 'W').length;
  const d = res.filter((g) => g === 'D').length;
  if (w === 2) return 6;
  if (w === 1) return d ? 4 : 2;
  return d === 2 ? 2 : d === 1 ? 1 : 0;
}
const mirrorResult = (res) => res.map((g) => (g === 'W' ? 'L' : g === 'L' ? 'W' : 'D'));

const cbPush = (leagueId, pid, payload) =>
  sendPushDoc(`cb-leagues/${leagueId}/private/${pid}`, payload, pid);

function cbActivePids(l) {
  return Object.entries(l.players || {})
    .filter(([, p]) => !p.dropped)
    .map(([pid]) => pid);
}

// The admin's seat pid, if the admin also plays (used for admin pushes).
function cbAdminPid(l) {
  return Object.entries(l.players || {})
    .find(([, p]) => p.uid && p.uid === l.adminUid)?.[0] || null;
}

// ---------------------------------------------------------------
// HTTP: bind the caller's auth uid to a league seat (same contract
// as rdClaim, against cb-leagues).
// ---------------------------------------------------------------
exports.cbClaim = onRequest({ cors: true }, async (req, res) => {
  let decoded;
  try { decoded = await requireAuth(req); } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { leagueId, pid, secret } = req.body || {};
  if (typeof leagueId !== 'string' || !/^[\w-]{1,40}$/.test(leagueId) ||
      typeof pid !== 'string' || !/^[\w-]{1,40}$/.test(pid)) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  const lRef = db.doc(`cb-leagues/${leagueId}`);
  const lSnap = await lRef.get();
  if (!lSnap.exists) { res.status(404).json({ error: 'League not found' }); return; }
  const l = lSnap.data();
  if (!l.players?.[pid]) { res.status(404).json({ error: 'Seat not found' }); return; }
  const pRef = db.doc(`cb-leagues/${leagueId}/private/${pid}`);
  const pSnap = await pRef.get();
  const priv = pSnap.exists ? pSnap.data() : {};
  const bySecret = !!secret && !!priv.secret && secret === priv.secret;
  const byGoogle = !!l.players[pid].uid && l.players[pid].uid === decoded.uid;
  const alreadyBound = (l.uids || {})[decoded.uid] === pid || (priv.uids || {})[decoded.uid] === true;
  if (!bySecret && !byGoogle && !alreadyBound) {
    res.status(403).json({ error: 'Not authorized for this seat' });
    return;
  }
  await lRef.update({ [`uids.${decoded.uid}`]: pid });
  await pRef.set({ uids: { [decoded.uid]: true } }, { merge: true });
  if (decoded.firebase?.sign_in_provider !== 'anonymous' && l.players[pid].uid !== decoded.uid) {
    await lRef.update({ [`players.${pid}.uid`]: decoded.uid });
    await pRef.set({ uid: decoded.uid }, { merge: true });
  }
  res.json({ ok: true, pid, secret: priv.secret || null });
});

// ---------------------------------------------------------------
// HTTP: submit (or resubmit) a blind deck for the current round.
// Server-authoritative: resolves the names on Scryfall and enforces
// hand size, format legality, the round's banlist and highlander.
// The deck lands in the player's private doc — nobody, including
// the league admin, can read it before the reveal.
// ---------------------------------------------------------------
exports.cbSubmit = onRequest({ cors: true, secrets: [VAPID_PRIVATE] }, async (req, res) => {
  let decoded;
  try { decoded = await requireAuth(req); } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const { leagueId, cards } = req.body || {};
    if (typeof leagueId !== 'string' || !/^[\w-]{1,40}$/.test(leagueId) ||
        !Array.isArray(cards) || cards.length > 20 ||
        cards.some((c) => typeof c !== 'string' || !c.trim() || c.length > 200)) {
      res.status(400).json({ error: 'Bad request' });
      return;
    }
    const lSnap = await db.doc(`cb-leagues/${leagueId}`).get();
    if (!lSnap.exists) { res.status(404).json({ error: 'League not found' }); return; }
    const l = lSnap.data();
    if (l.archived) throw new Error('This league is archived (read only)');
    if (l.status !== 'active' || !l.curRound) throw new Error('No round is open for submissions');
    const pid = (l.uids || {})[decoded.uid];
    if (!pid || !l.players?.[pid]) throw new Error('You are not seated in this league');
    if (l.players[pid].dropped) throw new Error('You were dropped from this league');
    const s = leagueSettings(l);
    const rRef = db.doc(`cb-leagues/${leagueId}/rounds/${l.curRound}`);
    const rSnap = await rRef.get();
    if (!rSnap.exists) throw new Error('Round not found');
    const round = rSnap.data();
    if (round.status !== 'submission') throw new Error('Submissions are closed — the decks are revealed');
    if (Date.now() > round.deadline) throw new Error('The submission deadline has passed');
    const names = cards.map((c) => c.trim());
    if (names.length !== s.handSize) throw new Error(`Submit exactly ${s.handSize} cards`);

    // Resolve on Scryfall (exact names; the client autocompletes)
    const r = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { ...SCRYFALL_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: names.map((name) => ({ name })) }),
    });
    if (!r.ok) throw new Error('Scryfall lookup failed (' + r.status + ')');
    const data = await r.json();
    if (data.not_found?.length) {
      throw new Error('Not found on Scryfall: ' +
        data.not_found.map((i) => i.name).join(', '));
    }
    const found = data.data || [];
    if (found.length !== names.length) throw new Error('Card lookup came back incomplete — try again');

    const bans = (round.bans || []).map((b) => b.toLowerCase());
    const problems = [];
    const counts = {};
    const resolved = found.map((card) => {
      const face = card.card_faces?.[0];
      const img = card.image_uris?.normal || face?.image_uris?.normal || '';
      const type = card.type_line || face?.type_line || '';
      const leg = card.legalities?.[s.format];
      counts[card.name] = (counts[card.name] || 0) + 1;
      const isBasic = /\bBasic\b/.test(type);
      if (leg !== 'legal' && leg !== 'restricted') {
        problems.push(`${card.name} is not legal in ${s.format}`);
      }
      if (bans.includes(card.name.toLowerCase()) ||
          (face && bans.includes(face.name?.toLowerCase()))) {
        problems.push(`${card.name} is banned this round`);
      }
      if (counts[card.name] === 2) {
        if (leg === 'restricted') problems.push(`${card.name} is restricted — max 1 copy`);
        else if (s.highlander && !isBasic) problems.push(`${card.name} appears more than once (highlander)`);
      }
      return { n: card.name, img, t: type };
    });
    if (problems.length) throw new Error([...new Set(problems)].join(' · '));

    await db.doc(`cb-leagues/${leagueId}/private/${pid}`).set({
      sub: { round: l.curRound, cards: resolved, at: Date.now() },
    }, { merge: true });
    await rRef.update({ [`submitted.${pid}`]: true });

    // Everyone in? Nudge the admin that an early reveal is possible.
    const submitted = { ...(round.submitted || {}), [pid]: true };
    const waiting = cbActivePids(l).filter((p) => !submitted[p]);
    const adminPid = cbAdminPid(l);
    if (!waiting.length && adminPid) {
      await cbPush(leagueId, adminPid, {
        title: l.name || 'Card Blind',
        body: `All decks for round ${l.curRound} are in — you can reveal early!`,
        url: `/4cb?l=${leagueId}`,
        tag: 'cb-allin',
      });
    }
    res.json({ ok: true, cards: resolved });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Submission failed' });
  }
});

// ---------------------------------------------------------------
// Reveal: copy every valid submission into the public round doc,
// build the all-pairs match skeleton, notify the table. Players
// without a submission sit the round out.
// ---------------------------------------------------------------
async function cbReveal(leagueId, l) {
  const n = l.curRound;
  const rRef = db.doc(`cb-leagues/${leagueId}/rounds/${n}`);
  const privSnaps = await db.collection(`cb-leagues/${leagueId}/private`).get();
  const decks = {};
  for (const p of privSnaps.docs) {
    const sub = p.data().sub;
    const player = l.players?.[p.id];
    if (!player || player.dropped) continue;
    if (sub?.round === n && Array.isArray(sub.cards) && sub.cards.length) {
      decks[p.id] = sub.cards;
    }
  }
  const pids = Object.keys(decks).sort();
  const matches = {};
  for (let i = 0; i < pids.length; i++) {
    for (let j = i + 1; j < pids.length; j++) {
      matches[`${pids[i]}__${pids[j]}`] = {
        a: pids[i], b: pids[j], reports: {}, result: null, pts: {}, disputed: false,
      };
    }
  }
  const done = !Object.keys(matches).length; // 0–1 decks: nothing to play
  await rRef.update({
    decks, matches,
    status: done ? 'done' : 'playing',
    revealedAt: Date.now(),
    ...(done ? { finishedAt: Date.now() } : {}),
  });
  // Per-match chat docs, created up front so the participants' read
  // rules have a doc to attach to (visible only to a, b and the admin).
  for (const [mid, m] of Object.entries(matches)) {
    await db.doc(`cb-leagues/${leagueId}/matchchat/${n}_${mid}`).set({
      round: n, a: m.a, b: m.b, msgs: [],
    });
  }
  const title = l.name || 'Card Blind';
  for (const pid of cbActivePids(l)) {
    await cbPush(leagueId, pid, {
      title,
      body: decks[pid]
        ? `Round ${n}: the decks are revealed — play your matches and report the results!`
        : `Round ${n}: the decks are revealed. You missed the deadline and sit this round out.`,
      url: `/4cb?l=${leagueId}`,
      tag: 'cb-reveal',
    });
  }
  if (done) await cbFinishRound(leagueId, l, n);
}

// Round bookkeeping once every match has a result (or has none).
// Marks the round done and, on the league's last planned round,
// finishes the league.
async function cbFinishRound(leagueId, l, n) {
  const s = leagueSettings(l);
  const rRef = db.doc(`cb-leagues/${leagueId}/rounds/${n}`);
  const rSnap = await rRef.get();
  if (!rSnap.exists) return;
  const round = rSnap.data();
  if (round.status !== 'done') {
    await rRef.update({ status: 'done', finishedAt: Date.now() });
  }
  const leagueDone = n >= s.rounds;
  if (leagueDone && l.status !== 'done') {
    await db.doc(`cb-leagues/${leagueId}`).update({ status: 'done' });
  }
  // Round winner for the notification: most points this round
  const totals = {};
  for (const m of Object.values(round.matches || {})) {
    for (const [pid, pts] of Object.entries(m.pts || {})) {
      totals[pid] = (totals[pid] || 0) + pts;
    }
  }
  const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  const winner = best ? `${l.players?.[best[0]]?.name || '?'} wins with ${best[1]} points.` : '';
  const title = l.name || 'Card Blind';
  for (const pid of cbActivePids(l)) {
    await cbPush(leagueId, pid, {
      title,
      body: leagueDone
        ? `The league is complete! Round ${n}: ${winner || 'no matches were played.'} Check the final standings.`
        : `Round ${n} is complete. ${winner || 'No matches were played.'}`,
      url: `/4cb?l=${leagueId}`,
      tag: 'cb-round-done',
    });
  }
}

// ---------------------------------------------------------------
// HTTP: admin round management — start the next round, reveal
// early, move the deadline, resolve a disputed match, finish the
// league. Auth: the league's adminUid or the site owner.
// ---------------------------------------------------------------
exports.cbRound = onRequest({ cors: true, secrets: [VAPID_PRIVATE] }, async (req, res) => {
  let decoded;
  try { decoded = await requireAuth(req); } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const { leagueId, op } = req.body || {};
    if (typeof leagueId !== 'string' || !/^[\w-]{1,40}$/.test(leagueId)) {
      res.status(400).json({ error: 'Bad request' });
      return;
    }
    const lRef = db.doc(`cb-leagues/${leagueId}`);
    const lSnap = await lRef.get();
    if (!lSnap.exists) { res.status(404).json({ error: 'League not found' }); return; }
    const l = lSnap.data();
    if (decoded.uid !== l.adminUid && emailHash(decoded) !== OWNER_HASH) {
      res.status(403).json({ error: 'Not the league admin' });
      return;
    }

    // Cascade delete runs server-side: the admin cannot enumerate the
    // (blind) private docs from the client. Works on archived leagues.
    if (op === 'delete') {
      for (const sub of ['rounds', 'private', 'matchchat']) {
        const snaps = await db.collection(`cb-leagues/${leagueId}/${sub}`).get();
        for (const d of snaps.docs) await d.ref.delete();
      }
      await lRef.delete();
      res.json({ ok: true });
      return;
    }

    if (l.archived) throw new Error('This league is archived (read only)');
    const s = leagueSettings(l);

    if (op === 'start') {
      const deadline = +req.body.deadline;
      if (!Number.isFinite(deadline) || deadline < Date.now() + 5 * 60e3) {
        throw new Error('The deadline must be at least 5 minutes in the future');
      }
      if (cbActivePids(l).length < 2) throw new Error('At least 2 players are needed');
      if (l.curRound) {
        const prev = await db.doc(`cb-leagues/${leagueId}/rounds/${l.curRound}`).get();
        if (prev.exists && prev.data().status !== 'done') {
          throw new Error(`Round ${l.curRound} is still running`);
        }
      }
      const n = (l.curRound || 0) + 1;
      await db.doc(`cb-leagues/${leagueId}/rounds/${n}`).set({
        n,
        status: 'submission',
        deadline,
        bans: l.customBans || [],
        submitted: {},
        decks: {},
        matches: {},
        createdAt: Date.now(),
      });
      await lRef.update({
        curRound: n,
        status: 'active',
        // starting beyond the planned count extends the league
        ...(n > s.rounds ? { 'settings.rounds': n } : {}),
      });
      const when = new Date(deadline).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      for (const pid of cbActivePids(l)) {
        await cbPush(leagueId, pid, {
          title: l.name || 'Card Blind',
          body: `Round ${n} is open — submit your ${s.handSize} cards by ${when}!`,
          url: `/4cb?l=${leagueId}`,
          tag: 'cb-round-open',
        });
      }
      res.json({ ok: true, round: n });
      return;
    }

    // The remaining ops act on the current round
    if (!l.curRound) throw new Error('No round yet');
    const rRef = db.doc(`cb-leagues/${leagueId}/rounds/${l.curRound}`);
    const rSnap = await rRef.get();
    if (!rSnap.exists) throw new Error('Round not found');
    const round = rSnap.data();

    if (op === 'reveal') {
      if (round.status !== 'submission') throw new Error('The decks are already revealed');
      const waiting = cbActivePids(l).filter((p) => !round.submitted?.[p]);
      if (waiting.length && !req.body.force) {
        throw new Error(`Still waiting for ${waiting.length} deck(s) — force to reveal without them`);
      }
      await cbReveal(leagueId, l);
      res.json({ ok: true });
      return;
    }

    if (op === 'deadline') {
      if (round.status !== 'submission') throw new Error('The decks are already revealed');
      const deadline = +req.body.deadline;
      if (!Number.isFinite(deadline) || deadline < Date.now()) {
        throw new Error('The deadline must be in the future');
      }
      await rRef.update({ deadline, remindedAt: null });
      res.json({ ok: true });
      return;
    }

    if (op === 'resolve') {
      if (round.status !== 'playing') throw new Error('This round is not in play');
      const { matchId, result } = req.body;
      const m = round.matches?.[matchId];
      if (!m) throw new Error('Match not found');
      if (!Array.isArray(result) || result.length !== 2 ||
          result.some((g) => !['W', 'D', 'L'].includes(g))) {
        throw new Error('Result must be two games of W, D or L');
      }
      await rRef.update({
        [`matches.${matchId}.result`]: result,
        [`matches.${matchId}.pts`]: {
          [m.a]: matchPoints(result),
          [m.b]: matchPoints(mirrorResult(result)),
        },
        [`matches.${matchId}.disputed`]: false,
        [`matches.${matchId}.resolvedBy`]: 'admin',
      });
      const fresh = (await rRef.get()).data();
      if (Object.values(fresh.matches || {}).every((x) => x.result)) {
        await cbFinishRound(leagueId, l, l.curRound);
      }
      res.json({ ok: true });
      return;
    }

    if (op === 'finish-league') {
      if (round.status !== 'done') throw new Error('Finish or resolve the current round first');
      await lRef.update({ status: 'done' });
      res.json({ ok: true });
      return;
    }

    throw new Error('Unknown op');
  } catch (e) {
    res.status(400).json({ error: e.message || 'Request failed' });
  }
});

// ---------------------------------------------------------------
// HTTP: a player reports their match result (two games, from their
// own perspective). Stored canonically from player a's perspective;
// matching reports confirm the result, conflicting reports flag the
// match and notify the admin.
// ---------------------------------------------------------------
exports.cbReport = onRequest({ cors: true, secrets: [VAPID_PRIVATE] }, async (req, res) => {
  let decoded;
  try { decoded = await requireAuth(req); } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const { leagueId, round, matchId, games } = req.body || {};
    if (typeof leagueId !== 'string' || !/^[\w-]{1,40}$/.test(leagueId) ||
        !Number.isInteger(round) || round < 1 ||
        typeof matchId !== 'string' || matchId.length > 90 ||
        !Array.isArray(games) || games.length !== 2 ||
        games.some((g) => !['W', 'D', 'L'].includes(g))) {
      res.status(400).json({ error: 'Bad request' });
      return;
    }
    const lSnap = await db.doc(`cb-leagues/${leagueId}`).get();
    if (!lSnap.exists) { res.status(404).json({ error: 'League not found' }); return; }
    const l = lSnap.data();
    if (l.archived) throw new Error('This league is archived (read only)');
    const pid = (l.uids || {})[decoded.uid];
    if (!pid) throw new Error('You are not seated in this league');
    const rRef = db.doc(`cb-leagues/${leagueId}/rounds/${round}`);

    let becameDisputed = false;
    let allDone = false;
    await db.runTransaction(async (t) => {
      const snap = await t.get(rRef);
      if (!snap.exists) throw new Error('Round not found');
      const r = snap.data();
      if (r.status !== 'playing') throw new Error('This round is not in play');
      const m = r.matches?.[matchId];
      if (!m) throw new Error('Match not found');
      if (m.a !== pid && m.b !== pid) throw new Error('This is not your match');
      if (m.result) throw new Error('This result is already confirmed');
      // canonical = player a's perspective, game 1 with a on the play
      const canonical = pid === m.a ? games : mirrorResult(games);
      const reports = { ...(m.reports || {}), [pid]: canonical };
      const other = m.a === pid ? m.b : m.a;
      const patch = { [`matches.${matchId}.reports.${pid}`]: canonical };
      if (reports[other]) {
        if (reports[other].join('') === canonical.join('')) {
          patch[`matches.${matchId}.result`] = canonical;
          patch[`matches.${matchId}.pts`] = {
            [m.a]: matchPoints(canonical),
            [m.b]: matchPoints(mirrorResult(canonical)),
          };
          patch[`matches.${matchId}.disputed`] = false;
          patch[`matches.${matchId}.resolvedBy`] = 'agree';
          allDone = Object.entries(r.matches).every(([id, x]) => id === matchId || x.result);
        } else {
          becameDisputed = !m.disputed;
          patch[`matches.${matchId}.disputed`] = true;
        }
      }
      t.update(rRef, patch);
    });

    if (becameDisputed) {
      const m = (await rRef.get()).data().matches[matchId];
      const nameA = l.players?.[m.a]?.name || '?';
      const nameB = l.players?.[m.b]?.name || '?';
      const adminPid = cbAdminPid(l);
      if (adminPid) {
        await cbPush(leagueId, adminPid, {
          title: l.name || 'Card Blind',
          body: `Conflicting results from ${nameA} and ${nameB} in round ${round} — please resolve.`,
          url: `/4cb?l=${leagueId}`,
          tag: 'cb-dispute',
        });
      }
    }
    if (allDone) await cbFinishRound(leagueId, l, round);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Report failed' });
  }
});

// ---------------------------------------------------------------
// HTTP: per-match chat/notes. Visible only to the two players of
// the match and the league admin; written only here so membership
// can't be spoofed. Notifies the other side of the conversation.
// ---------------------------------------------------------------
exports.cbChat = onRequest({ cors: true, secrets: [VAPID_PRIVATE] }, async (req, res) => {
  let decoded;
  try { decoded = await requireAuth(req); } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const { leagueId, round, matchId, text } = req.body || {};
    const msg = typeof text === 'string' ? text.trim() : '';
    if (typeof leagueId !== 'string' || !/^[\w-]{1,40}$/.test(leagueId) ||
        !Number.isInteger(round) || round < 1 ||
        typeof matchId !== 'string' || !/^[\w-]{1,90}$/.test(matchId) ||
        !msg || msg.length > 500) {
      res.status(400).json({ error: 'Bad request' });
      return;
    }
    const lSnap = await db.doc(`cb-leagues/${leagueId}`).get();
    if (!lSnap.exists) { res.status(404).json({ error: 'League not found' }); return; }
    const l = lSnap.data();
    if (l.archived) throw new Error('This league is archived (read only)');
    const isAdmin = decoded.uid === l.adminUid || emailHash(decoded) === OWNER_HASH;
    const pid = (l.uids || {})[decoded.uid] || null;
    const cRef = db.doc(`cb-leagues/${leagueId}/matchchat/${round}_${matchId}`);
    const cSnap = await cRef.get();
    if (!cSnap.exists) throw new Error('Match not found');
    const c = cSnap.data();
    const isPlayer = pid === c.a || pid === c.b;
    if (!isPlayer && !isAdmin) {
      res.status(403).json({ error: 'This match is not yours' });
      return;
    }
    if ((c.msgs || []).length >= 300) throw new Error('This match chat is full');
    const name = isPlayer
      ? l.players?.[pid]?.name || '?'
      : 'Admin';
    await cRef.update({
      msgs: FieldValue.arrayUnion({ pid: isPlayer ? pid : 'admin', name, text: msg, at: Date.now() }),
    });
    // notify the other side (both players when the admin writes)
    const targets = isPlayer ? [pid === c.a ? c.b : c.a] : [c.a, c.b];
    for (const t of targets) {
      await cbPush(leagueId, t, {
        title: l.name || 'Card Blind',
        body: `${name} (round ${round} match): ${msg.slice(0, 120)}`,
        url: `/4cb?l=${leagueId}`,
        tag: 'cb-chat',
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Sending failed' });
  }
});

// ---------------------------------------------------------------
// Scheduled: reveal rounds whose deadline has passed, and remind
// players who haven't submitted ~24h before the deadline.
// ---------------------------------------------------------------
exports.cbTick = onSchedule(
  { schedule: 'every 5 minutes', secrets: [VAPID_PRIVATE] },
  async () => {
    const snaps = await db.collection('cb-leagues')
      .where('status', '==', 'active')
      .get();
    for (const lSnap of snaps.docs) {
      const l = lSnap.data();
      if (l.archived || !l.curRound) continue;
      const rRef = db.doc(`cb-leagues/${lSnap.id}/rounds/${l.curRound}`);
      const rDoc = await rRef.get();
      if (!rDoc.exists) continue;
      const round = rDoc.data();
      if (round.status !== 'submission') continue;
      if (Date.now() > round.deadline) {
        await cbReveal(lSnap.id, l);
        continue;
      }
      const msLeft = round.deadline - Date.now();
      if (msLeft < 24 * 3600e3 && !round.remindedAt) {
        await rRef.update({ remindedAt: Date.now() });
        const hours = Math.max(1, Math.round(msLeft / 3600e3));
        for (const pid of cbActivePids(l)) {
          if (round.submitted?.[pid]) continue;
          await cbPush(lSnap.id, pid, {
            title: l.name || 'Card Blind',
            body: `About ${hours}h left to submit your deck for round ${l.curRound}!`,
            url: `/4cb?l=${lSnap.id}`,
            tag: 'cb-deadline',
          });
        }
      }
    }
  }
);

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
