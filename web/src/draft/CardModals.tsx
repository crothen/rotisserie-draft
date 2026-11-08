// Card detail modals (pool card / unpicked format card / my deck).
// Modal content renders outside the DraftContext tree, so everything
// is passed explicitly — the content is a snapshot, like the old app.
import { useModal } from '../components/Modal';
import { ManaCost } from '../components/ManaCost';
import { draftView, isFormatDraft } from '../lib/draftLogic';
import { TYPE_FILTERS } from './filters';
import { useDraftCtx } from './context';
import { usePickActions } from './usePickActions';
import type { Pick, PoolCard, WishCard } from '../lib/types';

export function useCardModals() {
  const ctx = useDraftCtx();
  const { openModal, closeModal } = useModal();
  const { pickIndex, pickName, queueIndex, queueName, isWished, wishCard, unwishCard } = usePickActions();

  /** Wishlist toggle. Snapshot modal, so it closes after acting. A
   *  picked card can still be removed, but no longer added. */
  const wishButton = (card: WishCard, picked: boolean) => {
    const { me, archived } = ctx;
    if (!me || archived) return null;
    const wished = isWished(card);
    if (picked && !wished) return null;
    return (
      <button className="btn" onClick={() => {
        (wished ? unwishCard(card) : wishCard(card)).then(closeModal);
      }}>
        {wished ? '★ Remove from wishlist' : '☆ Wishlist'}
      </button>
    );
  };

  const openCardModal = (cardId: number) => {
    const { draft, pool, me, priv, archived } = ctx;
    const c = pool[cardId];
    if (!c) return; // format-draft queue rows may reference no pool entry yet
    const v = draftView(draft);
    const picked = v.pickedIds.has(cardId);
    const pick = picked ? v.picks.find((p) => p.c === cardId) : null;
    const picker = pick ? draft.players[pick.p]?.name : null;
    const myTurn = v.curPid === me && !v.done;
    const inQueue = (priv?.queue || []).some((i) => i.c === cardId);
    const canAct = !picked && !!me && !v.done && !archived;
    openModal(
      <>
        {c.img
          ? <img className="bigcard" src={c.img} alt={c.n} />
          : <><h2>{c.n}</h2><p className="status-line">{c.t} <ManaCost cost={c.m} /></p></>}
        <div className="status-line">
          {picked
            ? <>Picked by <b>{picker || '?'}</b> (pick {pick ? v.picks.indexOf(pick) + 1 : '?'})</>
            : 'Available'}
        </div>
        <div className="modal-actions">
          {canAct && (
            <>
              <button className="btn btn-primary" disabled={!myTurn} onClick={() => pickIndex(cardId)}>
                {myTurn ? 'Pick now' : 'Not your turn'}
              </button>
              <button className="btn" disabled={inQueue} onClick={() => queueIndex(cardId)}>
                {inQueue ? 'In queue' : 'Add to queue'}
              </button>
            </>
          )}
          {wishButton({ c: isFormatDraft(draft) ? null : cardId, n: c.n }, picked)}
          <button className="btn" onClick={closeModal}>Close</button>
        </div>
      </>,
    );
  };

  /** Format drafts: a card that is not (yet) in the derived pool. */
  const openFormatCardModal = (c: PoolCard) => {
    const { draft, me, priv, archived } = ctx;
    const v = draftView(draft);
    const lower = c.n.toLowerCase();
    const pick = v.picks.find((p) => !p.skip && p.n.toLowerCase() === lower);
    if (pick) { openCardModal(pick.c); return; } // picked → the regular modal
    const myTurn = v.curPid === me && !v.done;
    const inQueue = (priv?.queue || []).some((i) => (i.n || '').toLowerCase() === lower);
    openModal(
      <>
        {c.img
          ? <img className="bigcard" src={c.img} alt={c.n} />
          : <><h2>{c.n}</h2><p className="status-line">{c.t || ''} <ManaCost cost={c.m} /></p></>}
        <div className="status-line">Available</div>
        <div className="modal-actions">
          {me && !v.done && !archived && (
            <>
              <button className="btn btn-primary" disabled={!myTurn} onClick={() => pickName(c.n)}>
                {myTurn ? 'Pick now' : 'Not your turn'}
              </button>
              <button className="btn" disabled={inQueue} onClick={() => queueName(c.n)}>
                {inQueue ? 'In queue' : 'Add to queue'}
              </button>
            </>
          )}
          {!v.done && wishButton({ c: null, n: c.n, ...(c.img ? { img: c.img } : {}) }, false)}
          <button className="btn" onClick={closeModal}>Close</button>
        </div>
      </>,
    );
  };

  /** Quick view of my own deck (floating deck button). */
  const openMyDeckModal = () => {
    const { draft, pool, me, priv } = ctx;
    if (!me) return;
    const v = draftView(draft);
    const sb = new Set(priv?.sideboard || []);
    const picks = v.picks.map((p, gi) => ({ ...p, gi })).filter((p) => p.p === me && !p.skip);
    const main = picks.filter((p) => !sb.has(p.c));
    const sbPicks = picks.filter((p) => sb.has(p.c));
    const groups: Record<string, (Pick & { gi: number })[]> = {};
    for (const p of main) {
      const t = pool[p.c]?.t || '';
      const g = TYPE_FILTERS.find((ty) => t.includes(ty)) || 'Other';
      (groups[g] ||= []).push(p);
    }
    const row = (p: Pick & { gi: number }) => (
      <div key={p.gi} className="pick-row" onClick={() => openCardModal(p.c)}>
        <span className="num">{p.gi + 1}</span>
        <span>{pool[p.c]?.n || p.n}</span>
        {p.auto && <span className="automark" title="auto-picked from queue">A</span>}
        <span className="mana"><ManaCost cost={pool[p.c]?.m} /></span>
      </div>
    );
    openModal(
      <>
        <h2>Your deck ({main.length}{sbPicks.length ? ` + ${sbPicks.length} SB` : ''})</h2>
        {main.length
          ? TYPE_FILTERS.concat('Other').filter((g) => groups[g]?.length).map((g) => (
            <div key={g}>
              <h3>{g} ({groups[g].length})</h3>
              <div className="pick-rows">
                {groups[g].sort((a, b) => (pool[a.c]?.v || 0) - (pool[b.c]?.v || 0)).map(row)}
              </div>
            </div>
          ))
          : <p className="hint">No picks yet.</p>}
        {sbPicks.length > 0 && (
          <>
            <h3>Sideboard ({sbPicks.length})</h3>
            <div className="pick-rows">{sbPicks.map(row)}</div>
          </>
        )}
        <div className="modal-actions"><button className="btn" onClick={closeModal}>Close</button></div>
      </>,
    );
  };

  return { openCardModal, openFormatCardModal, openMyDeckModal };
}
