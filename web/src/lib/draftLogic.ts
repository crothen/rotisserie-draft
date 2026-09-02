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

/** A row's fallback chain (migrates the old single `alt` shape). */
export function queueRowAlts(item: QueueItem): QueueCard[] {
  if (item.alts) return item.alts;
  return item.ifTaken === 'alt' && item.alt ? [item.alt] : [];
}
/** Whether a row falls through to the next one when every card is gone. */
export function queueRowCont(item: QueueItem): boolean {
  return item.cont ?? item.ifTaken === 'next';
}
/** All cards of a row in try order: first choice, then the fallbacks. */
export function queueRowCards(item: QueueItem): QueueCard[] {
  return [{ c: item.c, n: item.n }, ...queueRowAlts(item)];
}

export interface QueueResolution {
  /** The card auto-pick should take now, or null if it must wait. */
  pick: QueueCard | null;
  /** The row that produced `pick` (its first choice or a fallback). */
  from: QueueItem | null;
  /** The row the walk stopped at because every card in it is gone and
   *  it does not fall through. Null when a pick was found or the queue
   *  ran dry. */
  stalledOn: QueueItem | null;
  /** Rows to remove from the queue after `pick` succeeds: the picked
   *  row plus every exhausted row the walk fell through. */
  consumed: QueueItem[];
}

/**
 * Walks the pick queue and decides what auto-pick does on the owner's
 * turn. Mirrored in functions/index.js — keep in sync.
 *
 * Rows are tried top to bottom. Within a row the first choice and its
 * fallbacks are tried left to right; the first card that is not gone
 * (`tb` on the first choice, or `gone(card)`) is picked. A row with
 * every card gone either falls through to the next row (`cont`) or
 * stops the walk so the player can decide. `skipDead` (bots) falls
 * through every exhausted row regardless.
 */
export function resolveQueue(
  queue: QueueItem[],
  gone: (card: QueueCard) => boolean,
  skipDead = false,
): QueueResolution {
  const passed: QueueItem[] = [];
  for (const item of queue) {
    const cards = queueRowCards(item);
    const avail = cards.find((card, k) => !(k === 0 && item.tb) && !gone(card));
    if (avail) {
      return { pick: { c: avail.c, n: avail.n }, from: item, stalledOn: null, consumed: [...passed, item] };
    }
    if (skipDead || queueRowCont(item)) { passed.push(item); continue; }
    return { pick: null, from: null, stalledOn: item, consumed: [] };
  }
  return { pick: null, from: null, stalledOn: null, consumed: [] };
}

/** Global pick index at which each snake round starts (mirrors the
 *  buildSeq loop, including a possibly short final double round). */
export function roundStarts(n: number, totalPicks: number, singleRounds: number): number[] {
  const starts: number[] = [];
  const count = Array(n).fill(0);
  let g = 0;
  let round = 0;
  while (g < n * totalPicks) {
    starts.push(g);
    const per = round < singleRounds ? 1 : 2;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < per; k++) {
        if (count[i] < totalPicks) { g++; count[i]++; }
      }
    }
    round++;
  }
  return starts;
}
