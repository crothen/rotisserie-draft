// Scryfall access: card resolution for draft creation, autocomplete,
// format search and the staples catalog.
import { sleep } from './api';
import type { PoolCard } from './types';

interface SearchPage {
  data?: ScryfallCard[];
  has_more?: boolean;
  next_page?: string;
  total_cards?: number;
}

interface ScryfallCard {
  id?: string;
  name: string;
  mana_cost?: string;
  type_line?: string;
  colors?: string[];
  cmc?: number;
  rarity?: string;
  set?: string;
  image_uris?: { normal?: string; small?: string };
  card_faces?: {
    name?: string;
    mana_cost?: string;
    type_line?: string;
    colors?: string[];
    image_uris?: { normal?: string };
  }[];
}

export function extractScryfallCard(card: ScryfallCard): PoolCard {
  return {
    n: card.name,
    img: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null,
    m: card.mana_cost || card.card_faces?.map((f) => f.mana_cost).filter(Boolean).join(' // ') || '',
    t: card.type_line || card.card_faces?.[0]?.type_line || '',
    c: (card.colors?.length ? card.colors : card.card_faces?.flatMap((f) => f.colors || []) || []).join(''),
    v: card.cmc ?? 0,
    r: card.rarity || '',
  };
}

export function parseCubeId(input: string): string | null {
  const m = input.match(/cubecobra\.com\/cube\/[a-z]+\/([\w-]+)/i);
  if (m) return m[1];
  if (/^[\w-]+$/.test(input.trim())) return input.trim();
  return null;
}

export function parseTextList(text: string): string[] {
  const names: string[] = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = line.match(/^(\d+)x?\s+(.+)$/);
    let count = 1, name = line;
    if (m) { count = Math.min(parseInt(m[1], 10), 50); name = m[2].trim(); }
    for (let i = 0; i < count; i++) names.push(name);
  }
  return names;
}

export interface CubeCard { name: string; elo: number; customId: string | null }

/** Resolve oracle data via /cards/collection: by name for every card,
 *  plus by print id for cube entries with an explicitly chosen artwork. */
export async function resolveScryfall(cubeCards: CubeCard[], onStatus: (s: string) => void) {
  const byName: Record<string, PoolCard> = {};
  const byId: Record<string, PoolCard> = {};
  const notFound: string[] = [];
  const idents: ({ name: string } | { id: string })[] = [];
  const seenN = new Set<string>();
  const seenI = new Set<string>();
  for (const cc of cubeCards) {
    const k = cc.name.toLowerCase();
    if (!seenN.has(k)) { seenN.add(k); idents.push({ name: cc.name }); }
    if (cc.customId && !seenI.has(cc.customId)) {
      seenI.add(cc.customId);
      idents.push({ id: cc.customId });
    }
  }
  for (let i = 0; i < idents.length; i += 75) {
    const batch = idents.slice(i, i + 75);
    onStatus(`Fetching card data… ${Math.min(i + 75, idents.length)}/${idents.length}`);
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch }),
    });
    if (!res.ok) throw new Error('Scryfall error ' + res.status);
    const data = await res.json();
    for (const card of (data.data || []) as ScryfallCard[]) {
      const info = extractScryfallCard(card);
      if (card.id) byId[card.id] = info;
      if (!byName[card.name.toLowerCase()]) byName[card.name.toLowerCase()] = info;
      const face = card.card_faces?.[0]?.name?.toLowerCase();
      if (face && !byName[face]) byName[face] = info;
    }
    for (const nf of data.not_found || []) if (nf.name) notFound.push(nf.name);
    await sleep(120);
  }
  return { byName, byId, notFound };
}

/** Oldest paper printing per card name; returns lowercased name -> image URL. */
export async function resolveOldestImages(names: string[], onStatus: (s: string) => void) {
  const need = new Set(names.map((n) => n.toLowerCase()));
  const uniq = [...new Set(names)];
  const map: Record<string, string> = {};
  const BATCH = 16;
  const totalBatches = Math.ceil(uniq.length / BATCH);
  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH);
    onStatus(`Finding oldest printings… ${Math.min(i / BATCH + 1, totalBatches)}/${totalBatches}`);
    const q = '(' + batch.map((n) => `!"${n}"`).join(' or ') + ') not:digital -st:memorabilia';
    let url: string | null =
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=asc`;
    let pages = 0;
    while (url && pages < 6) {
      let data: SearchPage;
      try {
        const res = await fetch(url);
        if (!res.ok) break;
        data = (await res.json()) as SearchPage;
      } catch { break; }
      for (const card of (data.data || []) as ScryfallCard[]) {
        const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal;
        if (!img) continue;
        const keys = [card.name.toLowerCase(), ...(card.card_faces || []).map((f) => f.name?.toLowerCase() || '')];
        for (const k of keys) if (k && need.has(k) && !map[k]) map[k] = img;
      }
      url = data.has_more ? data.next_page ?? null : null;
      pages++;
      await sleep(110);
    }
  }
  return map;
}

/** Fetch every non-basic booster card of the chosen sets, duplicated
 *  per the rarity multipliers. */
export async function buildSetPool(
  sets: { code: string }[],
  mult: Record<string, number>,
  onStatus: (s: string) => void,
): Promise<PoolCard[]> {
  const cards: PoolCard[] = [];
  for (let i = 0; i < sets.length; i++) {
    const code = sets[i].code;
    let url: string | null =
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:${code} -t:basic is:booster`)}&unique=cards&order=set`;
    let page = 0;
    while (url && page < 12) {
      onStatus(`Loading ${code.toUpperCase()} (${i + 1}/${sets.length})… ${cards.length} cards`);
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) break; // set has no matching cards
        throw new Error(`Scryfall error ${res.status} for set ${code}`);
      }
      const data = (await res.json()) as SearchPage;
      for (const card of data.data || []) {
        const copies = mult[card.rarity || ''] ?? 1;
        if (!copies) continue;
        const info: PoolCard = { ...extractScryfallCard(card), e: 0, s: card.set };
        for (let k = 0; k < copies; k++) cards.push(info);
      }
      url = data.has_more ? data.next_page ?? null : null;
      page++;
      await sleep(110);
    }
  }
  return cards;
}

/** Card-name autocomplete (format drafts, league submissions). */
export async function scryfallAutocomplete(q: string): Promise<string[]> {
  const res = await fetch('https://api.scryfall.com/cards/autocomplete?q=' + encodeURIComponent(q));
  const data = await res.json();
  return data.data || [];
}

/** Format-scoped search; passes the user's query through so full
 *  Scryfall syntax works. Returns null total on error. */
export async function formatSearch(format: string, q: string): Promise<{ cards: PoolCard[]; total: number }> {
  const full = `format:${format} -t:basic ${q}`;
  const res = await fetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(full)}&unique=cards&order=edhrec`);
  if (res.status === 404) return { cards: [], total: 0 };
  if (!res.ok) throw new Error('Scryfall error ' + res.status);
  const data = await res.json();
  const cards = ((data.data || []) as ScryfallCard[]).map(extractScryfallCard);
  return { cards, total: data.total_cards ?? cards.length };
}

export async function fetchStaples(format: string): Promise<PoolCard[]> {
  const res = await fetch(`/api/rd/staples?format=${encodeURIComponent(format)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load staples');
  return data.cards || [];
}
