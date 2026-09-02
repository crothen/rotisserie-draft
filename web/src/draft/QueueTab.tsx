// The pick queue as a grid: each row is a first choice followed by a
// chain of fallbacks tried left to right. resolveQueue walks it exactly
// like the server does, and the walk is drawn on the rows — green for
// the card that will be picked, red for cards that are gone — so the
// player can see what auto-pick would do right now.
import { useRef, useState } from 'react';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { useCardHover } from '../components/CardTip';
import { useToast } from '../components/Toasts';
import {
  isFormatDraft, pickedNamesSet, queueGonePredicate, queueRowAlts, queueRowCards, queueRowCont, resolveQueue,
} from '../lib/draftLogic';
import type { QueueCard, QueueItem } from '../lib/types';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { useNameSuggest } from './useNameSuggest';
import { usePickActions } from './usePickActions';
import { setQueue } from './actions';

/** Writes a row in the current shape (drops the deprecated fields;
 *  Firestore rejects `undefined`, so absent keys are omitted). */
function makeRow(item: QueueItem, patch: { alts?: QueueCard[]; cont?: boolean }): QueueItem {
  const { alt: _a, ifTaken: _i, alts: _s, cont: _c, ...rest } = item;
  const alts = patch.alts ?? queueRowAlts(item);
  const cont = patch.cont ?? queueRowCont(item);
  return { ...rest, ...(alts.length ? { alts } : {}), ...(cont ? { cont: true } : {}) };
}

export function QueueTab() {
  const ctx = useDraftCtx();
  const { draft, draftId, v, me, priv, archived, api, pool } = ctx;
  const { openCardModal } = useCardModals();
  const { pickIndex, pickName } = usePickActions();
  const hover = useCardHover();
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<number | null>(null);

  if (!me) return <div className="empty">Join the draft to use a pick queue.</div>;
  const queue = priv?.queue || [];
  const myTurn = !v.done && !archived && v.curPid === me;
  const gone = queueGonePredicate(draft);
  const res = resolveQueue(queue, gone);
  const nowPick = myTurn ? res.pick : null;
  // rows before `activeRow` were fallen through, `activeRow` is where the
  // walk ends (pick or stop), rows after it are not reached yet
  const activeRow = res.from ? queue.indexOf(res.from) : res.stalledOn ? queue.indexOf(res.stalledOn) : queue.length;
  const format = isFormatDraft(draft);
  const pickerOf = (card: QueueCard): string | null => {
    const p = format
      ? v.picks.find((pk) => !pk.skip && pk.n.toLowerCase() === (card.n || '').toLowerCase())
      : v.picks.find((pk) => pk.c === card.c);
    return p ? draft.players[p.p]?.name || 'someone' : null;
  };

  const write = (q: QueueItem[]) => setQueue(draftId, me, q).catch((e) => toast((e as Error).message, true));
  const writeRow = (i: number, row: QueueItem) => { const q = [...queue]; q[i] = row; write(q); };

  if (archived) {
    return (
      <>
        <p className="hint">This draft is archived — the queue is read only.</p>
        {queue.length
          ? <div className="pick-rows">{queue.map((item, i) => (
            <div key={i} className="pick-row">
              <span>{queueRowCards(item).map((c) => c.n).join(' → ')}</span>
              {queueRowCont(item) && <span className="q-plan-tag">then next row</span>}
            </div>
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

  const openCard = (card: QueueCard) => { if (card.c != null) openCardModal(card.c); };
  const imgOf = (card: QueueCard) => (card.c != null ? pool[card.c]?.img : null) || undefined;

  return (
    <>
      <p className="hint">On your turn the first available card of the <b>top row</b> is picked for you:
        the first choice, or — if someone took it — the next fallback to its right. When a whole row
        is gone the draft <b>waits for you</b>, unless the row says to move on to the next one.</p>
      {queue.length > 0 && (
        <div className="q-legend">
          <span><span className="q-card pick" style={{ padding: '1px 6px', cursor: 'default' }}>card</span> will be picked</span>
          <span><span className="q-card gone" style={{ padding: '1px 6px', cursor: 'default' }}><span className="cn">card</span></span> already gone</span>
          <span><span className="q-tail go">↓ next row</span> falls through</span>
          <span><span className="q-tail stop">■ waits for you</span> stops here</span>
        </div>
      )}
      {queue.length ? (
        <div id="q-list" ref={listRef}>
          {queue.map((item, i) => {
            const cards = queueRowCards(item);
            const cont = queueRowCont(item);
            const reached = i <= activeRow;
            const isActive = i === activeRow;
            const pickIdx = isActive && res.pick
              ? cards.findIndex((c) => (format ? c.n.toLowerCase() === res.pick!.n.toLowerCase() : c.c === res.pick!.c))
              : -1;
            const allGone = cards.every((c, k) => (k === 0 && item.tb) || gone(c));
            const firstGone = !!item.tb || gone(cards[0]);
            return (
              <div key={`${item.n}-${i}`} className={'q-row' + (firstGone ? ' taken' : '')}>
                <div className="q-main">
                  <span className="q-drag" title="Drag to reorder" onPointerDown={(e) => onDragStart(e, i)}>☰</span>
                  <span className="pos">{i + 1}</span>
                  <div className="q-chain">
                    {cards.map((card, k) => {
                      const isGone = (k === 0 && !!item.tb) || gone(card);
                      const state = isGone ? 'gone' : k === pickIdx ? 'pick' : '';
                      const who = isGone ? pickerOf(card) || item.tb || 'someone' : null;
                      return (
                        <span key={`${card.n}-${k}`} style={{ display: 'contents' }}>
                          {k > 0 && (
                            <span className={'q-arrow' + (reached && isGone ? ' red' : reached && k <= pickIdx ? ' green' : '')}>→</span>
                          )}
                          <span
                            className={'q-card ' + state + (!reached ? ' dim' : '')}
                            title={isGone ? `${card.n} — picked by ${who}` : card.n}
                            onClick={() => openCard(card)}
                            {...hover(imgOf(card))}
                          >
                            <span className="cn">{card.n}</span>
                            {isGone && <span className="q-taken">{who}</span>}
                            {k > 0 && (
                              <button className="q-x" title="Remove this fallback" onClick={(e) => {
                                e.stopPropagation();
                                const alts = queueRowAlts(item).filter((_, j) => j !== k - 1);
                                writeRow(i, makeRow(item, { alts }));
                              }}>✕</button>
                            )}
                          </span>
                        </span>
                      );
                    })}
                    {adding === i ? (
                      <AltPicker
                        row={item}
                        onChoose={(alt) => { writeRow(i, makeRow(item, { alts: [...queueRowAlts(item), alt] })); setAdding(null); }}
                        onCancel={() => setAdding(null)}
                      />
                    ) : (
                      <button className="btn btn-sm q-add" title="Add a fallback: taken if everything to the left is gone"
                        onClick={() => setAdding(i)}>+</button>
                    )}
                    {allGone && reached && (
                      cont
                        ? <span className="q-tail go">↓ next row</span>
                        : <span className="q-tail stop">■ waits for you</span>
                    )}
                  </div>
                  <button className="btn btn-sm" disabled={i === 0} onClick={() => {
                    const q = [...queue]; [q[i - 1], q[i]] = [q[i], q[i - 1]]; write(q);
                  }}>↑</button>
                  <button className="btn btn-sm" disabled={i === queue.length - 1} onClick={() => {
                    const q = [...queue]; [q[i + 1], q[i]] = [q[i], q[i + 1]]; write(q);
                  }}>↓</button>
                  <button className="btn btn-sm btn-danger" title={firstGone ? 'Dismiss row' : 'Remove row'} onClick={() => {
                    const q = [...queue]; q.splice(i, 1); write(q);
                  }}>✕</button>
                </div>
                <div className="q-side">
                  <span className="q-plan-l">if all gone</span>
                  <select value={cont ? 'next' : 'stop'} onChange={(e) => writeRow(i, makeRow(item, { cont: e.target.value === 'next' }))}>
                    <option value="stop">wait for me</option>
                    <option value="next">move on to the next row</option>
                  </select>
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
          if (format) pickName(nowPick.n);
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

/** Inline card picker for a row's next fallback. Classic drafts resolve
 *  the name to an unpicked pool index; format drafts store the name and
 *  let the server validate it at pick time. */
function AltPicker({ row, onChoose, onCancel }: {
  row: QueueItem; onChoose: (alt: QueueCard) => void; onCancel: () => void;
}) {
  const { draft } = useDraftCtx();
  const { findAvailableByName } = usePickActions();
  const { fetchItems, debounceMs } = useNameSuggest();
  const toast = useToast();
  const [value, setValue] = useState('');

  const choose = (name: string) => {
    const n = name.trim();
    if (!n) return;
    const inRow = queueRowCards(row).some((c) => c.n.toLowerCase() === n.toLowerCase());
    if (inRow) { toast('That card is already in this row.', true); return; }
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
      <button className="btn btn-sm" onClick={() => choose(value)}>Add</button>
      <button className="btn btn-sm" onClick={onCancel}>✕</button>
    </span>
  );
}
