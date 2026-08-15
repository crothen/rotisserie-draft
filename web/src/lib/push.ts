// Web Push with raw VAPID against the seat's private doc (drafts and
// leagues share the pushSubs shape).
import { arrayUnion, updateDoc, type DocumentReference } from 'firebase/firestore';
import type { PrivDoc } from './types';

export const VAPID_PUBLIC =
  'BBwWu4Duu4THhbcxb1fJofvfaWQgu13WHe6OnvDkHA23yU7fcCfpe-MShsMtsqOc84K_ruonzvVh_Z0M12zsGqY';

function urlB64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const sub = await reg.pushManager?.getSubscription();
    return sub?.endpoint || null;
  } catch { return null; }
}

/** Push is "on" only if THIS device's subscription is registered in the
 *  seat's private doc. */
export function computePushOn(priv: PrivDoc | null, endpoint: string | null): boolean {
  return !!endpoint &&
    'Notification' in window && Notification.permission === 'granted' &&
    (priv?.pushSubs || []).some((s) => s.endpoint === endpoint);
}

export async function enablePush(privRef: DocumentReference, priv: PrivDoc | null): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    throw new Error(isIOS
      ? 'On iPhone: add this page to your Home Screen first (Share → Add to Home Screen), then enable notifications from the installed app.'
      : 'Push notifications are not supported in this browser.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC) as BufferSource,
  });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const subs = priv?.pushSubs || [];
  if (!subs.some((s) => s.endpoint === json.endpoint)) {
    await updateDoc(privRef, {
      pushSubs: arrayUnion({ endpoint: json.endpoint, keys: json.keys }),
    });
  }
  return json.endpoint;
}

export async function disablePush(
  privRef: DocumentReference | null,
  priv: PrivDoc | null,
  knownEndpoint: string | null,
) {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  const endpoint = sub?.endpoint || knownEndpoint;
  if (sub) await sub.unsubscribe();
  if (endpoint && privRef) {
    const subs = priv?.pushSubs || [];
    await updateDoc(privRef, {
      pushSubs: subs.filter((s) => s.endpoint !== endpoint),
    });
  }
}
