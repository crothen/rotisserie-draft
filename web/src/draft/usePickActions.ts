// Pick / queue actions shared by the pickbar, pool tiles and modals.
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { draftView, isFormatDraft, pickedNamesSet } from '../lib/draftLogic';
import { useDraftCtx } from './context';
import { addToQueue, pickByIndex, pickByName } from './actions';

export function usePickActions() {
  const ctx = useDraftCtx();
  const toast = useToast();
  const { closeModal } = useModal();
  const { draftId, draft, pool, me, priv } = ctx;

  const findAvailableByName = (name: string): number | null => {
    const v = draftView(draft);
    const idx = pool.findIndex((c, i) => c && c.n.toLowerCase() === name.toLowerCase() && !v.pickedIds.has(i));
    return idx >= 0 ? idx : null;
  };

  const pickIndex = async (cardId: number) => {
    if (!me) return;
    try {
      await pickByIndex(draftId, cardId);
      toast(`Picked ${pool[cardId]?.n || ''}`);
      closeModal();
    } catch (e) { toast((e as Error).message, true); }
  };

  const pickName = async (name: string) => {
    if (!me || !name) return;
    if (isFormatDraft(draft)) {
      try {
        const res = await pickByName(draftId, name);
        toast(`Picked ${res.name || name}`);
        closeModal();
      } catch (e) { toast((e as Error).message, true); }
      return;
    }
    const id = findAvailableByName(name);
    if (id == null) { toast(`"${name}" is not available in the pool.`, true); return; }
    await pickIndex(id);
  };

  const queueIndex = async (cardId: number) => {
    if (!me) { toast('Join the draft first.', true); return; }
    const queue = priv?.queue || [];
    if (queue.some((i) => i.c === cardId)) { toast('Already in your queue.'); return; }
    await addToQueue(draftId, me, { c: cardId, n: pool[cardId].n });
    toast(`${pool[cardId].n} added to queue`);
    closeModal();
  };

  const queueName = async (name: string) => {
    if (!name) return;
    if (!me) { toast('Join the draft first.', true); return; }
    if (isFormatDraft(draft)) {
      const queue = priv?.queue || [];
      if (queue.some((i) => (i.n || '').toLowerCase() === name.toLowerCase())) {
        toast('Already in your queue.');
        return;
      }
      if (pickedNamesSet(draft).has(name.toLowerCase())) { toast(`${name} was already picked.`, true); return; }
      await addToQueue(draftId, me, { c: null, n: name });
      toast(`${name} added to queue`);
      closeModal();
      return;
    }
    const id = findAvailableByName(name);
    if (id == null) { toast(`"${name}" is not available in the pool.`, true); return; }
    await queueIndex(id);
  };

  return { pickIndex, pickName, queueIndex, queueName, findAvailableByName };
}
