// Scryfall-style search over stored pool cards — the subset the pool
// actually carries:
//   bare words      name or type line contains the word
//   o: / oracle:    oracle text        o:flying  o:"draw a card"
//   t: / type:      type line          t:goblin
//   c: / color:     colors             c:u  c:ur  c=u  c<=wu  c:m  c:c  c:azorius
//   cmc: / mv:      mana value         cmc:2  mv>=4  cmc<3
//   r: / rarity:    rarity             r:rare  r:m  r>=rare
//   m: / mana:      mana cost          m:{u}{u}  m:uu
//   s: / set: / e:  set code           s:blb
// Prefix a term with - to negate it. Terms are AND-ed.
import type { PoolCard } from './types';

type Op = ':' | '=' | '!=' | '<' | '<=' | '>' | '>=';
export interface QueryTerm { neg: boolean; key: string; op: Op; value: string }

const TOKEN = /(-)?(?:([a-z]+)(!=|<=|>=|:|=|<|>))?(?:"([^"]*)"|(\S+))/gi;

const KEYS: Record<string, string> = {
  name: 'name', n: 'name',
  o: 'o', oracle: 'o', text: 'o',
  t: 't', type: 't',
  c: 'c', color: 'c', colour: 'c',
  cmc: 'cmc', mv: 'cmc', manavalue: 'cmc',
  r: 'r', rarity: 'r',
  m: 'm', mana: 'm',
  s: 's', set: 's', e: 's', edition: 's',
};

const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 4 };
const RARITY_ALIAS: Record<string, string> = { c: 'common', u: 'uncommon', r: 'rare', m: 'mythic', s: 'special', b: 'bonus' };

const COLOR_WORDS: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C', multicolor: 'M', multi: 'M',
  azorius: 'WU', dimir: 'UB', rakdos: 'BR', gruul: 'RG', selesnya: 'WG',
  orzhov: 'WB', izzet: 'UR', golgari: 'BG', boros: 'WR', simic: 'UG',
  bant: 'WUG', esper: 'WUB', grixis: 'UBR', jund: 'BRG', naya: 'WRG',
  abzan: 'WBG', jeskai: 'WUR', sultai: 'UBG', mardu: 'WBR', temur: 'URG',
};

export function parseQuery(q: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  for (const m of q.matchAll(TOKEN)) {
    const value = (m[4] ?? m[5] ?? '').toLowerCase();
    const rawKey = (m[2] || '').toLowerCase();
    if (!value) continue;
    // unknown keys fall back to a name search of the whole token
    const key = rawKey ? KEYS[rawKey] : 'name';
    if (rawKey && !key) {
      terms.push({ neg: !!m[1], key: 'name', op: ':', value: `${rawKey}${m[3]}${value}` });
      continue;
    }
    terms.push({ neg: !!m[1], key, op: (m[3] as Op) || ':', value });
  }
  return terms;
}

export function matchesQuery(c: PoolCard, terms: QueryTerm[]): boolean {
  for (const t of terms) {
    if (matchTerm(c, t) === t.neg) return false;
  }
  return true;
}

function cmp(op: Op, a: number, b: number): boolean {
  switch (op) {
    case ':': case '=': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
  }
}

function matchTerm(c: PoolCard, t: QueryTerm): boolean {
  const { op, value } = t;
  switch (t.key) {
    case 'name':
      return c.n.toLowerCase().includes(value) || (c.t || '').toLowerCase().includes(value);
    case 'o':
      return (c.o || '').toLowerCase().includes(value);
    case 't':
      return (c.t || '').toLowerCase().includes(value);
    case 's':
      return (c.s || '').toLowerCase() === value;
    case 'm': {
      const norm = (s: string) => s.toLowerCase().replace(/[{}\s]/g, '');
      return norm(c.m || '').includes(norm(value));
    }
    case 'cmc': {
      const n = Number(value);
      return !Number.isNaN(n) && cmp(op, c.v ?? 0, n);
    }
    case 'r': {
      const want = RARITY_ALIAS[value] || value;
      const have = (c.r || '').toLowerCase();
      if (op === ':' || op === '=') return have === want;
      if (op === '!=') return have !== want;
      if (!(want in RARITY_RANK) || !(have in RARITY_RANK)) return false;
      return cmp(op, RARITY_RANK[have], RARITY_RANK[want]);
    }
    case 'c':
      return matchColor(c, op, value);
  }
  return true;
}

/** Scryfall color semantics: `c:` and `c>=` mean "has at least these
 *  colors", `c=` exact, `c<=` "only these colors" (colorless counts),
 *  `c:m` multicolor, `c:c` colorless (lands included). */
function matchColor(c: PoolCard, op: Op, value: string): boolean {
  const have = new Set((c.c || '').split('').filter(Boolean));
  const word = COLOR_WORDS[value] ?? value.toUpperCase();
  if (word === 'M') return op === '!=' ? have.size <= 1 : have.size > 1;
  if (word === 'C') return op === '!=' ? have.size > 0 : have.size === 0;
  const want = new Set(word.split('').filter((ch) => 'WUBRG'.includes(ch)));
  if (!want.size) return false;
  const sub = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
  const eq = sub(want, have) && sub(have, want);
  switch (op) {
    case ':': case '>=': return sub(want, have);
    case '=': return eq;
    case '!=': return !eq;
    case '<=': return sub(have, want);
    case '<': return sub(have, want) && !eq;
    case '>': return sub(want, have) && !eq;
  }
}
