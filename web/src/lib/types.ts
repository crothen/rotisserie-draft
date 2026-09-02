// Firestore document shapes. These mirror what the Cloud Functions in
// functions/index.js read and write — keep them in sync.

// ---------- cards ----------

/** Slim card record stored in pools, picks and staples (Scryfall-derived). */
export interface PoolCard {
  n: string;            // name
  img: string | null;   // normal-size image URL
  m: string;            // mana cost "{2}{W}{U}"
  t: string;            // type line
  c: string;            // colors as "WUBRG" subset string
  v: number;            // mana value
  r?: string;           // rarity
  e?: number;           // rating (CubeCobra elo / staples rank score)
  s?: string;           // set code (set-based drafts)
  o?: string;           // oracle text (faces joined with " // "); absent in older pools
}

// ---------- rotisserie drafts ----------

export interface DraftSettings {
  players: number;
  totalPicks: number;
  singleRounds: number;
  reminderHours: number;
}

export interface PlayerInfo {
  name: string;
  uid: string | null;
  joinedAt: number;
  bot?: boolean;
  dropped?: boolean;
}

export interface Pick {
  p: string;            // pid
  c: number;            // pool index (derived index in format drafts, -1 for skips)
  n: string;            // card name
  at: number;
  auto?: boolean;
  skip?: boolean;
  card?: PoolCard;      // format drafts: picks carry their card data
}

export type DraftStatus = 'lobby' | 'active' | 'done';
export type DraftSource = 'cube' | 'sets' | 'list' | 'format';

export interface DraftDoc {
  name: string;
  cubeUrl: string;
  createdAt: number;
  adminUid: string;
  status: DraftStatus;
  source?: DraftSource;
  format?: string;                       // format drafts
  sets?: { code: string; name: string }[];
  rarityCopies?: { common: number; uncommon: number; rare: number; mythic: number };
  settings: Partial<DraftSettings>;
  players: Record<string, PlayerInfo>;
  uids: Record<string, string>;          // auth uid -> pid
  order: string[];
  picks: Pick[];
  turnStartedAt: number | null;
  lastReminderAt: number | null;
  archived?: boolean;
  startedAt?: number;
  finishedAt?: number;
}

/** A card reference inside the queue (pool index, or name only in
 *  format drafts). */
export interface QueueCard {
  c: number | null;     // pool index; null in format drafts
  n: string;
}

/** One queue row: a first choice plus a chain of fallbacks tried left
 *  to right on the owner's turn. If every card in the row is gone the
 *  draft waits for the player, unless `cont` says to fall through to
 *  the next row. */
export interface QueueItem extends QueueCard {
  tb?: string;          // "taken by <player name>" — sniped marker (first choice)
  alts?: QueueCard[];   // fallback chain
  cont?: boolean;       // all gone → continue with the next row (default: wait)
  /** @deprecated pre-chain shape, migrated on read by queueRowAlts/queueRowCont */
  ifTaken?: 'stop' | 'next' | 'alt';
  /** @deprecated see ifTaken */
  alt?: QueueCard;
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Per-seat private doc (drafts and leagues share the shape). */
export interface PrivDoc {
  secret?: string;
  queue?: QueueItem[];
  sideboard?: number[];
  pushSubs?: PushSub[];
  uid?: string | null;
  uids?: Record<string, boolean>;
  bot?: boolean;
  sub?: CbSub;          // leagues: the blind submission
}

export interface ChatMsg {
  id?: string;
  pid: string;
  name: string;
  text: string;
  at: number;
}

// ---------- Card Blind leagues ----------

export interface CbSettingsT {
  handSize: number;
  highlander: boolean;
  format: string;
  rounds: number;
  maxPlayers: number;
}

export type LeagueStatus = 'lobby' | 'active' | 'done';

export interface LeagueDoc {
  name: string;
  createdAt: number;
  adminUid: string;
  archived: boolean;
  status: LeagueStatus;
  curRound: number;                      // 1-based, 0 = none yet
  customBans: string[];
  settings: Partial<CbSettingsT>;
  players: Record<string, PlayerInfo>;
  uids: Record<string, string>;
}

export interface CbCard {
  n: string;
  img: string | null;
  t?: string;
}

export interface CbSub {
  round: number;
  cards: CbCard[];
  at: number;
}

export type GameResult = 'W' | 'D' | 'L';

export interface Match {
  a: string;
  b: string;
  reports: Record<string, GameResult[]>; // canonical: from a's perspective
  result: GameResult[] | null;
  pts: Record<string, number>;
  disputed: boolean;
  resolvedBy?: 'agree' | 'admin';
}

export type RoundStatus = 'submission' | 'playing' | 'done';

export interface RoundDoc {
  n: number;
  status: RoundStatus;
  deadline: number;
  bans: string[];
  submitted: Record<string, boolean>;
  decks: Record<string, CbCard[]>;
  matches: Record<string, Match>;
  createdAt?: number;
  revealedAt?: number;
  finishedAt?: number;
  remindedAt?: number | null;
}

export interface MatchChatMsg {
  pid: string;          // pid or 'admin'
  name: string;
  text: string;
  at: number;
}

export interface MatchChatDoc {
  round: number;
  a: string;
  b: string;
  msgs: MatchChatMsg[];
}

// ---------- rd-users membership mirror ----------

export interface MembershipEntry {
  name: string;
  role: 'admin' | 'player';
  at: number;
}

export interface UserDoc {
  drafts?: Record<string, MembershipEntry>;
  leagues?: Record<string, MembershipEntry>;
}
