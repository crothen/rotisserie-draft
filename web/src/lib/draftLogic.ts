// Pure draft logic, mirrored in functions/index.js — keep in sync.
import type { DraftDoc, DraftSettings, Pick, PoolCard } from './types';

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
