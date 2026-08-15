// Card Blind league logic, mirrored in functions/index.js — keep in sync.
import type { CbSettingsT, GameResult, LeagueDoc, RoundDoc } from './types';

export const CB_FORMATS: [string, string][] = [
  ['legacy', 'Legacy'], ['vintage', 'Vintage'], ['modern', 'Modern'],
  ['premodern', 'Premodern'], ['pioneer', 'Pioneer'],
  ['standard', 'Standard'], ['pauper', 'Pauper'],
];
export const cbFormatLabel = (f: string | undefined) =>
  CB_FORMATS.find(([k]) => k === f)?.[1] || f || '?';

export function cbSettings(l: LeagueDoc): CbSettingsT {
  const s = l.settings || {};
  return {
    handSize: s.handSize || 4,
    highlander: s.highlander !== false,
    format: s.format || 'modern',
    rounds: s.rounds || 3,
    maxPlayers: s.maxPlayers || 16,
  };
}

/** Points for a two-game result seen from one player's perspective.
 *  WW 6 · WD 4 · WL 2 · DD 2 · DL 1 · LL 0 */
export function cbMatchPoints(res: GameResult[]): number {
  const w = res.filter((g) => g === 'W').length;
  const d = res.filter((g) => g === 'D').length;
  if (w === 2) return 6;
  if (w === 1) return d ? 4 : 2;
  return d === 2 ? 2 : d === 1 ? 1 : 0;
}

export const cbMirror = (res: GameResult[]): GameResult[] =>
  res.map((g) => (g === 'W' ? 'L' : g === 'L' ? 'W' : 'D'));

export function cbRoundPoints(r: RoundDoc): Record<string, number> {
  const pts: Record<string, number> = {};
  for (const m of Object.values(r.matches || {})) {
    for (const [pid, p] of Object.entries(m.pts || {})) pts[pid] = (pts[pid] || 0) + p;
  }
  return pts;
}

export function cbLeagueTotals(rounds: Record<number, RoundDoc>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of Object.values(rounds)) {
    for (const [pid, v] of Object.entries(cbRoundPoints(r))) totals[pid] = (totals[pid] || 0) + v;
  }
  return totals;
}

export function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtLeft(ms: number): string {
  const d = ms - Date.now();
  if (d <= 0) return 'now';
  const h = Math.floor(d / 3600e3);
  const m = Math.floor((d % 3600e3) / 60e3);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
