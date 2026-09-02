// The pick queue: reorder (buttons + pointer drag), dismiss snipes,
// pick the top card. Queue items reference pool indexes (classic) or
// names only (format drafts). Every entry carries an "if taken" plan
// (wait / skip to next / take a fallback) that resolveQueue walks.
import { useRef, useState } from 'react';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { useToast } from '../components/Toasts';
import { isFormatDraft, pickedNamesSet, queueGonePredicate, resolveQueue } from '../lib/draftLogic';
import type { IfTaken, QueueCard, QueueItem } from '../lib/types';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { useNameSuggest } from './useNameSuggest';
import { usePickActions } from './usePickActions';
import { setQueue } from './actions';

export function QueueTab() {
  const ctx = useDraftCtx();
  const { draft, draftId, v, me, priv, archived, api } = ctx;
  const { openCardModal } = useCardModals();
  const { pickIndex, pickName } = usePickActions();
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);

  if (!me) return <div className="empty">Join the draft to use a pick queue.</div>;
  const queue = priv?.queue || [];
  const myTurn = !v.done && !archived && v.curPid === me;
  const gone = queueGonePredicate(draft);
  const res = resolveQueue(queue, gone);
  const nowPick = myTurn ? res.pick : null;

  const write = (q: QueueItem[]) => setQueue(draftId, me, q).catch((e) => toast((e as Error).message, true));
  const writeItem = (i: number, item: QueueItem) => { const q = [...queue]; q[i] = item; write(q); };

  if (archived) {
    return (
      <>
        <p className="hint">This draft is archived — the queue is read only.</p>
        {queue.length
          ? <div className="pick-rows">{queue.map((item, i) => (
            <div key={i} className="pick-row"><span>{item.n}</span>{planLabel(item)}</div>
          ))}</div>
          : <div className="empty">Queue is empty.</div>}
      </>
    );
  }

  const onDragStart = (e: React.PointerEvent, fromIdx: number) => {
    const handle = e.currentTarget as HTMLElement;
    const row = handle.closest('.q-row') as HTMLElement;
    const list = listRef.current;
    if (!row || !list) return;
    const startY = e.clientY;
    let target = fromIdx;
    row.classList.add('dragging');
    const line = document.createElement('div');
    line.className = 'q-drop-line';
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      row.style.transform = `translateY(${ev.clientY - startY}px)`;
      const others = [...list.querySelectorAll<HTMLElement>('.q-row')].filter((r) => r !== row);
      let t = 0;
      for (const r of others) {
        const rect = r.getBoundingClientRect();
        if (ev.clientY > rect.top + rect.height / 2) t++;
      }
      target = t;
      const anchor = others[t] || null;
      if (anchor) list.insertBefore(line, anchor);
      else list.appendChild(line);
    };
    const finish = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      row.classList.remove('dragging');
      row.style.transform = '';
      line.remove();
      const q = [...queue];
      const item = q.splice(fromIdx, 1)[0];
      if (!item || target === fromIdx) return;
      q.splice(target, 0, item);
      write(q);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };

  const setPlan = (i: number, plan: IfTaken) => {
    // Firestore rejects `undefined` fields, so unset keys are omitted
    // rather than nulled.
    const { ifTaken: _p, alt, ...rest } = queue[i];
    if (plan === 'stop') writeItem(i, rest);
    else if (plan === 'next') writeItem(i, { ...rest, ifTaken: 'next' });
    else writeItem(i, { ...rest, ifTaken: 'alt', ...(alt ? { alt } : {}) });
  };

  return (
    <>
      <p className="hint">On your turn the <b>top</b> card is picked automatically for you. If someone
        else picked it first, the draft <b>waits for you</b> by default — or set what happens
        <b> if taken</b>: skip to the next card, or take a fallback card instead.</p>
      {queue.length ? (
        <div id="q-list" ref={listRef}>
          {queue.map((item, i) => {
            const taken = !!item.tb || gone(item);
            return (
              <div key={`${item.n}-${i}`} className={'q-row' + (taken ? ' taken' : '')}>
                <div className="q-main">
                  <span className="q-drag" title="Drag to reorder" onPointerDown={(e) => onDragStart(e, i)}>☰</span>
                  <span className="pos">{i + 1}</span>
                  <span className="nm" onClick={() => { if (item.c != null) openCardModal(item.c); }}>
                    {item.n}
                    {taken && <span className="q-taken"> picked by {item.tb || 'someone'}</span>}
                  </span>
                  <button className="btn btn-sm" disabled={i === 0} onClick={() => {
                    const q = [...queue]; [q[i - 1], q[i]] = [q[i], q[i - 1]]; write(q);
                  }}>↑</button>
                  <button className="btn btn-sm" disabled={i === queue.length - 1} onClick={() => {
                    const q = [...queue]; [q[i + 1], q[i]] = [q[i], q[i + 1]]; write(q);
                  }}>↓</button>
                  <button className="btn btn-sm btn-danger" title={taken ? 'Dismiss' : 'Remove'} onClick={() => {
                    const q = [...queue]; q.splice(i, 1); write(q);
                  }}>✕</button>
                </div>
                <div className="q-plan">
                  <span className="q-plan-l">if taken</span>
                  <select value={item.ifTaken || 'stop'} onChange={(e) => setPlan(i, e.target.value as IfTaken)}>
                    <option value="stop">wait for me</option>
                    <option value="next">skip to the next card</option>
                    <option value="alt">take another card instead</option>
                  </select>
                  {item.ifTaken === 'alt' && (item.alt ? (
                    <span className={'q-alt' + (gone(item.alt) ? ' taken' : '')}>
                      → <b>{item.alt.n}</b>
                      {gone(item.alt) && <span className="q-taken"> also gone</span>}
                      <button className="btn btn-sm" title="Change fallback" onClick={() => {
                        const { alt: _a, ...rest } = item; writeItem(i, rest);
                      }}>✕</button>
                    </span>
                  ) : (
                    <AltPicker item={item} onChoose={(alt) => writeItem(i, { ...item, alt })} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">Queue is empty — add cards from the pool</div>
      )}
      {nowPick && (
        <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => {
          if (isFormatDraft(draft)) pickName(nowPick.n);
          else if (nowPick.c != null) pickIndex(nowPick.c);
        }}>
          Pick {nowPick.n} now{res.from && res.from.n !== nowPick.n ? ` (instead of ${res.from.n})` : ''}
        </button>
      )}
      {!api.pushOn && queue.length > 0 && (
        <button className="btn btn-block" style={{ marginTop: 10 }} onClick={() =>
          api.togglePush().then(() => toast('Notifications enabled.')).catch((e) => toast((e as Error).message, true))}>
          Enable notifications to hear about snipes
        </button>
      )}
    </>
  );
}

function planLabel(item: QueueItem) {
  if (item.ifTaken === 'next') return <span className="q-plan-tag">if taken: skip</span>;
  if (item.ifTaken === 'alt') return <span className="q-plan-tag">if taken: {item.alt?.n || '?'}</span>;
  return null;
}

/** Inline card picker for an entry's fallback card. Classic drafts
 *  resolve the name to an unpicked pool index; format drafts store the
 *  name and let the server validate it at pick time. */
function AltPicker({ item, onChoose }: { item: QueueItem; onChoose: (alt: QueueCard) => void }) {
  const { draft } = useDraftCtx();
  const { findAvailableByName } = usePickActions();
  const { fetchItems, debounceMs } = useNameSuggest();
  const toast = useToast();
  const [value, setValue] = useState('');

  const choose = (name: string) => {
    const n = name.trim();
    if (!n) return;
    if (n.toLowerCase() === item.n.toLowerCase()) { toast('That is the same card.', true); return; }
    if (isFormatDraft(draft)) {
      if (pickedNamesSet(draft).has(n.toLowerCase())) { toast(`${n} was already picked.`, true); return; }
      onChoose({ c: null, n });
    } else {
      const id = findAvailableByName(n);
      if (id == null) { toast(`"${n}" is not available in the pool.`, true); return; }
      onChoose({ c: id, n });
    }
    setValue('');
  };

  return (
    <span className="q-alt-pick">
      <AutocompleteInput
        placeholder="fallback card…"
        value={value}
        onValue={setValue}
        onSelect={choose}
        fetchItems={fetchItems}
        debounceMs={debounceMs}
        onSubmit={() => choose(value)}
      />
      <button className="btn btn-sm" onClick={() => choose(value)}>Set</button>
    </span>
  );
}
