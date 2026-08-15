import type { PlayerInfo } from '../lib/types';

/** Small status tags shown next to player names (bot / dropped). */
export function PlayerTags({ p }: { p: Partial<PlayerInfo> }) {
  return (
    <>
      {p.bot && <> <span className="bottag" title="picks automatically">BOT</span></>}
      {p.dropped && <> <span className="droptag" title="dropped, turns are skipped">DROPPED</span></>}
    </>
  );
}
