// Heart toggle in the bottom-left corner of a card image (pool tiles,
// wishlist image view). Hidden for watchers, archived or finished drafts.
import type { WishCard } from '../lib/types';
import { useDraftCtx } from './context';
import { usePickActions } from './usePickActions';

export function WishHeart({ card }: { card: WishCard }) {
  const { me, archived, v } = useDraftCtx();
  const { isWished, wishCard, unwishCard } = usePickActions();
  if (!me || archived || v.done) return null;
  const on = isWished(card);
  return (
    <button
      className={'wish-heart' + (on ? ' on' : '')}
      title={on ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-label={on ? 'Remove from wishlist' : 'Add to wishlist'}
      onClick={(e) => { e.stopPropagation(); (on ? unwishCard(card) : wishCard(card)); }}
    >
      {on ? '♥' : '♡'}
    </button>
  );
}
