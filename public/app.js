// Rotisserie Draft — MTG rotisserie drafting with live picks, queues & push
import { db, auth } from './firebase-init.js';
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction,
  collection, getDocs, arrayUnion, deleteField, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js';
import {
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js';

const VAPID_PUBLIC =
  'BBwWu4Duu4THhbcxb1fJofvfaWQgu13WHe6OnvDkHA23yU7fcCfpe-MShsMtsqOc84K_ruonzvVh_Z0M12zsGqY';
const BASE = location.origin + location.pathname;

const ICON_BELL_ON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const ICON_BELL_OFF =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
// SHA-256 of the site owner's email — identifies the owner in public
// code without publishing the address itself.
const OWNER_HASH = '91fa8e4aaa27cba1007cef4cce055e11b2b60e9c651effd795a8a6f5a9a82fc8';
const isOwner = () => !!state.user && !!state.ownerOk;
async function checkOwner(user) {
  if (!user?.email || !crypto?.subtle) return false;
  const buf = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(user.email.toLowerCase()));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === OWNER_HASH;
}

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------
const state = {
  draftId: null,
  draft: null,       // main draft doc
  pool: null,        // [{n,img,m,t,c,v,r}] — instance id = array index
  myPriv: null,      // my private doc {secret, queue, pushSubs}
  user: null,        // firebase auth user
  creds: null,       // {pid, secret, adminSecret?}
  tab: 'pool',
  selPlayer: null,
  filters: { search: '', colors: new Set(), types: new Set(), hidePicked: false, sort: 'pool' },
  groupByType: true,
  pushOn: false,
  pushEndpoint: null, // this device's push subscription endpoint
  unsubDraft: null,
  unsubPriv: null,
};

// Push is "on" only if THIS device's subscription is registered in my
// private doc (another device's subscription shouldn't light the bell).
function computePushOn() {
  return !!state.pushEndpoint &&
    ('Notification' in window) && Notification.permission === 'granted' &&
    (state.myPriv?.pushSubs || []).some((s) => s.endpoint === state.pushEndpoint);
}

// ----------------------------------------------------------------
// Utils
// ----------------------------------------------------------------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = (n = 12) => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => chars[b % chars.length]).join('');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function copyText(text, label = 'Link') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`);
  } catch {
    prompt('Copy this:', text);
  }
}

function closeModal() { $('#modal-root').innerHTML = ''; }
function openModal(html) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  $('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// localStorage creds: { [draftId]: {pid, secret, adminSecret, name, draftName} }
function allCreds() {
  try { return JSON.parse(localStorage.getItem('rd_creds') || '{}'); } catch { return {}; }
}
function saveCreds(draftId, patch) {
  const all = allCreds();
  all[draftId] = { ...(all[draftId] || {}), ...patch };
  localStorage.setItem('rd_creds', JSON.stringify(all));
  if (draftId === state.draftId) state.creds = all[draftId];
}

// ----------------------------------------------------------------
// Draft logic (mirrored in functions/index.js)
// ----------------------------------------------------------------
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
        if (count[i] < totalPicks) { seq.push(i); count[i]++; }
      }
    }
    round++;
  }
  return seq;
}
function settingsOf(d) {
  const s = d.settings || {};
  return {
    players: s.players || 8,
    totalPicks: s.totalPicks || 40,
    singleRounds: s.singleRounds ?? 20,
    reminderHours: s.reminderHours ?? 24,
  };
}
function draftView(d) {
  const s = settingsOf(d);
  const order = d.order || [];
  const seq = order.length ? buildSeq(order.length, s.totalPicks, s.singleRounds) : [];
  const picks = d.picks || [];
  const done = seq.length > 0 && picks.length >= seq.length;
  const curPid = !done && seq.length ? order[seq[picks.length]] : null;
  const pickedIds = new Set(picks.map((p) => p.c));
  return { s, order, seq, picks, done, curPid, pickedIds };
}
function myPid() { return state.creds?.pid || null; }
function isAdmin() { return !!state.creds?.adminSecret; }

// ----------------------------------------------------------------
// Boot / routing
// ----------------------------------------------------------------
function parseParams() {
  const p = new URLSearchParams(location.search);
  const draftId = p.get('d');
  if (draftId) {
    if (p.get('p') && p.get('s')) saveCreds(draftId, { pid: p.get('p'), secret: p.get('s') });
    if (p.get('a')) saveCreds(draftId, { adminSecret: p.get('a') });
    if (p.get('p') || p.get('a')) history.replaceState(null, '', `${location.pathname}?d=${draftId}`);
  }
  return draftId;
}

async function boot() {
  document.addEventListener('click', (e) => {
    const menu = $('#user-menu');
    if (menu && menu.style.display !== 'none' &&
        !e.target.closest('#user-menu') && !e.target.closest('#auth-btn')) {
      menu.style.display = 'none';
    }
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => reg.pushManager?.getSubscription())
      .then((sub) => {
        state.pushEndpoint = sub?.endpoint || null;
        state.pushOn = computePushOn();
        if (state.draft) render();
      })
      .catch(() => {});
  }
  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    state.ownerOk = await checkOwner(user);
    if (state.draft) {
      tryUidRejoin();
      recordMembership();
      render();
    } else if (!state.draftId) {
      routeHome(); // re-render so the auth button + dashboard update
    }
  });
  state.draftId = parseParams();
  if (!state.draftId) {
    window.addEventListener('hashchange', routeHome);
    routeHome();
    return;
  }
  state.creds = allCreds()[state.draftId] || null;
  subscribeDraft();
}

function subscribeDraft() {
  const ref = doc(db, 'rd-drafts', state.draftId);
  state.unsubDraft = onSnapshot(ref, async (snap) => {
    if (!snap.exists()) {
      $('#app').innerHTML = `<div class="container"><div class="panel empty">
        Draft not found. <br><br><a class="btn" href="${BASE}">← Home</a></div></div>`;
      return;
    }
    const first = !state.draft;
    state.draft = snap.data();
    if (first) {
      saveCreds(state.draftId, { draftName: state.draft.name });
      tryUidRejoin();
      recordMembership();
      subscribeMyPriv();
    }
    if ((state.draft.status === 'active' || state.draft.status === 'done') && !state.pool) {
      await loadPool();
      render();
      return;
    }
    render();
  }, (e) => {
    console.error(e);
    toast('Connection error: ' + e.message, true);
  });
}

async function loadPool() {
  const snap = await getDoc(doc(db, 'rd-drafts', state.draftId, 'meta', 'pool'));
  state.pool = snap.exists() ? snap.data().cards : [];
}

function subscribeMyPriv() {
  if (state.unsubPriv) { state.unsubPriv(); state.unsubPriv = null; }
  if (!myPid()) return;
  state.unsubPriv = onSnapshot(
    doc(db, 'rd-drafts', state.draftId, 'private', myPid()),
    (snap) => {
      state.myPriv = snap.exists() ? snap.data() : null;
      state.pushOn = computePushOn();
      render();
    }
  );
}

// Mirror my membership into rd-users/{uid} so the dashboard can find
// drafts across devices. Safe to call often (merge write, no-op if signed out).
async function recordMembership(draftId = state.draftId, draftName, role) {
  if (!state.user || !draftId) return;
  if (draftId === state.draftId) {
    if (!state.creds?.pid && !state.creds?.adminSecret) return;
    draftName = draftName ?? state.draft?.name ?? '';
    role = role ?? (state.creds?.adminSecret ? 'admin' : 'player');
  }
  try {
    await setDoc(doc(db, 'rd-users', state.user.uid), {
      drafts: { [draftId]: { name: draftName || '', role: role || 'player', at: Date.now() } },
    }, { merge: true });
  } catch (e) { console.warn('recordMembership failed', e); }
}

async function tryUidRejoin() {
  const d = state.draft;
  if (!d || !state.user || myPid()) return;
  const match = Object.entries(d.players || {}).find(([, p]) => p.uid === state.user.uid);
  if (!match) return;
  const [pid] = match;
  const priv = await getDoc(doc(db, 'rd-drafts', state.draftId, 'private', pid));
  saveCreds(state.draftId, { pid, secret: priv.exists() ? priv.data().secret : '' });
  subscribeMyPriv();
  recordMembership();
  toast(`Welcome back, ${d.players[pid].name}!`);
  render();
}

// ----------------------------------------------------------------
// Focus preservation across re-renders
// ----------------------------------------------------------------
function render() {
  if (state.dragLock) return; // don't rebuild the DOM mid-drag
  const active = document.activeElement;
  const focusId = active?.id;
  let selStart = null;
  try { selStart = active?.selectionStart; } catch {} // throws on number/checkbox inputs
  const d = state.draft;
  if (!d) return;
  if (d.status === 'lobby') renderLobby();
  else {
    if (!state.pool) return; // pool fetch in flight; loadPool() re-renders
    renderDraft();
  }
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch {}
    }
  }
}

// ----------------------------------------------------------------
// HOME routing: landing page for visitors, app home for players
// ----------------------------------------------------------------
function routeHome() {
  if (location.hash === '#contact') return renderContact();
  if (location.hash === '#app') return renderHome();
  renderLanding(); // the landing is always the main page (incl. #about)
}

function landingHeader(page) {
  return `<header class="landing-header">
    <a class="wordmark" href="#about">Rotisserie Draft</a>
    <nav class="landing-nav">
      ${page === 'landing'
        ? '<a href="#" data-scroll="how">How it works</a>'
        : '<a href="#about">How it works</a>'}
      <a href="#contact">Contact</a>
      <button class="btn btn-sm landing-signin">${state.user ? 'Open the app' : 'Sign in'}</button>
    </nav>
  </header>`;
}

function bindLandingChrome() {
  $$('[data-scroll]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    $(`#sec-${a.dataset.scroll}`)?.scrollIntoView({ behavior: 'smooth' });
  }));
  $$('.landing-signin').forEach((b) => b.addEventListener('click', async () => {
    if (state.user) { location.hash = '#app'; return; }
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      // auth listener re-renders; signed-in landing shows ongoing drafts
    } catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast(e.message, true); }
  }));
}

// ----------------------------------------------------------------
// LANDING — how it works, CTA, sign-in, contact
// ----------------------------------------------------------------
function renderLanding() {
  const signedIn = !!state.user;
  const hasDrafts = signedIn || Object.keys(allCreds()).length > 0;
  $('#app').innerHTML = `
    ${landingHeader('landing')}
    <div class="landing">
      ${hasDrafts ? `
      <section class="mydrafts" id="landing-drafts" style="display:none">
        <div class="mydrafts-head">
          <span class="eyebrow" style="margin:0">Your ongoing drafts</span>
          <a href="#app">Open the app</a>
        </div>
        <div id="landing-drafts-list"></div>
      </section>` : ''}
      <section class="hero">
        <p class="eyebrow">A slow draft format for Magic: The Gathering</p>
        <h1>Draft the whole cube.<br>Face up.</h1>
        <p class="lead">The entire card pool is visible to every player. Picks happen one at a
        time in snake order, and a draft runs over hours or days at your own pace. Push
        notifications make sure nobody misses a turn.</p>
        <div class="hero-cta">
          <a class="btn btn-primary btn-lg" href="#app">Start a draft</a>
          <button class="btn btn-lg landing-signin">${signedIn ? 'Open the app' : 'Sign in or register'}</button>
        </div>
        <p class="finehint">Free and without ads. Creating a draft requires a Google account.
        Players join with a link, no account needed.</p>
      </section>

      <section class="how" id="sec-how">
        <p class="eyebrow">How it works</p>
        <div class="steps2">
          <div class="stepn"><div class="num">01</div><h3>Create a draft</h3>
            <p>Import a cube from <a href="https://cubecobra.com" target="_blank" rel="noopener">CubeCobra</a>
            or paste any card list. Choose the number of players, the deck size, and when the
            draft switches to two picks per turn.</p></div>
          <div class="stepn"><div class="num">02</div><h3>Invite your group</h3>
            <p>Share a single link. Everyone chooses a name and receives a private link to
            rejoin, or signs in with Google to switch devices at any time. When the table is
            full, the seat order is randomized and the draft begins.</p></div>
          <div class="stepn"><div class="num">03</div><h3>Draft in the open</h3>
            <p>Browse the full pool with filters and card previews, follow every deck as it
            grows, and track the whole draft on a live grid board.</p></div>
          <div class="stepn"><div class="num">04</div><h3>Never miss a turn</h3>
            <p>Receive a push notification when you are up. Queue cards to draft automatically
            while you are away. If another player takes a queued card, the draft pauses and
            waits for your decision. Reminders nudge slow pickers, and bots can fill empty
            seats.</p></div>
        </div>
      </section>

      <footer class="landing-footer">
        <span>Built for slow drafting with friends. No ads. No tracking.</span>
        <a href="#contact">Contact</a>
        <a href="#app">Open the app</a>
      </footer>
    </div>`;
  bindLandingChrome();
  loadLandingDrafts();
}

// Merge drafts known to this device (localStorage) with drafts recorded
// under the signed-in account (rd-users/{uid}).
async function collectDraftEntries() {
  const entries = {};
  for (const [id, c] of Object.entries(allCreds())) {
    entries[id] = { name: c.draftName || id, admin: !!c.adminSecret, pid: c.pid || null };
  }
  if (state.user) {
    try {
      const snap = await getDoc(doc(db, 'rd-users', state.user.uid));
      if (snap.exists()) {
        for (const [id, info] of Object.entries(snap.data().drafts || {})) {
          entries[id] = {
            name: info.name || entries[id]?.name || id,
            admin: entries[id]?.admin || info.role === 'admin',
            pid: entries[id]?.pid || null,
          };
        }
      }
    } catch (e) { console.warn('rd-users load failed', e); }
  }
  return entries;
}

// Ongoing drafts strip at the top of the landing page.
async function loadLandingDrafts() {
  const listEl = $('#landing-drafts-list');
  if (!listEl) return;
  const entries = await collectDraftEntries();
  const rows = await Promise.all(Object.entries(entries).map(async ([id, e]) => {
    try {
      const snap = await getDoc(doc(db, 'rd-drafts', id));
      if (!snap.exists()) return null;
      const d = snap.data();
      if (d.status === 'done') return null;
      return dashRow(id, d, { admin: e.admin, pid: e.pid });
    } catch { return null; }
  }));
  const list = rows.filter(Boolean).sort((a, b) => a.sortKey - b.sortKey || b.at - a.at).slice(0, 6);
  if (!list.length) return;
  listEl.innerHTML = list.map((r) => r.html).join('');
  const sec = $('#landing-drafts');
  if (sec) sec.style.display = 'block';
}

// ----------------------------------------------------------------
// CONTACT — separate page
// ----------------------------------------------------------------
function renderContact() {
  $('#app').innerHTML = `
    ${landingHeader('contact')}
    <div class="landing">
      <section class="contact2">
        <p class="eyebrow">Contact</p>
        <h1 class="pagetitle">Get in touch</h1>
        <p class="lead2">Questions, bug reports, or ideas? Send a message and you will hear
        back soon.</p>
        <div class="row">
          <div class="field"><label>Name (optional)</label>
            <input type="text" id="ct-name" maxlength="120"></div>
          <div class="field"><label>Email (optional, for a reply)</label>
            <input type="text" id="ct-email" maxlength="200"></div>
        </div>
        <input type="text" id="ct-website" style="display:none" tabindex="-1" autocomplete="off">
        <div class="field"><label>Message</label>
          <textarea id="ct-msg" maxlength="3000"></textarea></div>
        <button class="btn btn-primary" id="ct-send">Send message</button>
      </section>
      <footer class="landing-footer">
        <span>Built for slow drafting with friends. No ads. No tracking.</span>
        <a href="#about">About</a>
        <a href="#app">Open the app</a>
      </footer>
    </div>`;
  bindLandingChrome();
  $('#ct-send').addEventListener('click', async () => {
    const btn = $('#ct-send');
    const message = $('#ct-msg').value.trim();
    if (message.length < 3) { toast('Please write a message first.', true); return; }
    btn.disabled = true;
    try {
      const res = await fetch('/api/rd/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: $('#ct-name').value.trim(),
          email: $('#ct-email').value.trim(),
          message,
          website: $('#ct-website').value, // honeypot
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sending failed');
      $('#ct-msg').value = ''; $('#ct-name').value = ''; $('#ct-email').value = '';
      toast('Message sent. Thank you!');
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  });
}

// ----------------------------------------------------------------
// HOME — create draft + my drafts
// ----------------------------------------------------------------
function renderHome() {
  $('#app').innerHTML = `
    ${topbar('Rotisserie Draft', 'MTG snake draft from a shared pool')}
    <div class="container">
      <div class="panel" id="dash-panel">
        <h2 style="margin-top:0">Your drafts</h2>
        <div id="dash">${state.user || Object.keys(allCreds()).length
          ? '<p class="hint">Loading…</p>'
          : '<p class="hint">No drafts yet. Sign in with Google to see drafts from other devices, or create one below.</p>'}</div>
      </div>
      ${isOwner() ? `<div class="panel">
        <h2 style="margin-top:0">All drafts <span class="dash-as">site admin</span></h2>
        <div id="dash-all"><p class="hint">Loading…</p></div>
      </div>` : ''}
      <div class="panel">
        <h1>New Rotisserie Draft</h1>
        <p class="hint">Everyone sees the whole pool and drafts one card at a time, snake order
        (1→8, 8→1, …). After a while players pick 2 cards per turn.</p>
        <div class="field"><label>Draft name</label>
          <input type="text" id="c-name" placeholder="e.g. Legacy Cube Rotisserie 2026"></div>
        <div class="field"><label>CubeCobra link or cube id</label>
          <input type="text" id="c-cube" placeholder="https://cubecobra.com/cube/list/cr_cu_cube"></div>
        <div class="field">
          <label><input type="checkbox" id="c-usetext"> …or paste a card list instead</label>
          <textarea id="c-text" style="display:none" placeholder="1 Lightning Bolt\n2 Squadron Hawk\nBrainstorm"></textarea>
        </div>
        <div class="row">
          <div class="field"><label>Players</label>
            <input type="number" id="c-players" value="8" min="2" max="16"></div>
          <div class="field"><label>Cards per player</label>
            <input type="number" id="c-total" value="40" min="4" max="100"></div>
          <div class="field"><label>Single-pick rounds</label>
            <input type="number" id="c-single" value="20" min="0" max="100"></div>
          <div class="field"><label>Reminder after (h)</label>
            <input type="number" id="c-remind" value="24" min="0" max="168"></div>
        </div>
        <p class="hint">Single-pick rounds: how many rounds are 1 card per turn before switching
        to 2 cards per turn. Reminder 0 = off.</p>
        ${state.user
          ? '<button class="btn btn-primary btn-block" id="c-go">Create draft</button>'
          : `<p class="hint">Creating a draft requires an account, so you can manage it later from any device.</p>
             <button class="btn btn-primary btn-block" id="c-signin">Sign in with Google to create</button>`}
        <p class="hint" id="c-status"></p>
      </div>
      ${isOwner() ? `<div class="panel">
        <h2 style="margin-top:0">Contact messages <span class="dash-as">site admin</span></h2>
        <div id="dash-contact"><p class="hint">Loading…</p></div>
      </div>` : ''}
      <p class="hint" style="text-align:center"><a href="#about">About & contact</a></p>
    </div>`;
  bindTopbar();
  $('#c-usetext').addEventListener('change', (e) => {
    $('#c-text').style.display = e.target.checked ? 'block' : 'none';
    $('#c-cube').disabled = e.target.checked;
  });
  $('#c-go')?.addEventListener('click', createDraft);
  $('#c-signin')?.addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      // auth listener re-renders with the create button enabled
    } catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast(e.message, true); }
  });
  loadDashboard();
}

// Dashboard: merge drafts from this device (localStorage) with drafts
// recorded under my Google account (rd-users/{uid}), then fetch live status.
async function loadDashboard() {
  const dashEl = $('#dash');
  if (!dashEl) return;
  const entries = await collectDraftEntries();
  if (!Object.keys(entries).length) {
    dashEl.innerHTML = '<p class="hint">No drafts yet. Sign in with Google to see drafts from other devices, or create one below.</p>';
    return;
  }
  const rows = await Promise.all(Object.entries(entries).map(async ([id, e]) => {
    try {
      const snap = await getDoc(doc(db, 'rd-drafts', id));
      if (!snap.exists()) return null; // deleted draft — drop silently
      return dashRow(id, snap.data(), { admin: e.admin, pid: e.pid });
    } catch { return null; }
  }));
  const list = rows.filter(Boolean).sort((a, b) => a.sortKey - b.sortKey || b.at - a.at);
  dashEl.innerHTML = list.length
    ? list.map((r) => r.html).join('')
    : '<p class="hint">No drafts yet. Create one below!</p>';
  loadOwnerDashboard();
}

// One dashboard row: name, who joined, current pick + whose turn, settings.
function dashRow(id, d, { admin = false, pid = null, ownerMode = false } = {}) {
  const s = settingsOf(d);
  if (!pid && state.user) {
    pid = Object.entries(d.players || {}).find(([, p]) => p.uid === state.user.uid)?.[0] || null;
  }
  const playerNames = Object.values(d.players || {}).map((p) => p.name);
  let statusTxt = '', myTurn = false, sortKey = 0;
  if (d.status === 'lobby') {
    statusTxt = `Lobby — waiting for players (${playerNames.length}/${s.players})`;
    sortKey = 2;
  } else if (d.status === 'done') {
    statusTxt = 'Complete';
    sortKey = 3;
  } else {
    const v = draftView(d);
    const curName = d.players?.[v.curPid]?.name || '?';
    myTurn = !!pid && v.curPid === pid;
    statusTxt = `Pick ${v.picks.length + 1}/${v.seq.length} — ${myTurn ? 'YOUR turn' : `${esc(curName)}'s turn`}`;
    sortKey = myTurn ? 0 : 1;
  }
  const myName = pid ? d.players?.[pid]?.name : null;
  const meta = [
    `${playerNames.length}/${s.players} players: ${playerNames.map(esc).join(', ') || '—'}`,
    `${s.totalPicks} cards each`,
    `${s.singleRounds} single rounds`,
    s.reminderHours ? `${s.reminderHours}h reminder` : 'no reminder',
  ].join(' · ');
  const href = ownerMode && d.adminSecret
    ? `${BASE}?d=${id}&a=${encodeURIComponent(d.adminSecret)}`
    : `${BASE}?d=${id}`;
  return {
    id, sortKey, myTurn, at: d.createdAt || 0,
    html: `<div class="dash-row ${myTurn ? 'myturn' : ''}">
      <div class="dash-info">
        <div class="dash-name">${esc(d.name || id)}
          ${admin ? '<span class="admintag" title="you are the admin">admin</span>' : ''}
          ${myName ? `<span class="dash-as">as ${esc(myName)}</span>` : '<span class="dash-as">not joined</span>'}</div>
        <div class="dash-status">${statusTxt}</div>
        <div class="dash-meta">${meta}</div>
      </div>
      <a class="btn btn-sm ${myTurn ? 'btn-primary' : ''}" href="${href}">${ownerMode ? 'Open as admin' : 'Open'}</a>
    </div>`,
  };
}

// Site owner: list EVERY draft in the system, with open-as-admin links.
async function loadOwnerDashboard() {
  const el = $('#dash-all');
  if (!el || !isOwner()) return;
  try {
    const snaps = await getDocs(collection(db, 'rd-drafts'));
    const rows = [];
    snaps.forEach((snap) => rows.push(dashRow(snap.id, snap.data(), { admin: true, ownerMode: true })));
    rows.sort((a, b) => a.sortKey - b.sortKey || b.at - a.at);
    el.innerHTML = rows.length
      ? rows.map((r) => r.html).join('')
      : '<p class="hint">No drafts exist yet.</p>';
  } catch (e) {
    el.innerHTML = `<p class="hint">Failed to load: ${esc(e.message)}</p>`;
  }
  loadContactMessages();
}

async function inboxCall(body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch('/api/rd/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Inbox request failed');
  return data;
}

async function loadContactMessages() {
  const el = $('#dash-contact');
  if (!el || !isOwner()) return;
  try {
    const { messages } = await inboxCall({});
    el.innerHTML = messages.length ? messages.map((m) => `
      <div class="dash-row">
        <div class="dash-info">
          <div class="dash-name">${esc(m.name || 'anonymous')}
            ${m.email ? `<span class="dash-as">${esc(m.email)}</span>` : ''}
            <span class="dash-as">${new Date(m.at || 0).toLocaleString()}</span></div>
          <div class="dash-status" style="white-space:pre-wrap">${esc(m.message)}</div>
        </div>
        <button class="btn btn-sm btn-danger" data-delmsg="${esc(m.id)}">✕</button>
      </div>`).join('') : '<p class="hint">No messages.</p>';
    $$('[data-delmsg]', el).forEach((b) => b.addEventListener('click', async () => {
      await inboxCall({ op: 'delete', id: b.dataset.delmsg });
      loadContactMessages();
    }));
  } catch (e) { el.innerHTML = `<p class="hint">Failed to load: ${esc(e.message)}</p>`; }
}

function topbar(title, sub = '', showBell = false) {
  return `<div class="topbar">
    <a class="logo" href="${BASE}">RD</a>
    <div class="title">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    ${showBell ? `<button class="iconbtn ${state.pushOn ? 'on' : ''}" id="bell-btn"
      title="${state.pushOn ? 'Notifications on — click to turn off' : 'Notifications off — click to enable'}">${state.pushOn ? ICON_BELL_ON : ICON_BELL_OFF}</button>` : ''}
    ${state.user
      ? `<button class="iconbtn userbtn" id="auth-btn" title="Signed in as ${esc(state.user.displayName || state.user.email)}">
           ${state.user.photoURL
             ? `<img class="avatar" src="${esc(state.user.photoURL)}" alt="" referrerpolicy="no-referrer">`
             : `<span class="avatar avatar-letter">${esc((state.user.displayName || state.user.email || '?')[0].toUpperCase())}</span>`}
           <span class="userbtn-name">${esc((state.user.displayName || state.user.email || '').split(' ')[0])}</span>
         </button>
         <div class="usermenu" id="user-menu" style="display:none">
           <div class="usermenu-note">${esc(state.user.email || '')}</div>
           <a class="usermenu-item" href="${BASE}">My Drafts</a>
           <button class="usermenu-item" id="menu-logout">Sign out</button>
         </div>`
      : `<button class="iconbtn" id="auth-btn" title="Sign in with Google">Sign in</button>`}
  </div>`;
}
function bindTopbar() {
  $('#bell-btn')?.addEventListener('click', togglePush);
  $('#auth-btn')?.addEventListener('click', async () => {
    if (state.user) {
      const menu = $('#user-menu');
      if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      return;
    }
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      toast('Signed in.');
    } catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast(e.message, true); }
  });
  $('#menu-logout')?.addEventListener('click', async () => {
    if (!confirm(`Sign out ${state.user?.displayName || state.user?.email}?`)) return;
    await signOut(auth);
    toast('Signed out.');
  });
}

// ----------------------------------------------------------------
// Create draft
// ----------------------------------------------------------------
function parseCubeId(input) {
  const m = input.match(/cubecobra\.com\/cube\/[a-z]+\/([\w-]+)/i);
  if (m) return m[1];
  if (/^[\w-]+$/.test(input.trim())) return input.trim();
  return null;
}

function parseTextList(text) {
  const names = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = line.match(/^(\d+)x?\s+(.+)$/);
    let count = 1, name = line;
    if (m) { count = Math.min(parseInt(m[1], 10), 50); name = m[2].trim(); }
    for (let i = 0; i < count; i++) names.push(name);
  }
  return names;
}

async function resolveScryfall(names, statusEl) {
  const unique = [...new Set(names.map((n) => n.toLowerCase()))];
  const nameMap = {};
  const notFound = [];
  const uniqOrig = [...new Set(names)];
  for (let i = 0; i < uniqOrig.length; i += 75) {
    const batch = uniqOrig.slice(i, i + 75);
    statusEl.textContent = `Fetching card data… ${Math.min(i + 75, uniqOrig.length)}/${uniqOrig.length}`;
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    });
    if (!res.ok) throw new Error('Scryfall error ' + res.status);
    const data = await res.json();
    for (const card of data.data || []) {
      const info = {
        n: card.name,
        img: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null,
        m: card.mana_cost || card.card_faces?.map((f) => f.mana_cost).filter(Boolean).join(' // ') || '',
        t: card.type_line || card.card_faces?.[0]?.type_line || '',
        c: (card.colors?.length ? card.colors : card.card_faces?.flatMap((f) => f.colors || []) || []).join(''),
        v: card.cmc ?? 0,
        r: card.rarity || '',
      };
      nameMap[card.name.toLowerCase()] = info;
      if (card.card_faces?.length) nameMap[card.card_faces[0].name.toLowerCase()] = info;
    }
    for (const nf of data.not_found || []) notFound.push(nf.name);
    await sleep(120);
  }
  void unique;
  return { nameMap, notFound };
}

async function createDraft() {
  if (!state.user) { toast('Please sign in to create a draft.', true); return; }
  const btn = $('#c-go'), statusEl = $('#c-status');
  const name = $('#c-name').value.trim() || 'Rotisserie Draft';
  const players = Math.max(2, Math.min(16, parseInt($('#c-players').value, 10) || 8));
  const totalPicks = Math.max(4, parseInt($('#c-total').value, 10) || 40);
  const singleRounds = Math.max(0, Math.min(totalPicks, parseInt($('#c-single').value, 10) || 0));
  const reminderHours = Math.max(0, parseInt($('#c-remind').value, 10) || 0);
  const useText = $('#c-usetext').checked;

  btn.disabled = true;
  try {
    let cubeCards, cubeUrl = ''; // [{name, elo}]
    if (useText) {
      cubeCards = parseTextList($('#c-text').value).map((name) => ({ name, elo: 0 }));
      if (!cubeCards.length) throw new Error('Card list is empty.');
    } else {
      const cubeId = parseCubeId($('#c-cube').value);
      if (!cubeId) throw new Error('Enter a CubeCobra link (or check "paste a card list").');
      cubeUrl = `https://cubecobra.com/cube/list/${cubeId}`;
      statusEl.textContent = 'Fetching cube from CubeCobra…';
      const res = await fetch(`/api/rd/fetchCube?cube=${encodeURIComponent(cubeId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch cube');
      cubeCards = data.cards.map((c) =>
        typeof c === 'string' ? { name: c, elo: 0 } : { name: c.name, elo: c.elo || 0 });
    }
    const names = cubeCards.map((c) => c.name);
    const need = players * totalPicks;
    if (names.length < need) {
      throw new Error(`Pool has ${names.length} cards but ${players} players × ${totalPicks} picks needs ${need}. Reduce players/picks or use a bigger cube.`);
    }
    const { nameMap, notFound } = await resolveScryfall(names, statusEl);
    const pool = cubeCards.map(({ name, elo }) => ({
      ...(nameMap[name.toLowerCase()] || { n: name, img: null, m: '', t: '', c: '', v: 0, r: '' }),
      e: elo,
    }));
    if (notFound.length) {
      toast(`${notFound.length} card(s) not found on Scryfall (kept without image): ${notFound.slice(0, 3).join(', ')}…`, true);
    }
    statusEl.textContent = 'Creating draft…';
    const draftId = rid(12);
    const adminSecret = rid(16);
    await setDoc(doc(db, 'rd-drafts', draftId), {
      name, cubeUrl, createdAt: Date.now(),
      adminSecret, adminUid: state.user?.uid || null,
      status: 'lobby',
      settings: { players, totalPicks, singleRounds, reminderHours },
      players: {}, order: [], picks: [],
      turnStartedAt: null, lastReminderAt: null,
    });
    await setDoc(doc(db, 'rd-drafts', draftId, 'meta', 'pool'), { cards: pool });
    saveCreds(draftId, { adminSecret, draftName: name });
    await recordMembership(draftId, name, 'admin');
    location.href = `${BASE}?d=${draftId}`;
  } catch (e) {
    statusEl.textContent = '';
    toast(e.message, true);
    btn.disabled = false;
  }
}

// ----------------------------------------------------------------
// LOBBY
// ----------------------------------------------------------------
function renderLobby() {
  const d = state.draft;
  const s = settingsOf(d);
  const players = Object.entries(d.players || {});
  const joined = myPid() && d.players?.[myPid()];
  const inviteLink = `${BASE}?d=${state.draftId}`;
  const privLink = joined ? `${BASE}?d=${state.draftId}&p=${myPid()}&s=${state.creds.secret}` : '';

  const seats = [];
  for (const [pid, p] of players) {
    const me = pid === myPid();
    const sub = [me ? 'you' : null, p.bot ? 'bot' : null].filter(Boolean).join(' · ');
    seats.push(`<div class="seat ${me ? 'me' : ''}">
      <div class="s-name">${esc(p.name)}</div>
      ${sub ? `<div class="s-sub">${sub}</div>` : ''}
    </div>`);
  }
  for (let i = players.length; i < s.players; i++) {
    seats.push('<div class="seat empty">Open seat</div>');
  }

  $('#app').innerHTML = `
    ${topbar(d.name, 'Lobby — waiting for players', !!joined)}
    <div class="container">
      <div class="lobby-grid">
        <div class="lobby-main">
          <div class="lobby-head">
            <h1>Lobby</h1>
            <span class="lobby-count">${players.length} of ${s.players} seats filled</span>
          </div>
          <p class="lobby-meta">${s.totalPicks} cards each · rounds 1–${s.singleRounds} single pick, then 2 per turn ·
            ${s.reminderHours ? `${s.reminderHours}h pick reminder` : 'no reminder'}
            ${d.cubeUrl ? ` · <a href="${esc(d.cubeUrl)}" target="_blank" rel="noopener">cube ↗</a>` : ''}</p>
          <div class="seats">${seats.join('')}</div>
          <p class="hint">The draft starts automatically with a random seat order once every seat is filled.</p>

          ${!joined ? `
          <div class="joinblock">
            <h2>Take a seat</h2>
            <div class="join-row">
              <input type="text" id="j-name" maxlength="24" placeholder="Your name">
              <button class="btn btn-primary" id="j-go">Join draft</button>
            </div>
          </div>` : `
          <div class="youblock">
            <div class="you-actions">
              <button class="btn btn-sm" data-copy="${esc(privLink)}" data-lbl="Private link">Copy private link</button>
              ${!d.players[myPid()].uid
                ? '<button class="btn btn-sm" id="link-google">Link Google account</button>'
                : '<span class="chip">Google linked</span>'}
              <button class="btn btn-sm" id="push-btn">${state.pushOn ? 'Turn notifications off' : 'Enable notifications'}</button>
            </div>
            <p class="hint">The private link rejoins this draft on any device. With Google linked,
              signing in is enough.</p>
          </div>`}

          <div class="inviteblock">
            <h2>Invite players</h2>
            <div class="invite-row">
              <button class="btn btn-primary" data-copy="${esc(inviteLink)}" data-lbl="Invite link">Copy invite link</button>
              <code class="invite-url">${esc(inviteLink)}</code>
            </div>
          </div>
        </div>
        ${isAdmin() ? `<aside class="lobby-side">${renderAdminPanelHtml()}</aside>` : ''}
      </div>
    </div>`;
  bindTopbar();
  bindCopyButtons();
  bindAdminPanel();
  $('#j-go')?.addEventListener('click', joinDraft);
  $('#j-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinDraft(); });
  $('#link-google')?.addEventListener('click', linkGoogle);
  $('#push-btn')?.addEventListener('click', togglePush);
}

async function joinDraft() {
  const name = $('#j-name').value.trim();
  if (!name) { toast('Enter a name first', true); return; }
  const pid = rid(10);
  const secret = rid(16);
  try {
    await runTransaction(db, async (t) => {
      const ref = doc(db, 'rd-drafts', state.draftId);
      const snap = await t.get(ref);
      const d = snap.data();
      if (d.status !== 'lobby') throw new Error('The draft has already started.');
      const players = d.players || {};
      if (Object.keys(players).length >= settingsOf(d).players) throw new Error('The draft is full.');
      if (Object.values(players).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('That name is taken.');
      }
      t.update(ref, { [`players.${pid}`]: { name, uid: state.user?.uid || null, joinedAt: Date.now() } });
      t.set(doc(db, 'rd-drafts', state.draftId, 'private', pid), {
        secret, queue: [], pushSubs: [], uid: state.user?.uid || null,
      });
    });
    saveCreds(state.draftId, { pid, secret, name });
    subscribeMyPriv();
    recordMembership();
    toast(`Joined as ${name}.`);
  } catch (e) { toast(e.message, true); }
}

async function linkGoogle() {
  try {
    if (!state.user) await signInWithPopup(auth, new GoogleAuthProvider());
    if (!state.user) return;
    await updateDoc(doc(db, 'rd-drafts', state.draftId), {
      [`players.${myPid()}.uid`]: state.user.uid,
    });
    await updateDoc(doc(db, 'rd-drafts', state.draftId, 'private', myPid()), {
      uid: state.user.uid,
    });
    recordMembership();
    toast('Google account linked — you can rejoin by signing in on any device.');
  } catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast(e.message, true); }
}

// ----------------------------------------------------------------
// DRAFT (active / done)
// ----------------------------------------------------------------
function renderDraft() {
  const d = state.draft;
  const v = draftView(d);
  const me = myPid();
  const myTurn = v.curPid && v.curPid === me;
  if (!state.selPlayer || !d.players[state.selPlayer]) state.selPlayer = me || v.order[0];

  const tabs = [
    ['pool', 'Pool'],
    ['grid', 'Grid'],
    ['players', 'Decks'],
    ['queue', `Queue${state.myPriv?.queue?.length ? ` (${state.myPriv.queue.length})` : ''}`],
  ];
  if (isAdmin()) tabs.push(['admin', 'Admin']);

  $('#app').innerHTML = `
    ${topbar(d.name, v.done ? 'Draft complete' : 'Drafting…', !!me)}
    <div class="container">
      ${turnBannerHtml(v, me)}
      ${!v.done && me ? pickbarHtml(myTurn) : ''}
      <div class="tabs">
        ${tabs.map(([id, lbl]) => `<button class="tab-btn ${state.tab === id ? 'active' : ''}" data-tab="${id}">${lbl}</button>`).join('')}
      </div>
      <div id="tab-content">${tabContentHtml(v)}</div>
    </div>`;
  bindTopbar();
  $$('.tab-btn').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
  bindTabContent(v);
  if (!v.done && me) bindPickbar(v, myTurn);
}

function turnBannerHtml(v, me) {
  const d = state.draft;
  if (v.done) {
    return `<div class="turn-banner"><div class="big">Draft complete</div>
      <div class="sub">Every player drafted ${v.s.totalPicks} cards. Check the decks tab.</div></div>`;
  }
  const cur = d.players[v.curPid]?.name || '?';
  const myTurn = v.curPid === me;
  const curCount = v.picks.filter((p) => p.p === v.curPid).length;
  const doubleTurn = v.seq[v.picks.length + 1] === v.seq[v.picks.length];
  const nextIdx = v.seq.slice(v.picks.length).findIndex((x) => x !== v.seq[v.picks.length]);
  const nextPid = nextIdx >= 0 ? v.order[v.seq[v.picks.length + nextIdx]] : null;
  const waiting = Math.round((Date.now() - (d.turnStartedAt || Date.now())) / 36e5);
  // my queue's decision point: a taken card at the top means auto-pick stalled
  let stall = null;
  if (myTurn) {
    for (const item of state.myPriv?.queue || []) {
      if (item.tb || v.pickedIds.has(item.c)) { stall = item; break; }
      break; // top card is available — it would have been auto-picked
    }
  }
  return `<div class="turn-banner ${myTurn ? 'mine' : ''}">
    <div class="big">${myTurn
      ? `Your turn — pick ${doubleTurn ? '2 cards' : 'a card'}`
      : `Waiting for <b>${esc(cur)}</b>${doubleTurn ? ' (2 picks)' : ''}${waiting >= 2 ? ` · ${waiting}h` : ''}`}</div>
    ${stall ? `<div class="sub stall"><b>${esc(stall.n)}</b> from your queue was picked by
      <b>${esc(stall.tb || 'someone')}</b> — dismiss it in the queue tab or just pick another card.</div>` : ''}
    <div class="sub">Pick ${curCount + 1}/${v.s.totalPicks} for ${esc(cur)} · ${v.picks.length}/${v.seq.length} total
      ${nextPid && nextPid !== v.curPid ? ` · up next: ${esc(d.players[nextPid]?.name || '?')}` : ''}</div>
    <div class="progress"><div style="width:${(v.picks.length / v.seq.length) * 100}%"></div></div>
  </div>`;
}

function pickbarHtml(myTurn) {
  return `<div class="pickbar"><div class="inner">
    <div class="ac-wrap">
      <input type="text" id="pick-input" placeholder="${myTurn ? 'Type a card name to pick…' : 'Type a card name to queue…'}" autocomplete="off">
      <div class="ac-list" id="ac-list" style="display:none"></div>
    </div>
    <button class="btn btn-primary" id="pick-btn" ${myTurn ? '' : 'disabled'}>Pick</button>
    <button class="btn" id="queue-btn" title="Add to queue">Queue</button>
  </div></div>`;
}

function bindPickbar(v, myTurn) {
  const input = $('#pick-input');
  const list = $('#ac-list');
  if (!input) return;
  let sel = -1, items = [];

  const availableNames = () => {
    const seen = new Set();
    const out = [];
    state.pool.forEach((c, i) => {
      if (v.pickedIds.has(i)) return;
      const key = c.n.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(c);
    });
    return out;
  };

  const show = () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { list.style.display = 'none'; return; }
    const cands = availableNames();
    const starts = cands.filter((c) => c.n.toLowerCase().startsWith(q));
    const contains = cands.filter((c) => !c.n.toLowerCase().startsWith(q) && c.n.toLowerCase().includes(q));
    items = [...starts, ...contains].slice(0, 10);
    sel = -1;
    if (!items.length) { list.style.display = 'none'; return; }
    list.innerHTML = items.map((c, i) =>
      `<div class="ac-item" data-i="${i}"><span>${esc(c.n)}</span><span class="mana">${esc(c.m)}</span></div>`).join('');
    list.style.display = 'block';
    $$('.ac-item', list).forEach((el) => el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.value = items[+el.dataset.i].n;
      list.style.display = 'none';
    }));
  };
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 150));
  input.addEventListener('keydown', (e) => {
    if (list.style.display !== 'none' && items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; }
      else if (e.key === 'Enter' && sel >= 0) {
        e.preventDefault(); input.value = items[sel].n; list.style.display = 'none'; return;
      } else if (e.key === 'Escape') { list.style.display = 'none'; return; }
      $$('.ac-item', list).forEach((el, i) => el.classList.toggle('sel', i === sel));
      return;
    }
    if (e.key === 'Enter' && myTurn) doPickByName(input.value.trim());
  });
  $('#pick-btn')?.addEventListener('click', () => doPickByName(input.value.trim()));
  $('#queue-btn')?.addEventListener('click', () => doQueueByName(input.value.trim()));
}

function findAvailableByName(name) {
  const v = draftView(state.draft);
  const idx = state.pool.findIndex((c, i) => c.n.toLowerCase() === name.toLowerCase() && !v.pickedIds.has(i));
  return idx >= 0 ? idx : null;
}

async function doPickByName(name) {
  if (!name) return;
  const id = findAvailableByName(name);
  if (id == null) { toast(`"${name}" is not available in the pool.`, true); return; }
  await doPick(id);
}

async function doQueueByName(name) {
  if (!name) return;
  const id = findAvailableByName(name);
  if (id == null) { toast(`"${name}" is not available in the pool.`, true); return; }
  await addToQueue(id);
  $('#pick-input') && ($('#pick-input').value = '');
}

async function doPick(cardId) {
  const me = myPid();
  if (!me) return;
  try {
    await runTransaction(db, async (t) => {
      const ref = doc(db, 'rd-drafts', state.draftId);
      const snap = await t.get(ref);
      const d = snap.data();
      if (d.status !== 'active') throw new Error('The draft is not active.');
      const v = draftView(d);
      if (v.curPid !== me) throw new Error("It's not your turn.");
      if (v.pickedIds.has(cardId)) throw new Error('That card was just picked!');
      t.update(ref, {
        picks: [...v.picks, { p: me, c: cardId, n: state.pool[cardId].n, at: Date.now() }],
        turnStartedAt: Date.now(),
      });
    });
    toast(`Picked ${state.pool[cardId].n}`);
    const inp = $('#pick-input'); if (inp) inp.value = '';
    closeModal();
  } catch (e) { toast(e.message, true); }
}

// ----------------------------------------------------------------
// Queue
// ----------------------------------------------------------------
async function addToQueue(cardId) {
  const me = myPid();
  if (!me) { toast('Join the draft first.', true); return; }
  const queue = state.myPriv?.queue || [];
  if (queue.some((i) => i.c === cardId)) { toast('Already in your queue.'); return; }
  await updateDoc(doc(db, 'rd-drafts', state.draftId, 'private', me), {
    queue: arrayUnion({ c: cardId, n: state.pool[cardId].n }),
  });
  toast(`${state.pool[cardId].n} added to queue`);
  closeModal();
}

async function setQueue(queue) {
  await updateDoc(doc(db, 'rd-drafts', state.draftId, 'private', myPid()), { queue });
}

// ----------------------------------------------------------------
// Tab content
// ----------------------------------------------------------------
function tabContentHtml(v) {
  switch (state.tab) {
    case 'pool': return poolHtml(v);
    case 'grid': return gridHtml(v);
    case 'players': return playersHtml(v);
    case 'queue': return queueHtml(v);
    case 'admin': return renderAdminPanelHtml();
    default: return '';
  }
}
function bindTabContent(v) {
  switch (state.tab) {
    case 'pool': return bindPool(v);
    case 'grid': return bindGrid(v);
    case 'players': return bindPlayers(v);
    case 'queue': return bindQueue(v);
    case 'admin': return bindAdminPanel();
  }
}

// ---------- grid / draft overview table ----------
function gridHtml(v) {
  const d = state.draft;
  const n = v.order.length;
  // grid[playerIdx][slot] = global pick index in the draft sequence
  const grid = v.order.map(() => []);
  const cnt = Array(n).fill(0);
  v.seq.forEach((pi, g) => { grid[pi][cnt[pi]++] = g; });
  const curG = v.picks.length;
  const curPi = curG < v.seq.length ? v.seq[curG] : -1;

  const rows = [];
  for (let slot = 0; slot < v.s.totalPicks; slot++) {
    const isDbl = slot >= v.s.singleRounds;
    const pairFirst = isDbl && (slot - v.s.singleRounds) % 2 === 0;
    const round = isDbl ? v.s.singleRounds + Math.floor((slot - v.s.singleRounds) / 2) : slot;
    const dir = round % 2 === 0 ? '→' : '←';
    const cells = v.order.map((pid, pi) => {
      const g = grid[pi][slot];
      if (g == null) return '<td class="gcell empty">—</td>';
      const pick = v.picks[g];
      const cls = ['gcell'];
      if (g === curG) cls.push('cur');
      else if (!pick && curG < v.seq.length && v.seq[g] === v.seq[curG] &&
               (g === curG + 1) && v.seq[curG + 1] === v.seq[curG]) cls.push('cur2');
      if (!pick) {
        return `<td class="${cls.join(' ')}" title="pick ${g + 1} of ${v.seq.length}">${g === curG ? '▸' : '·'}</td>`;
      }
      cls.push('filled');
      return `<td class="${cls.join(' ')}" data-card="${pick.c}" title="pick ${g + 1}: ${esc(pick.n)}">${esc(pick.n)}${pick.auto ? ' <span class="automark" title="auto pick">A</span>' : ''}</td>`;
    });
    rows.push(`<tr class="${isDbl ? (pairFirst ? 'dbl-a' : 'dbl-b') : ''}">
      <td class="rowlbl">${slot + 1} <span class="dir">${dir}</span>${pairFirst ? '<span class="x2">×2</span>' : ''}</td>
      ${cells.join('')}</tr>`);
  }
  return `
    <p class="hint">Snake order top to bottom — ${v.s.singleRounds ? `rows 1–${v.s.singleRounds} are single picks, after that each turn takes <b>2 cards ×2</b>.` : 'every turn takes 2 cards.'}
      ${matchMedia('(hover: hover)').matches ? 'Hover a card for its image, click for details.' : 'Scroll in any direction, double-tap a card to see it.'}</p>
    <div class="grid-wrap" id="grid-wrap"><table class="pick-grid">
      <thead><tr><th class="rowlbl">#</th>
        ${v.order.map((pid, pi) => `<th class="${pi === curPi ? 'curcol' : ''}">
          ${esc(d.players[pid]?.name || '?')}
          <div class="thsub">${v.picks.filter((p) => p.p === pid).length}/${v.s.totalPicks}</div></th>`).join('')}
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

function ensureCardTip() {
  let tip = $('#card-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'card-tip';
    document.body.appendChild(tip);
  }
  return tip;
}

function bindGrid() {
  const wrap = $('#grid-wrap');
  if (!wrap) return;
  const tip = ensureCardTip();
  const canHover = matchMedia('(hover: hover)').matches;
  const hideTip = () => { tip.style.display = 'none'; tip.innerHTML = ''; };
  $$('.gcell[data-card]', wrap).forEach((td) => {
    const cardId = +td.dataset.card;
    if (canHover) {
      td.addEventListener('mouseenter', () => {
        const img = state.pool[cardId]?.img;
        if (!img) return;
        tip.innerHTML = `<img src="${esc(img)}" alt="">`;
        tip.style.display = 'block';
      });
      td.addEventListener('mousemove', (e) => {
        const w = 240, h = 335;
        let x = e.clientX + 16, y = e.clientY - h / 2;
        if (x + w > innerWidth - 8) x = e.clientX - w - 16;
        y = Math.max(8, Math.min(y, innerHeight - h - 8));
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
      });
      td.addEventListener('mouseleave', hideTip);
      td.addEventListener('click', () => { hideTip(); openCardModal(cardId); });
    } else {
      // mobile: double-tap opens the card, single taps stay free for scrolling
      let lastTap = 0;
      td.addEventListener('pointerup', () => {
        const now = Date.now();
        if (now - lastTap < 400) { lastTap = 0; openCardModal(cardId); }
        else lastTap = now;
      });
      td.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  });
}

// ---------- pool ----------
const COLOR_FILTERS = [['W', 'W'], ['U', 'U'], ['B', 'B'], ['R', 'R'], ['G', 'G'], ['M', 'M'], ['C', 'C']];
const TYPE_FILTERS = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'];

function filterPool(v) {
  const f = state.filters;
  const q = f.search.trim().toLowerCase();
  const out = [];
  state.pool.forEach((c, i) => {
    if (f.hidePicked && v.pickedIds.has(i)) return;
    if (q && !c.n.toLowerCase().includes(q) && !c.t.toLowerCase().includes(q)) return;
    if (f.colors.size) {
      const isLand = c.t.includes('Land');
      const cc = c.c || '';
      let ok = false;
      for (const col of f.colors) {
        if (col === 'M' && cc.length > 1) ok = true;
        else if (col === 'C' && !cc.length && !isLand) ok = true;
        else if (cc.includes(col)) ok = true;
      }
      if (!ok) return;
    }
    if (f.types.size) {
      let ok = false;
      for (const ty of f.types) if (c.t.includes(ty)) ok = true;
      if (!ok) return;
    }
    out.push(i);
  });
  const by = {
    pool: () => 0,
    name: (a, b) => state.pool[a].n.localeCompare(state.pool[b].n),
    cmc: (a, b) => state.pool[a].v - state.pool[b].v || state.pool[a].n.localeCompare(state.pool[b].n),
    color: (a, b) => (state.pool[a].c || 'Z').localeCompare(state.pool[b].c || 'Z') || state.pool[a].v - state.pool[b].v,
  };
  if (state.filters.sort !== 'pool') out.sort(by[state.filters.sort]);
  return out;
}

function poolHtml(v) {
  const f = state.filters;
  const ids = filterPool(v);
  const availTotal = state.pool.length - v.pickedIds.size;
  const queueIds = new Set((state.myPriv?.queue || []).filter((i) => !i.tb).map((i) => i.c));
  const shown = ids.slice(0, 400);
  return `
    <div class="pool-controls">
      <div class="row2">
        <input type="text" id="pool-search" placeholder="Search name or type…" value="${esc(f.search)}">
        <select id="pool-sort">
          ${[['pool', 'Cube order'], ['name', 'Name'], ['cmc', 'Mana value'], ['color', 'Color']]
            .map(([val, lbl]) => `<option value="${val}" ${f.sort === val ? 'selected' : ''}>${lbl}</option>`).join('')}
        </select>
      </div>
      <div class="row2">
        ${COLOR_FILTERS.map(([c, icon]) => `<button class="mini-chip ${f.colors.has(c) ? 'active' : ''}" data-color="${c}" title="${({W:'White',U:'Blue',B:'Black',R:'Red',G:'Green',M:'Multicolor',C:'Colorless'})[c]}">${icon}</button>`).join('')}
        <label class="checkline"><input type="checkbox" id="hide-picked" ${f.hidePicked ? 'checked' : ''}> hide picked</label>
      </div>
      <div class="row2">
        ${TYPE_FILTERS.map((t) => `<button class="mini-chip ${f.types.has(t) ? 'active' : ''}" data-type="${t}">${t}</button>`).join('')}
      </div>
    </div>
    <div class="pool-count">${ids.length} shown · ${availTotal}/${state.pool.length} still available${ids.length > 400 ? ' · showing first 400, refine your filter' : ''}</div>
    <div class="card-grid">
      ${shown.map((i) => {
        const c = state.pool[i];
        const picked = v.pickedIds.has(i);
        const picker = picked ? state.draft.players[v.picks.find((p) => p.c === i)?.p]?.name : null;
        return `<div class="cardc ${picked ? 'picked' : ''}" data-card="${i}">
          ${c.img
            ? `<img src="${esc(c.img.replace('/normal/', '/small/'))}" alt="${esc(c.n)}" loading="lazy">`
            : `<div class="noimg">${esc(c.n)}</div>`}
          ${queueIds.has(i) && !picked ? '<span class="q-tag" title="in your queue">Q</span>' : ''}
          ${picked ? `<span class="picked-tag">${esc(picker || '?')}</span>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function bindPool(v) {
  $('#pool-search')?.addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    render();
  });
  $('#pool-sort')?.addEventListener('change', (e) => { state.filters.sort = e.target.value; render(); });
  $('#hide-picked')?.addEventListener('change', (e) => { state.filters.hidePicked = e.target.checked; render(); });
  $$('[data-color]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.color;
    state.filters.colors.has(c) ? state.filters.colors.delete(c) : state.filters.colors.add(c);
    render();
  }));
  $$('[data-type]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.type;
    state.filters.types.has(t) ? state.filters.types.delete(t) : state.filters.types.add(t);
    render();
  }));
  $$('[data-card]').forEach((el) => el.addEventListener('click', () => openCardModal(+el.dataset.card)));
}

function openCardModal(cardId) {
  const c = state.pool[cardId];
  const v = draftView(state.draft);
  const picked = v.pickedIds.has(cardId);
  const pick = picked ? v.picks.find((p) => p.c === cardId) : null;
  const picker = pick ? state.draft.players[pick.p]?.name : null;
  const me = myPid();
  const myTurn = v.curPid === me && !v.done;
  const inQueue = (state.myPriv?.queue || []).some((i) => i.c === cardId);
  openModal(`
    ${c.img ? `<img class="bigcard" src="${esc(c.img)}" alt="${esc(c.n)}">` : `<h2>${esc(c.n)}</h2><p class="status-line">${esc(c.t)} ${esc(c.m)}</p>`}
    <div class="status-line">${picked
      ? `Picked by <b>${esc(picker || '?')}</b> (pick ${v.picks.indexOf(pick) + 1})`
      : 'Available'}</div>
    <div class="modal-actions">
      ${!picked && me && !v.done ? `
        <button class="btn btn-primary" id="m-pick" ${myTurn ? '' : 'disabled'}>${myTurn ? 'Pick now' : 'Not your turn'}</button>
        <button class="btn" id="m-queue" ${inQueue ? 'disabled' : ''}>${inQueue ? 'In queue' : 'Add to queue'}</button>` : ''}
      <button class="btn" id="m-close">Close</button>
    </div>`);
  $('#m-pick')?.addEventListener('click', () => doPick(cardId));
  $('#m-queue')?.addEventListener('click', () => addToQueue(cardId));
  $('#m-close')?.addEventListener('click', closeModal);
}

// ---------- players / decks ----------
function playersHtml(v) {
  const d = state.draft;
  const selPicks = v.picks.map((p, gi) => ({ ...p, gi })).filter((p) => p.p === state.selPlayer);
  let listHtml;
  if (!selPicks.length) {
    listHtml = '<div class="empty">No picks yet.</div>';
  } else if (state.groupByType) {
    const groups = {};
    for (const p of selPicks) {
      const t = state.pool[p.c]?.t || '';
      const g = TYPE_FILTERS.find((ty) => t.includes(ty)) || 'Other';
      (groups[g] ||= []).push(p);
    }
    listHtml = TYPE_FILTERS.concat('Other')
      .filter((g) => groups[g]?.length)
      .map((g) => `<div class="type-group"><h3>${g} (${groups[g].length})</h3>
        <div class="pick-rows">${groups[g]
          .sort((a, b) => (state.pool[a.c]?.v || 0) - (state.pool[b.c]?.v || 0))
          .map(pickRowHtml).join('')}</div></div>`)
      .join('');
  } else {
    listHtml = `<div class="pick-rows">${selPicks.map(pickRowHtml).join('')}</div>`;
  }
  return `
    <div class="chips" style="margin-bottom:12px">
      ${v.order.map((pid) => {
        const count = v.picks.filter((p) => p.p === pid).length;
        return `<button class="chip ${pid === state.selPlayer ? 'active' : ''} ${pid === v.curPid ? 'turn' : ''}"
          data-player="${pid}">${esc(d.players[pid]?.name || '?')} <span class="cnt">${count}</span></button>`;
      }).join('')}
    </div>
    <div class="row2" style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
      <label class="checkline"><input type="checkbox" id="group-type" ${state.groupByType ? 'checked' : ''}> group by type</label>
      <button class="btn btn-sm" id="export-deck">Export list</button>
    </div>
    ${listHtml}`;
}

function pickRowHtml(p) {
  const c = state.pool[p.c] || { n: p.n, m: '', t: '' };
  return `<div class="pick-row" data-card="${p.c}">
    <span class="num">${p.gi + 1}</span>
    <span>${esc(c.n)}</span>${p.auto ? ' <span class="automark" title="auto-picked from queue">A</span>' : ''}
    <span class="mana">${esc(c.m)}</span>
  </div>`;
}

function bindPlayers() {
  $$('[data-player]').forEach((b) => b.addEventListener('click', () => {
    state.selPlayer = b.dataset.player; render();
  }));
  $('#group-type')?.addEventListener('change', (e) => { state.groupByType = e.target.checked; render(); });
  $$('.pick-row[data-card]').forEach((el) => el.addEventListener('click', () => openCardModal(+el.dataset.card)));
  $('#export-deck')?.addEventListener('click', () => {
    const v = draftView(state.draft);
    const names = v.picks.filter((p) => p.p === state.selPlayer).map((p) => p.n);
    const playerName = state.draft.players[state.selPlayer]?.name || 'deck';
    const blob = new Blob([names.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${playerName.replace(/\W+/g, '_')}_rotisserie.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------- queue ----------
function queueHtml(v) {
  if (!myPid()) return '<div class="empty">Join the draft to use a pick queue.</div>';
  const queue = state.myPriv?.queue || [];
  const myTurn = !v.done && v.curPid === myPid();
  const topPickable = myTurn && queue[0] && !queue[0].tb && !v.pickedIds.has(queue[0].c);
  return `
    <p class="hint">On your turn the <b>top</b> card is picked automatically for you. If someone
    else picked it first, it stays here marked and the draft <b>waits for you</b> —
    dismiss it (✕) and pick, or reorder the queue.</p>
    ${queue.length ? `<div id="q-list">${queue.map((item, i) => `
      <div class="q-row ${item.tb ? 'taken' : ''}" data-qi="${i}">
        <span class="q-drag" title="Drag to reorder">☰</span>
        <span class="pos">${i + 1}</span>
        <span class="nm" data-card="${item.c}">${esc(item.n)}
          ${item.tb ? `<span class="q-taken">picked by ${esc(item.tb)}</span>` : ''}</span>
        <button class="btn btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-sm" data-down="${i}" ${i === queue.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn-sm btn-danger" data-rm="${i}" title="${item.tb ? 'Dismiss' : 'Remove'}">✕</button>
      </div>`).join('')}</div>`
    : '<div class="empty">Queue is empty — add cards from the pool</div>'}
    ${topPickable ? `<button class="btn btn-primary btn-block" id="q-pick-top" style="margin-top:10px">Pick ${esc(queue[0].n)} now</button>` : ''}
    ${!state.pushOn && queue.length ? `<button class="btn btn-block" id="q-push" style="margin-top:10px">Enable notifications to hear about snipes</button>` : ''}`;
}

function bindQueue() {
  const queue = [...(state.myPriv?.queue || [])];
  $$('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    const q = [...queue]; q.splice(+b.dataset.rm, 1); setQueue(q);
  }));
  $$('[data-up]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.up; const q = [...queue];
    [q[i - 1], q[i]] = [q[i], q[i - 1]]; setQueue(q);
  }));
  $$('[data-down]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.down; const q = [...queue];
    [q[i + 1], q[i]] = [q[i], q[i + 1]]; setQueue(q);
  }));
  $$('.q-row .nm[data-card]').forEach((el) => el.addEventListener('click', () => openCardModal(+el.dataset.card)));
  $('#q-push')?.addEventListener('click', enablePush);
  $('#q-pick-top')?.addEventListener('click', () => {
    const top = (state.myPriv?.queue || [])[0];
    if (top) doPick(top.c);
  });
  bindQueueDrag();
}

// Pointer-based drag & drop reordering (touch + mouse). The dragged
// row floats under the pointer (transform only — moving the captured
// element in the DOM would break pointer capture and limit drags to
// one position). A drop-indicator line marks the landing spot; the
// new order is written on release.
function bindQueueDrag() {
  const list = $('#q-list');
  if (!list) return;
  $$('.q-drag', list).forEach((handle) => {
    const row = handle.closest('.q-row');
    let active = false, startY = 0, fromIdx = 0, target = 0, line = null;
    handle.addEventListener('pointerdown', (e) => {
      active = true;
      state.dragLock = true; // pause re-renders while dragging
      startY = e.clientY;
      fromIdx = +row.dataset.qi;
      target = fromIdx;
      row.classList.add('dragging');
      line = document.createElement('div');
      line.className = 'q-drop-line';
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!active) return;
      row.style.transform = `translateY(${e.clientY - startY}px)`;
      const others = $$('.q-row', list).filter((r) => r !== row && !r.classList.contains('q-drop-line'));
      // insertion index within the list minus the dragged row
      let t = 0;
      for (const r of others) {
        const rect = r.getBoundingClientRect();
        if (e.clientY > rect.top + rect.height / 2) t++;
      }
      target = t;
      const anchor = others[t] || null;
      if (anchor) list.insertBefore(line, anchor);
      else list.appendChild(line);
    });
    const finish = () => {
      if (!active) return;
      active = false;
      state.dragLock = false;
      row.classList.remove('dragging');
      row.style.transform = '';
      line?.remove();
      line = null;
      const queue = [...(state.myPriv?.queue || [])];
      const item = queue.splice(fromIdx, 1)[0];
      if (!item || target === fromIdx) { render(); return; }
      queue.splice(target, 0, item);
      setQueue(queue);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });
}

// ---------- admin ----------
function renderAdminPanelHtml() {
  if (!isAdmin()) return '';
  const d = state.draft;
  const s = settingsOf(d);
  const players = Object.entries(d.players || {});
  const adminLink = `${BASE}?d=${state.draftId}&a=${state.creds.adminSecret}`;
  return `<div id="admin-panel" class="adminbox">
    <h2>Admin</h2>
    ${d.status === 'lobby' ? `
    <div class="adm-section">
      <div class="adm-actions">
        <button class="btn btn-sm" id="add-bot">Add bot</button>
        ${players.length >= 2 ? `<button class="btn btn-sm" id="force-start">Start now with ${players.length}</button>` : ''}
        <button class="btn btn-sm" data-copy="${esc(adminLink)}" data-lbl="Admin link">Copy admin link</button>
      </div>
      <p class="hint">Bots pick by CubeCobra ratings on their turn. The admin link makes another
        device admin too.</p>
    </div>` : `
    <div class="adm-section">
      <div class="adm-actions">
        <button class="btn btn-sm" data-copy="${esc(adminLink)}" data-lbl="Admin link">Copy admin link</button>
      </div>
    </div>`}
    <div class="adm-section">
      <h3>Players</h3>
      <div id="admin-players">${players.length ? '' : '<p class="hint">Nobody joined yet.</p>'}</div>
    </div>
    <div class="adm-section">
      <h3>Pick reminder</h3>
      <div class="adm-inline">
        <input type="number" id="adm-remind" value="${s.reminderHours}" min="0" max="168" class="adm-num">
        <span class="hint" style="margin:0">hours (0 = off)</span>
        <button class="btn btn-sm" id="adm-remind-save">Save</button>
      </div>
    </div>
    <div class="adm-section">
      <button class="btn btn-sm btn-danger" id="del-draft">Delete this draft</button>
      <p class="hint">Removes the pool, all picks, queues, and every link. Cannot be undone.</p>
    </div>
  </div>`;
}

async function bindAdminPanel() {
  if (!isAdmin() || !$('#admin-panel')) return;
  bindCopyButtons();
  $('#force-start')?.addEventListener('click', async () => {
    const count = Object.keys(state.draft.players || {}).length;
    await updateDoc(doc(db, 'rd-drafts', state.draftId), { 'settings.players': count });
    toast('Starting the draft…');
  });
  $('#add-bot')?.addEventListener('click', addBot);
  $$('[data-rmbot]').forEach((b) => b.addEventListener('click', () => removeBot(b.dataset.rmbot)));
  $('#del-draft')?.addEventListener('click', deleteDraft);
  $('#adm-remind-save')?.addEventListener('click', async () => {
    const h = Math.max(0, parseInt($('#adm-remind').value, 10) || 0);
    await updateDoc(doc(db, 'rd-drafts', state.draftId), { 'settings.reminderHours': h });
    toast(`Reminder set to ${h}h`);
  });
  // Private links need each player's secret from their private doc
  const wrap = $('#admin-players');
  if (!wrap) return;
  const privSnaps = await getDocs(collection(db, 'rd-drafts', state.draftId, 'private'));
  const secrets = {};
  privSnaps.forEach((s) => { secrets[s.id] = s.data().secret; });
  const v = state.draft.status === 'lobby' ? null : draftView(state.draft);
  wrap.innerHTML = Object.entries(state.draft.players || {}).map(([pid, p]) => {
    const link = `${BASE}?d=${state.draftId}&p=${pid}&s=${secrets[pid] || ''}`;
    return `<div class="admin-player">
      <div class="top"><span class="nm">${esc(p.name)}${v?.curPid === pid ? ' <span class="dash-as">turn</span>' : ''}</span>
        ${p.bot
          ? (state.draft.status === 'lobby' ? `<button class="btn btn-sm btn-danger" data-rmbot="${pid}">Remove</button>` : '')
          : `<button class="btn btn-sm" data-copy="${esc(link)}" data-lbl="${esc(p.name)}'s link">Private link</button>
             <button class="btn btn-sm" data-ping="${pid}">Ping</button>`}</div>
    </div>`;
  }).join('') || '<p class="hint">Nobody joined yet.</p>';
  bindCopyButtons();
  $$('[data-ping]').forEach((b) => b.addEventListener('click', async () => {
    const pid = b.dataset.ping;
    const name = state.draft.players[pid]?.name || 'player';
    const msg = prompt(`Push message for ${name}:`, `It's your turn, ${name}!`);
    if (msg === null) return;
    b.disabled = true;
    try {
      const res = await fetch('/api/rd/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: state.draftId, pid, message: msg, secret: state.creds.adminSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ping failed');
      toast(`Pinged ${name}`);
    } catch (e) { toast(e.message, true); }
    b.disabled = false;
  }));
}

// Cascade-delete the draft and everything linked to it: private docs
// (queues, push subs, link secrets), the card pool, and the draft doc
// itself (players, picks, invite/admin secrets live inside it).
async function deleteDraft() {
  if (!isAdmin() || !state.draft) return;
  const name = state.draft.name || 'this draft';
  if (!confirm(`Delete "${name}" and ALL its data — pool, picks, queues, links? This cannot be undone.`)) return;
  try {
    state.unsubDraft?.(); state.unsubDraft = null;
    state.unsubPriv?.(); state.unsubPriv = null;
    const privSnaps = await getDocs(collection(db, 'rd-drafts', state.draftId, 'private'));
    await Promise.all(privSnaps.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'rd-drafts', state.draftId, 'meta', 'pool'));
    await deleteDoc(doc(db, 'rd-drafts', state.draftId));
    const all = allCreds();
    delete all[state.draftId];
    localStorage.setItem('rd_creds', JSON.stringify(all));
    if (state.user) {
      await setDoc(doc(db, 'rd-users', state.user.uid), {
        drafts: { [state.draftId]: deleteField() },
      }, { merge: true });
    }
    toast('Draft deleted.');
    location.href = BASE;
  } catch (e) { toast('Delete failed: ' + e.message, true); }
}

const BOT_NAMES = ['Silas', 'Urza', 'Mishra', 'Karn', 'Teferi', 'Jhoira', 'Venser', 'Saheeli', 'Tezzeret', 'Daretti', 'Feldon', 'Slobad'];

async function addBot() {
  const d = state.draft;
  const s = settingsOf(d);
  const players = d.players || {};
  if (d.status !== 'lobby') { toast('Bots can only be added in the lobby.', true); return; }
  if (Object.keys(players).length >= s.players) { toast('The lobby is already full.', true); return; }
  const taken = new Set(Object.values(players).map((p) => p.name));
  const base = BOT_NAMES.find((n) => !taken.has(`Bot ${n}`)) || `Bot-${rid(4)}`;
  const pid = 'bot-' + rid(8);
  try {
    // private doc first: when the players entry lands, the lobby may
    // fill and the draft starts immediately
    await setDoc(doc(db, 'rd-drafts', state.draftId, 'private', pid), {
      secret: rid(16), queue: [], pushSubs: [], bot: true,
    });
    await updateDoc(doc(db, 'rd-drafts', state.draftId), {
      [`players.${pid}`]: { name: `Bot ${base}`, uid: null, bot: true, joinedAt: Date.now() },
    });
    toast(`Bot ${base} joined the table.`);
  } catch (e) { toast(e.message, true); }
}

async function removeBot(pid) {
  if (state.draft?.status !== 'lobby') { toast('Bots can only be removed in the lobby.', true); return; }
  if (!state.draft.players?.[pid]?.bot) return;
  try {
    await updateDoc(doc(db, 'rd-drafts', state.draftId), { [`players.${pid}`]: deleteField() });
    await deleteDoc(doc(db, 'rd-drafts', state.draftId, 'private', pid));
    toast('Bot removed.');
  } catch (e) { toast(e.message, true); }
}

function bindCopyButtons() {
  $$('[data-copy]').forEach((b) => {
    if (b._bound) return;
    b._bound = true;
    b.addEventListener('click', () => copyText(b.dataset.copy, b.dataset.lbl || 'Link'));
  });
}

// ----------------------------------------------------------------
// Push notifications
// ----------------------------------------------------------------
function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!myPid()) { toast('Join the draft first.', true); return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    toast(isIOS
      ? 'On iPhone: add this page to your Home Screen first (Share → Add to Home Screen), then enable notifications from the installed app.'
      : 'Push notifications are not supported in this browser.', true);
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications were not allowed.', true); return; }
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
    });
    const json = sub.toJSON();
    const subs = state.myPriv?.pushSubs || [];
    if (!subs.some((s) => s.endpoint === json.endpoint)) {
      await updateDoc(doc(db, 'rd-drafts', state.draftId, 'private', myPid()), {
        pushSubs: arrayUnion({ endpoint: json.endpoint, keys: json.keys }),
      });
    }
    state.pushEndpoint = json.endpoint;
    state.pushOn = true;
    toast('Notifications enabled.');
    render();
  } catch (e) { toast('Push setup failed: ' + e.message, true); }
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('sw.js');
    const sub = await reg?.pushManager.getSubscription();
    const endpoint = sub?.endpoint || state.pushEndpoint;
    if (sub) await sub.unsubscribe();
    if (endpoint && myPid()) {
      const subs = state.myPriv?.pushSubs || [];
      await updateDoc(doc(db, 'rd-drafts', state.draftId, 'private', myPid()), {
        pushSubs: subs.filter((s) => s.endpoint !== endpoint),
      });
    }
    state.pushEndpoint = null;
    state.pushOn = false;
    toast('Notifications off.');
    render();
  } catch (e) { toast('Could not disable push: ' + e.message, true); }
}

function togglePush() {
  state.pushOn ? disablePush() : enablePush();
}

// ----------------------------------------------------------------
boot();
