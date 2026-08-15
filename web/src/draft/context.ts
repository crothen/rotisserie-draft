import { createContext, useContext } from 'react';
import type { DraftView } from '../lib/draftLogic';
import type { DraftDoc, PoolCard, PrivDoc } from '../lib/types';
import type { DraftApi } from './useDraft';

export interface DraftCtx {
  draftId: string;
  draft: DraftDoc;
  v: DraftView;
  pool: PoolCard[];
  priv: PrivDoc | null;
  me: string | null;
  amAdmin: boolean;
  archived: boolean;
  watcher: boolean;
  api: DraftApi;
}

export const DraftContext = createContext<DraftCtx | null>(null);
export const useDraftCtx = (): DraftCtx => {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('DraftContext missing');
  return ctx;
};
