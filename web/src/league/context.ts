import { createContext, useContext } from 'react';
import type { LeagueDoc, RoundDoc } from '../lib/types';
import type { LeagueApi } from './useLeague';

export interface LeagueCtx {
  leagueId: string;
  league: LeagueDoc;
  rounds: Record<number, RoundDoc>;
  me: string | null;
  amAdmin: boolean;
  api: LeagueApi;
}

export const LeagueContext = createContext<LeagueCtx | null>(null);
export const useLeagueCtx = (): LeagueCtx => {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error('LeagueContext missing');
  return ctx;
};

export const playerName = (l: LeagueDoc, pid: string) => l.players?.[pid]?.name || '?';
