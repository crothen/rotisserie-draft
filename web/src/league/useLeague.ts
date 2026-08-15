// League page data layer: league doc, rounds, my private doc, match
// chats, seat binding and push. Ports subscribeLeague() and friends.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { apiPost, ensureAuthed } from '../lib/api';
import { leagueCreds, type Creds } from '../lib/creds';
import { computePushOn, currentPushEndpoint, disablePush, enablePush } from '../lib/push';
import { recordLeagueMembership } from '../lib/membership';
import { useAuth } from '../hooks/useAuth';
import type { LeagueDoc, MatchChatDoc, PrivDoc, RoundDoc } from '../lib/types';

export interface LeagueApi {
  league: LeagueDoc | null;
  notFound: boolean;
  rounds: Record<number, RoundDoc>;
  priv: PrivDoc | null;
  chats: Record<string, MatchChatDoc | null>;  // key: `${n}_${matchId}`
  creds: Creds | null;
  setCreds: (c: Creds | null) => void;
  seatBound: boolean;
  setSeatBound: (b: boolean) => void;
  me: string | null;
  amAdmin: boolean;
  pushOn: boolean;
  togglePush: () => Promise<void>;
}

export function useLeague(leagueId: string): LeagueApi {
  const { realUser, ownerOk, ready } = useAuth();
  const [league, setLeague] = useState<LeagueDoc | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [rounds, setRounds] = useState<Record<number, RoundDoc>>({});
  const [priv, setPriv] = useState<PrivDoc | null>(null);
  const [chats, setChats] = useState<Record<string, MatchChatDoc | null>>({});
  const [creds, setCredsState] = useState<Creds | null>(() => leagueCreds.get(leagueId));
  const [seatBound, setSeatBound] = useState(false);
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null);
  const rejoinTried = useRef(false);
  const bindInFlight = useRef(false);
  const chatUnsubs = useRef<Record<string, () => void>>({});

  const setCreds = useCallback((c: Creds | null) => setCredsState(c), []);
  const me = creds?.pid || null;
  const amAdmin = !!realUser && (!!league && league.adminUid === realUser.uid || ownerOk);

  // league doc
  useEffect(() => {
    setLeague(null);
    setNotFound(false);
    const unsub = onSnapshot(doc(db, 'cb-leagues', leagueId), (snap) => {
      if (!snap.exists()) { setNotFound(true); return; }
      setLeague(snap.data() as LeagueDoc);
    }, (e) => console.error('league listener', e));
    return unsub;
  }, [leagueId]);

  // rounds subcollection
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'cb-leagues', leagueId, 'rounds'), (snap) => {
      const next: Record<number, RoundDoc> = {};
      snap.forEach((d) => { const r = d.data() as RoundDoc; next[r.n] = r; });
      setRounds(next);
    }, (e) => console.warn('rounds listener failed', e));
    return unsub;
  }, [leagueId]);

  // seat binding via cbClaim
  useEffect(() => {
    if (!ready || !league || !creds?.pid || seatBound || bindInFlight.current) return;
    bindInFlight.current = true;
    (async () => {
      try {
        await ensureAuthed();
        const uid = auth.currentUser!.uid;
        if (league.uids?.[uid] !== creds.pid) {
          const res = await apiPost<{ secret?: string }>('/api/cb/claim', {
            leagueId, pid: creds.pid, secret: creds.secret || null,
          });
          if (res.secret && !creds.secret) {
            setCredsState(leagueCreds.save(leagueId, { secret: res.secret }));
          }
        }
        setSeatBound(true);
      } catch (e) {
        console.warn('league seat binding failed', e);
      } finally {
        bindInFlight.current = false;
      }
    })();
  }, [ready, league, creds, seatBound, leagueId]);

  // Google rejoin by uid
  useEffect(() => {
    if (!league || !realUser || creds?.pid || rejoinTried.current) return;
    const match = Object.entries(league.players || {}).find(([, p]) => p.uid === realUser.uid);
    if (!match) return;
    rejoinTried.current = true;
    const [pid] = match;
    (async () => {
      try {
        const res = await apiPost<{ secret?: string }>('/api/cb/claim', { leagueId, pid });
        setCredsState(leagueCreds.save(leagueId, { pid, secret: res.secret || '' }));
        setSeatBound(true);
      } catch (e) { console.warn('league rejoin failed', e); }
    })();
  }, [league, realUser, creds, leagueId]);

  // membership mirror
  useEffect(() => {
    if (!league || !realUser) return;
    const iAmAdmin = league.adminUid === realUser.uid;
    if (!creds?.pid && !iAmAdmin) return;
    recordLeagueMembership(realUser.uid, leagueId, league.name || '', iAmAdmin ? 'admin' : 'player');
  }, [league?.name, realUser, creds?.pid]); // eslint-disable-line react-hooks/exhaustive-deps

  // my private doc
  useEffect(() => {
    if (!seatBound || !me) { setPriv(null); return; }
    const unsub = onSnapshot(doc(db, 'cb-leagues', leagueId, 'private', me), (snap) => {
      setPriv(snap.exists() ? (snap.data() as PrivDoc) : null);
    }, (e) => console.warn('league private listener denied', e));
    return unsub;
  }, [leagueId, seatBound, me]);

  // match chats I'm allowed to see: my matches, or all when admin.
  // Denied listeners are dropped and retried on the next sync.
  useEffect(() => {
    if (!league || (!seatBound && !amAdmin)) return;
    for (const r of Object.values(rounds)) {
      if (r.status === 'submission') continue;
      for (const [mid, m] of Object.entries(r.matches || {})) {
        if (!amAdmin && m.a !== me && m.b !== me) continue;
        const key = `${r.n}_${mid}`;
        if (chatUnsubs.current[key]) continue;
        chatUnsubs.current[key] = onSnapshot(
          doc(db, 'cb-leagues', leagueId, 'matchchat', key),
          (snap) => {
            setChats((c) => ({ ...c, [key]: snap.exists() ? (snap.data() as MatchChatDoc) : null }));
          },
          (e) => {
            console.warn('matchchat listener denied', e);
            delete chatUnsubs.current[key];
          },
        );
      }
    }
  }, [league, rounds, seatBound, amAdmin, me, leagueId]);

  // cleanup all chat listeners on unmount / league switch
  useEffect(() => () => {
    for (const unsub of Object.values(chatUnsubs.current)) unsub();
    chatUnsubs.current = {};
  }, [leagueId]);

  // push
  useEffect(() => { currentPushEndpoint().then(setPushEndpoint); }, []);
  const pushOn = useMemo(() => computePushOn(priv, pushEndpoint), [priv, pushEndpoint]);
  const togglePush = useCallback(async () => {
    const privRef = me ? doc(db, 'cb-leagues', leagueId, 'private', me) : null;
    if (pushOn) {
      await disablePush(privRef, priv, pushEndpoint);
      setPushEndpoint(null);
    } else {
      if (!privRef) throw new Error('Join the league first.');
      const ep = await enablePush(privRef, priv);
      setPushEndpoint(ep);
    }
  }, [leagueId, me, priv, pushOn, pushEndpoint]);

  return {
    league, notFound, rounds, priv, chats, creds, setCreds,
    seatBound, setSeatBound, me, amAdmin, pushOn, togglePush,
  };
}
