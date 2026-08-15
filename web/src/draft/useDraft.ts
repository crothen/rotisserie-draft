// The draft page's data layer: live draft doc, pool, my private doc,
// chat, seat binding and push state. Ports boot()/subscribeDraft()
// and friends from the pre-React app.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, doc, limit, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { apiPost, ensureAuthed } from '../lib/api';
import { draftCreds, type Creds } from '../lib/creds';
import { loadPool } from '../lib/pool';
import { derivedFormatPool } from '../lib/draftLogic';
import { computePushOn, currentPushEndpoint, disablePush, enablePush } from '../lib/push';
import { recordDraftMembership } from '../lib/membership';
import { useAuth } from '../hooks/useAuth';
import type { ChatMsg, DraftDoc, PoolCard, PrivDoc } from '../lib/types';

export interface DraftApi {
  draft: DraftDoc | null;
  notFound: boolean;
  pool: PoolCard[] | null;
  priv: PrivDoc | null;
  chat: ChatMsg[];
  creds: Creds | null;
  setCreds: (c: Creds | null) => void;
  seatBound: boolean;
  setSeatBound: (b: boolean) => void;
  me: string | null;
  amAdmin: boolean;
  archived: boolean;
  pushOn: boolean;
  togglePush: () => Promise<void>;
}

export function useDraft(draftId: string): DraftApi {
  const { user, realUser, ownerOk, ready } = useAuth();
  const [draft, setDraft] = useState<DraftDoc | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pool, setPool] = useState<PoolCard[] | null>(null);
  const [priv, setPriv] = useState<PrivDoc | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [creds, setCredsState] = useState<Creds | null>(() => draftCreds.get(draftId));
  const [seatBound, setSeatBound] = useState(false);
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null);
  const rejoinTried = useRef(false);
  const bindInFlight = useRef(false);

  const setCreds = useCallback((c: Creds | null) => setCredsState(c), []);
  const me = creds?.pid || null;
  const amAdmin = !!realUser && (!!draft && draft.adminUid === realUser.uid || ownerOk);
  const archived = !!draft?.archived;

  // main draft doc subscription (+ derived pool for format drafts)
  useEffect(() => {
    setDraft(null);
    setNotFound(false);
    setPool(null);
    const unsub = onSnapshot(doc(db, 'rd-drafts', draftId), (snap) => {
      if (!snap.exists()) { setNotFound(true); return; }
      const d = snap.data() as DraftDoc;
      setDraft(d);
      if (d.source === 'format') setPool(derivedFormatPool(d));
    }, (e) => console.error('draft listener', e));
    return unsub;
  }, [draftId]);

  // classic drafts: load the stored pool once the draft is running
  const status = draft?.status;
  const source = draft?.source;
  useEffect(() => {
    if (source === 'format') return;
    if ((status === 'active' || status === 'done') && pool === null) {
      let alive = true;
      loadPool(draftId).then((cards) => { if (alive) setPool(cards); });
      return () => { alive = false; };
    }
  }, [draftId, status, source, pool]);

  // seat binding: bind this device's auth uid to my seat via rdClaim
  useEffect(() => {
    if (!ready || !draft || !creds?.pid || seatBound || bindInFlight.current) return;
    bindInFlight.current = true;
    (async () => {
      try {
        await ensureAuthed();
        const uid = auth.currentUser!.uid;
        if (draft.uids?.[uid] !== creds.pid) {
          const res = await apiPost<{ secret?: string }>('/api/rd/claim', {
            draftId, pid: creds.pid, secret: creds.secret || null,
          });
          if (res.secret && !creds.secret) {
            setCredsState(draftCreds.save(draftId, { secret: res.secret }));
          }
        }
        setSeatBound(true);
      } catch (e) {
        console.warn('seat binding failed', e);
      } finally {
        bindInFlight.current = false;
      }
    })();
  }, [ready, draft, creds, seatBound, draftId, user]);

  // Google-account rejoin: recognize my seat by uid
  useEffect(() => {
    if (!draft || !realUser || creds?.pid || rejoinTried.current) return;
    const match = Object.entries(draft.players || {}).find(([, p]) => p.uid === realUser.uid);
    if (!match) return;
    rejoinTried.current = true;
    const [pid] = match;
    (async () => {
      try {
        const res = await apiPost<{ secret?: string }>('/api/rd/claim', { draftId, pid });
        setCredsState(draftCreds.save(draftId, { pid, secret: res.secret || '' }));
        setSeatBound(true);
      } catch (e) { console.warn('rejoin failed', e); }
    })();
  }, [draft, realUser, creds, draftId]);

  // membership mirror for the dashboard
  useEffect(() => {
    if (!draft || !realUser) return;
    const iAmAdmin = draft.adminUid === realUser.uid;
    if (!creds?.pid && !iAmAdmin) return;
    recordDraftMembership(realUser.uid, draftId, draft.name || '', iAmAdmin ? 'admin' : 'player');
  }, [draft?.name, realUser, creds?.pid]); // eslint-disable-line react-hooks/exhaustive-deps

  // my private doc (queue, sideboard, push subs)
  useEffect(() => {
    if (!seatBound || !me) { setPriv(null); return; }
    const unsub = onSnapshot(doc(db, 'rd-drafts', draftId, 'private', me), (snap) => {
      setPriv(snap.exists() ? (snap.data() as PrivDoc) : null);
    }, (e) => console.warn('private listener denied (seat not bound yet?)', e));
    return unsub;
  }, [draftId, seatBound, me]);

  // players-only chat
  useEffect(() => {
    if (!seatBound || !me || !(status === 'active' || status === 'done')) { setChat([]); return; }
    const q = query(collection(db, 'rd-drafts', draftId, 'chat'), orderBy('at', 'desc'), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setChat(snap.docs.map((s) => ({ id: s.id, ...(s.data() as Omit<ChatMsg, 'id'>) })).reverse());
    }, (e) => console.warn('chat listener failed', e));
    return unsub;
  }, [draftId, seatBound, me, status]);

  // push state
  useEffect(() => {
    currentPushEndpoint().then(setPushEndpoint);
  }, []);
  const pushOn = useMemo(() => computePushOn(priv, pushEndpoint), [priv, pushEndpoint]);

  const togglePush = useCallback(async () => {
    const privRef = me ? doc(db, 'rd-drafts', draftId, 'private', me) : null;
    if (pushOn) {
      await disablePush(privRef, priv, pushEndpoint);
      setPushEndpoint(null);
    } else {
      if (!privRef) throw new Error('Join the draft first.');
      const ep = await enablePush(privRef, priv);
      setPushEndpoint(ep);
    }
  }, [draftId, me, priv, pushOn, pushEndpoint]);

  return {
    draft, notFound, pool, priv, chat, creds, setCreds,
    seatBound, setSeatBound, me, amAdmin, archived, pushOn, togglePush,
  };
}
