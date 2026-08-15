// A row of small card images for a Card Blind deck, with hover preview
// and a click-to-enlarge modal.
import { useCardHover } from '../components/CardTip';
import { useModal } from '../components/Modal';
import type { CbCard } from '../lib/types';

export function CbDeck({ cards }: { cards: CbCard[] }) {
  const hover = useCardHover();
  const { openModal, closeModal } = useModal();
  return (
    <div className="cb-deck">
      {(cards || []).map((c, i) => c.img ? (
        <img
          key={i}
          className="cb-card"
          loading="lazy"
          src={c.img.replace('/normal/', '/small/')}
          alt={c.n}
          title={c.n}
          onClick={() => openModal(
            <>
              <img className="bigcard" src={c.img!} alt={c.n} />
              <div className="modal-actions"><button className="btn" onClick={closeModal}>Close</button></div>
            </>,
          )}
          {...hover(c.img)}
        />
      ) : (
        <div key={i} className="cb-card cb-noimg" title={c.n}>{c.n}</div>
      ))}
    </div>
  );
}
