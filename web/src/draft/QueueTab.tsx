// The pick queue: reorder (buttons + pointer drag), dismiss snipes,
// pick the top card. Queue items reference pool indexes (classic) or
// names only (format drafts).
import { useRef } from 'react';
import { useToast } from '../components/Toasts';
import { isFormatDraft, pickedNamesSet } from '../lib/draftLogic';
import type { QueueItem } from '../lib/types';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
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
  const topGone = queue[0] && (queue[0].tb || (isFormatDraft(draft)
    ? pickedNamesSet(draft).has((queue[0].n || '').toLowerCase())
    : queue[0].c != null && v.pickedIds.has(queue[0].c)));
  const topPickable = myTurn && queue[0] && !topGone;

  const write = (q: QueueItem[]) => setQueue(draftId, me, q).catch((e) => toast((e as Error).message, true));

  if (archived) {
    return (
      <>
        <p className="hint">This draft is archived — the queue is read only.</p>
        {queue.length
          ? <div className="pick-rows">{queue.map((item, i) => (
            <div key={i} className="pick-row"><span>{item.n}</span></div>
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

  return (
    <>
      <p className="hint">On your turn the <b>top</b> card is picked automatically for you. If someone
        else picked it first, it stays here marked and the draft <b>waits for you</b> —
        dismiss it (✕) and pick, or reorder the queue.</p>
      {queue.length ? (
        <div id="q-list" ref={listRef}>
          {queue.map((item, i) => (
            <div key={`${item.n}-${i}`} className={'q-row' + (item.tb ? ' taken' : '')}>
              <span className="q-drag" title="Drag to reorder" onPointerDown={(e) => onDragStart(e, i)}>☰</span>
              <span className="pos">{i + 1}</span>
              <span className="nm" onClick={() => { if (item.c != null) openCardModal(item.c); }}>
                {item.n}
                {item.tb && <span className="q-taken"> picked by {item.tb}</span>}
              </span>
              <button className="btn btn-sm" disabled={i === 0} onClick={() => {
                const q = [...queue]; [q[i - 1], q[i]] = [q[i], q[i - 1]]; write(q);
              }}>↑</button>
              <button className="btn btn-sm" disabled={i === queue.length - 1} onClick={() => {
                const q = [...queue]; [q[i + 1], q[i]] = [q[i], q[i + 1]]; write(q);
              }}>↓</button>
              <button className="btn btn-sm btn-danger" title={item.tb ? 'Dismiss' : 'Remove'} onClick={() => {
                const q = [...queue]; q.splice(i, 1); write(q);
              }}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">Queue is empty — add cards from the pool</div>
      )}
      {topPickable && (
        <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => {
          const top = queue[0];
          if (!top) return;
          if (isFormatDraft(draft)) pickName(top.n);
          else if (top.c != null) pickIndex(top.c);
        }}>
          Pick {queue[0].n} now
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
