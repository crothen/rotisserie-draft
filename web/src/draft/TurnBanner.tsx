import { useTicker } from '../hooks/useCountdown';
import { queueGonePredicate, resolveQueue } from '../lib/draftLogic';
import { useDraftCtx } from './context';

export function TurnBanner() {
  const { draft, v, me, priv } = useDraftCtx();
  useTicker(60_000); // keep the waiting-hours label fresh
  if (v.done) {
    return (
      <div className="turn-banner">
        <div className="big">Draft complete</div>
        <div className="sub">Every player drafted {v.s.totalPicks} cards. Check the decks tab.</div>
      </div>
    );
  }
  const cur = (v.curPid && draft.players[v.curPid]?.name) || '?';
  const myTurn = v.curPid === me;
  const curCount = v.picks.filter((p) => p.p === v.curPid).length;
  const doubleTurn = v.seq[v.picks.length + 1] === v.seq[v.picks.length];
  const nextIdx = v.seq.slice(v.picks.length).findIndex((x) => x !== v.seq[v.picks.length]);
  const nextPid = nextIdx >= 0 ? v.order[v.seq[v.picks.length + nextIdx]] : null;
  const waiting = Math.round((Date.now() - (draft.turnStartedAt || Date.now())) / 36e5);
  // my queue's decision point: the entry the auto-pick walk stalled on
  const stall = myTurn ? resolveQueue(priv?.queue || [], queueGonePredicate(draft)).stalledOn : null;
  return (
    <div className={'turn-banner' + (myTurn ? ' mine' : '')}>
      <div className="big">
        {myTurn
          ? <>Your turn — pick {doubleTurn ? '2 cards' : 'a card'}</>
          : <>Waiting for <b>{cur}</b>{doubleTurn ? ' (2 picks)' : ''}{waiting >= 2 ? ` · ${waiting}h` : ''}</>}
      </div>
      {stall && (
        <div className="sub stall">
          <b>{stall.n}</b> from your queue was picked by <b>{stall.tb || 'someone'}</b> —
          dismiss it in the queue tab or just pick another card.
        </div>
      )}
      <div className="sub">
        Pick {curCount + 1}/{v.s.totalPicks} for {cur} · {v.picks.length}/{v.seq.length} total
        {nextPid && nextPid !== v.curPid ? ` · up next: ${draft.players[nextPid]?.name || '?'}` : ''}
      </div>
      <div className="progress"><div style={{ width: `${(v.picks.length / v.seq.length) * 100}%` }} /></div>
    </div>
  );
}
