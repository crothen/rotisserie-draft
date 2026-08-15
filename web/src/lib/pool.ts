// Pool storage is chunked so big set pools stay under the 1MB document
// limit: meta/pool {cards, chunks} plus meta/pool_1, pool_2, …
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { PoolCard } from './types';

const CHUNK = 500;

export async function writePool(draftId: string, cards: PoolCard[]) {
  const chunks = Math.max(1, Math.ceil(cards.length / CHUNK));
  await setDoc(doc(db, 'rd-drafts', draftId, 'meta', 'pool'), {
    cards: cards.slice(0, CHUNK), chunks,
  });
  for (let i = 1; i < chunks; i++) {
    await setDoc(doc(db, 'rd-drafts', draftId, 'meta', `pool_${i}`), {
      cards: cards.slice(i * CHUNK, (i + 1) * CHUNK),
    });
  }
}

export async function loadPool(draftId: string): Promise<PoolCard[]> {
  const snap = await getDoc(doc(db, 'rd-drafts', draftId, 'meta', 'pool'));
  if (!snap.exists()) return [];
  const data = snap.data();
  let cards: PoolCard[] = data.cards || [];
  for (let i = 1; i < (data.chunks || 1); i++) {
    const part = await getDoc(doc(db, 'rd-drafts', draftId, 'meta', `pool_${i}`));
    if (part.exists()) cards = cards.concat(part.data().cards || []);
  }
  return cards;
}
