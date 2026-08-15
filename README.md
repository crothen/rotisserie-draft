# Rotisserie Draft

Slow rotisserie drafting for Magic: The Gathering playgroups, live at
[rotisserie-draft.ch](https://rotisserie-draft.ch).

The whole cube is public. Players pick one card at a time in snake order
(then two per turn late in the draft), over hours or days, with web push
notifications, pick queues, bots, and a live draft grid.

## Stack

- Plain HTML/JS/CSS frontend (no build step), Firebase Hosting
- Firestore for draft state (realtime listeners, client transactions)
- Card pools: CubeCobra cubes, set-based pools, pasted lists, or **format
  drafts** — the pool is implicitly "every card legal in X" (Legacy,
  Vintage, Modern, Premodern, Pioneer, Standard, Pauper). Format drafts
  store no pool: players browse cached per-format staples or search all
  legal cards via Scryfall, picks are validated by name server-side and
  carry their card data, and bots draft from the staples catalog.
- Cloud Functions (Node 20, us-central1):
  - `rdFetchCube`: CubeCobra proxy, returns `{name, elo}` per card
  - `rdStaples`: per-format top-1000 staples cache (GET lazy-refresh,
    owner POST force-sync from the /admin page)
  - `rdPing`: admin pings a player (push)
  - `rdContact`: contact form intake (honeypot + flood guard)
  - `rdInbox`: owner-only contact inbox (Firebase ID token, email hash check)
  - `rdOnDraftWrite`: the draft engine trigger — lobby auto start, queue
    auto picks with snipe stalls, bot picks by CubeCobra elo, turn and
    completion notifications
  - `rdReminder`: scheduled nudge for slow pickers
- Web Push with raw VAPID (no FCM); card data and images from Scryfall

## Card Blind leagues (/4cb)

Four Card Blind (or 3CB, any hand size) as leagues: every round players
blindly submit an N-card deck, the decks reveal at a deadline, every deck
plays every other deck (two games, alternating play/draw) and players
self-report results (WW 6 · WD 4 · WL/DD 2 · DL 1 · LL 0). Conflicting
reports notify the admin, who sets the final result. The admin curates a
banlist between rounds; standings and per-round history live on the
league page. Per-match notes are visible only to the two players and the
admin.

- Firestore: `cb-leagues/{id}` (+ `rounds`, blind `private` docs the
  admin cannot read, `matchchat`)
- Functions: `cbClaim` (seat binding), `cbSubmit` (Scryfall-validated
  blind submissions: format legality, bans, highlander), `cbRound`
  (admin ops: start/reveal/deadline/resolve/finish/delete), `cbReport`
  (self-reported results with dispute detection), `cbChat` (match
  notes), `cbTick` (scheduled auto-reveal + submission reminders)

## Setup

```bash
npm --prefix functions install
firebase login
# one-time: generate a VAPID keypair and store the private key
npx web-push generate-vapid-keys
firebase functions:secrets:set VAPID_PRIVATE_KEY   # paste the private key
# put the public key in public/app.js and functions/index.js (VAPID_PUBLIC)
firebase deploy
```

Google sign in must be enabled once in the Firebase console
(Authentication, sign-in method) and the production domain added to the
authorized domains list.

Notes:

- The Firebase web config in `public/firebase-init.js` (including
  `apiKey`) is public by design; access control lives in Firestore rules
  and the functions.
- The site owner is identified by a SHA-256 hash of their Google account
  email (`OWNER_HASH` in `public/app.js` and `functions/index.js`), so no
  address appears in the source.
