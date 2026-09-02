// Pure draft logic, mirrored in functions/index.js — keep in sync.
import type { DraftDoc, DraftSettings, Pick, PoolCard, QueueCard, QueueItem } from './types';

/** Snake order: 1..N, N..1, … After `singleRounds` rounds each turn
 *  takes 2 cards, until every player holds `totalPicks` cards. */
export function buildSeq(n: number, totalPicks: number, singleRounds: number): number[] {
  const seq: number[] = [];
  const count = Array(n).fill(0);
  let round = 0;
  while (seq.length < n * totalPicks) {
    const per = round < singleRounds ? 1 : 2;
    const idxs = [...Array(n).keys()];
    if (round % 2 === 1) idxs.reverse();
    for (const i of idxs) {
      for (let k = 0; k < per; k++) {
        if (count[i] < totalPicks) { seq.push(i); count[i]++; }
      }
    }
    round++;
  }
  return seq;
}

export function settingsOf(d: DraftDoc): DraftSettings {
  const s = d.settings || {};
  return {
    players: s.players || 8,
    totalPicks: s.totalPicks || 40,
    singleRounds: s.singleRounds ?? 20,
    reminderHours: s.reminderHours ?? 24,
  };
}

export interface DraftView {
  s: DraftSettings;
  order: string[];
  seq: number[];
  picks: Pick[];
  done: boolean;
  curPid: string | null;
  pickedIds: Set<number>;
}

export function draftView(d: DraftDoc): DraftView {
  const s = settingsOf(d);
  const order = d.order || [];
  const seq = order.length ? buildSeq(order.length, s.totalPicks, s.singleRounds) : [];
  const picks = d.picks || [];
  const done = seq.length > 0 && picks.length >= seq.length;
  const curPid = !done && seq.length ? order[seq[picks.length]] : null;
  const pickedIds = new Set(picks.map((p) => p.c));
  return { s, order, seq, picks, done, curPid, pickedIds };
}

export const isFormatDraft = (d: DraftDoc | null) => d?.source === 'format';

/** Format drafts: derive the picked-cards-only pool from the pick log. */
export function derivedFormatPool(d: DraftDoc): PoolCard[] {
  const pool: PoolCard[] = [];
  for (const p of d.picks || []) {
    if (p.skip || !p.card) continue;
    pool[p.c] = { ...p.card, n: p.n };
  }
  return pool;
}

export function pickedNamesSet(d: DraftDoc | null): Set<string> {
  return new Set((d?.picks || []).filter((p) => !p.skip).map((p) => p.n.toLowerCase()));
}

// ---------- pick queue resolution ----------

/** Builds the "is this card already gone?" predicate for a draft:
 *  classic drafts match by pool index, format drafts by name. */
export function queueGonePredicate(d: DraftDoc): (card: QueueCard) => boolean {
  if (isFormatDraft(d)) {
    const names = pickedNamesSet(d);
    return (card) => names.has((card.n || '').toLowerCase());
  }
  const ids = draftView(d).pickedIds;
  return (card) => card.c != null && ids.has(card.c);
}

export interface QueueResolution {
  /** The card auto-pick should take now, or null if it must wait. */
  pick: QueueCard | null;
  /** The queue entry that produced `pick` — the entry itself, or the
   *  entry whose `alt` fired. Null when nothing is picked. */
  from: QueueItem | null;
  /** The gone entry the walk stopped at, when the draft should wait
   *  for the player (its `ifTaken` was 'stop', or its fallback was
   *  gone too). Null when a pick was found or the queue ran dry. */
  stalledOn: QueueItem | null;
  /** Entries to remove from the queue after `pick` succeeds: the
   *  picked entry plus every gone entry the walk passed over. */
  consumed: QueueItem[];
}

/**
 * Walks the pick queue as a decision tree and decides what auto-pick
 * does on the owner's turn. Mirrored in functions/index.js — keep in
 * sync.
 *
 * Each entry says what to do if its card is already gone (`tb` set,
 * or `gone(card)` true):
 *   - 'stop' / unset → stop here; the draft waits (`stalledOn`)
 *   - 'next'         → skip it and look at the next entry
 *   - 'alt'          → take `entry.alt` instead, if that is not gone
 *
 * `skipDead` is what bots use: every gone entry is skipped regardless
 * of its `ifTaken`, since nobody is waiting to decide for a bot.
 *
 * Rules: 'next' chains through any number of consecutive gone entries;
 * a fallback that is itself gone (or missing) stalls on its parent;
 * every gone entry passed over is consumed along with the pick so it
 * does not linger as a struck-through row.
 */
export function resolveQueue(
  queue: QueueItem[],
  gone: (card: QueueCard) => boolean,
  skipDead = false,
): QueueResolution {
  const passed: QueueItem[] = [];
  for (const item of queue) {
    if (!item.tb && !gone(item)) {
      return { pick: { c: item.c, n: item.n }, from: item, stalledOn: null, consumed: [...passed, item] };
    }
    if (skipDead || item.ifTaken === 'next') { passed.push(item); continue; }
    if (item.ifTaken === 'alt' && item.alt && !gone(item.alt)) {
      return { pick: { c: item.alt.c, n: item.alt.n }, from: item, stalledOn: null, consumed: [...passed, item] };
    }
    return { pick: null, from: null, stalledOn: item, consumed: [] };
  }
  return { pick: null, from: null, stalledOn: null, consumed: [] };
}
