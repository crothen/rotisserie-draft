// The wishlist: a private watch list of cards. Unlike the queue it is
// never auto-picked — the server does not read it at all. Cards that
// get drafted stay on the list in a second section showing who took them.
import { useState } from 'react';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { useCardHover } from '../components/CardTip';
import { ManaCost } from '../components/ManaCost';
import { isFormatDraft } from '../lib/draftLogic';
import type { Pick, QueueCard, WishCard } from '../lib/types';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { useNameSuggest } from './useNameSuggest';
import { sameCard, usePickActions } from './usePickActions';
import { WishHeart } from './WishHeart';

type WishView = 'list' | 'images';
const VIEW_KEY = 'rd_wish_view'; // device-local preference, like rd_creds

export function WishlistTab() {
  const { draft, v, me, priv, archived, pool } = useDraftCtx();
  const { openCardModal, openFormatCardModal } = useCardModals();
  const { wishName, unwishCard, queueIndex, queueName } = usePickActions();
  const { fetchItems, debounceMs } = useNameSuggest();
  const hover = useCardHover();
  const [value, setValue] = useState('');
  const [view, setViewState] = useState<WishView>(
    () => (localStorage.getItem(VIEW_KEY) === 'images' ? 'images' : 'list'));
  const setView = (vw: WishView) => { setViewState(vw); localStorage.setItem(VIEW_KEY, vw); };
  const images = view === 'images';

  if (!me) return <div className="empty">Join the draft to use a wishlist.</div>;
  const wishlist = priv?.wishlist || [];
  const queue = priv?.queue || [];
  const format = isFormatDraft(draft);

  // same matching as the queue tab: index in classic drafts, name in format drafts
  const pickOf = (card: QueueCard): Pick | undefined => (format
    ? v.picks.find((pk) => !pk.skip && pk.n.toLowerCase() === card.n.toLowerCase())
    : v.picks.find((pk) => !pk.skip && pk.c === card.c));
  const poolCard = (card: QueueCard, pick?: Pick) =>
    (pick ? pool[pick.c] : card.c != null ? pool[card.c] : undefined)
    || pool.find((c) => c?.n.toLowerCase() === card.n.toLowerCase());

  const rows = wishlist.map((card) => ({ card, pick: pickOf(card) }));
  const available = rows.filter((r) => !r.pick);
  const taken = rows.filter((r) => r.pick)
    .sort((a, b) => v.picks.indexOf(a.pick!) - v.picks.indexOf(b.pick!));

  const open = (card: QueueCard, pick?: Pick) => {
    if (pick) openCardModal(pick.c);
    else if (card.c != null) openCardModal(card.c);
    else openFormatCardModal(poolCard(card) || { n: card.n, img: null, m: '', t: '', c: '', v: 0 });
  };
  const add = async (name: string) => {
    if (!name.trim()) return;
    await wishName(name.trim());
    setValue('');
  };
  const removeBtn = (card: QueueCard) => !archived && (
    <button className="btn btn-sm sb-btn" title="Remove from wishlist"
      onClick={(e) => { e.stopPropagation(); unwishCard(card); }}>✕</button>
  );

  /** Image view tile, styled like the pool: Q tag + heart while the card
   *  is available, the picker's name once it is gone (green if it was me). */
  const tile = (card: WishCard, pick?: Pick) => {
    const img = poolCard(card, pick)?.img || card.img;
    const mine = pick?.p === me;
    return (
      <div key={`${card.c}-${card.n}`} className={'cardc' + (pick && !mine ? ' picked' : '')}
        onClick={() => open(card, pick)}>
        {img
          ? <img src={img.replace('/normal/', '/small/')} alt={card.n} loading="lazy" />
          : <div className="noimg">{card.n}</div>}
        {!pick && queue.some((q) => sameCard(q, card)) && <span className="q-tag" title="in your queue">Q</span>}
        {!pick && <WishHeart card={card} />}
        {pick && (
          <span className="picked-tag" style={mine ? { background: 'var(--green)' } : undefined}>
            {mine ? 'You' : draft.players[pick.p]?.name || '?'}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <p className="hint">Keep an eye on cards you care about. The wishlist is only visible to you
        and is <b>never auto-picked</b> — use the queue for that.</p>
      {!archived && !v.done && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <AutocompleteInput
            placeholder="Add a card to your wishlist…"
            value={value}
            onValue={setValue}
            onSelect={add}
            fetchItems={fetchItems}
            debounceMs={debounceMs}
            onSubmit={() => add(value)}
          />
          <button className="btn" onClick={() => add(value)}>☆ Add</button>
        </div>
      )}

      {wishlist.length > 0 && (
        <div className="viewtoggle" style={{ marginBottom: 10 }}>
          <button className={'mini-chip' + (!images ? ' active' : '')} onClick={() => setView('list')}>List</button>
          <button className={'mini-chip' + (images ? ' active' : '')} onClick={() => setView('images')}>Images</button>
        </div>
      )}

      <h3>Still available ({available.length})</h3>
      {available.length && images ? (
        <div className="card-grid">{available.map(({ card }) => tile(card))}</div>
      ) : available.length ? (
        <div className="pick-rows">
          {available.map(({ card }) => {
            const pc = poolCard(card);
            const inQueue = queue.some((q) => sameCard(q, card));
            return (
              <div key={`${card.c}-${card.n}`} className="pick-row" onClick={() => open(card)} {...hover(pc?.img || undefined)}>
                <span>{card.n}</span>
                <span className="mana"><ManaCost cost={pc?.m} /></span>
                {!archived && !v.done && (
                  <button className="btn btn-sm sb-btn" disabled={inQueue}
                    title={inQueue ? 'Already in your queue' : 'Add to your pick queue'}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (card.c != null && !format) queueIndex(card.c); else queueName(card.n);
                    }}>
                    {inQueue ? 'Queued' : 'Queue'}
                  </button>
                )}
                {removeBtn(card)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">{wishlist.length ? 'Every card on your wishlist has been picked.'
          : 'Wishlist is empty — add cards above, or tap ♡ on a card in the pool'}</div>
      )}

      {taken.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Already picked ({taken.length})</h3>
          {images ? (
            <div className="card-grid">{taken.map(({ card, pick }) => tile(card, pick))}</div>
          ) : (
          <div className="pick-rows">
            {taken.map(({ card, pick }) => {
              const pc = poolCard(card, pick);
              const mine = pick!.p === me;
              return (
                <div key={`${card.c}-${card.n}`} className="pick-row" style={{ opacity: mine ? 1 : 0.65 }}
                  onClick={() => open(card, pick)} {...hover(pc?.img || undefined)}>
                  <span className="num">{v.picks.indexOf(pick!) + 1}</span>
                  <span style={mine ? undefined : { textDecoration: 'line-through' }}>{card.n}</span>
                  <span style={{ fontSize: 12, color: mine ? 'var(--green)' : 'var(--red)' }}>
                    {mine ? 'you got it' : `picked by ${draft.players[pick!.p]?.name || 'someone'}`}
                  </span>
                  <span className="mana"><ManaCost cost={pc?.m} /></span>
                  {removeBtn(card)}
                </div>
              );
            })}
          </div>
          )}
        </>
      )}
    </>
  );
}
