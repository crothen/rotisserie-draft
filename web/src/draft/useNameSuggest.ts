// Card-name suggestions for autocomplete inputs: unpicked pool names
// in classic drafts, Scryfall autocomplete minus picked names in format
// drafts. Shared by the pickbar and the queue's fallback picker.
import type { AcItem } from '../components/AutocompleteInput';
import { isFormatDraft, pickedNamesSet } from '../lib/draftLogic';
import { scryfallAutocomplete } from '../lib/scryfall';
import { useDraftCtx } from './context';

export function useNameSuggest() {
  const { draft, pool, v } = useDraftCtx();
  const format = isFormatDraft(draft);

  const fetchItems = (q: string): AcItem[] | Promise<AcItem[]> => {
    if (format) {
      const picked = pickedNamesSet(draft);
      return scryfallAutocomplete(q).then((names) =>
        names.filter((n) => !picked.has(n.toLowerCase())).slice(0, 10).map((n) => ({ name: n })));
    }
    const lower = q.toLowerCase();
    const seen = new Set<string>();
    const cands: AcItem[] = [];
    pool.forEach((c, i) => {
      if (!c || v.pickedIds.has(i)) return;
      const key = c.n.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      cands.push({ name: c.n, mana: c.m });
    });
    const starts = cands.filter((c) => c.name.toLowerCase().startsWith(lower));
    const contains = cands.filter((c) => !c.name.toLowerCase().startsWith(lower) && c.name.toLowerCase().includes(lower));
    return [...starts, ...contains].slice(0, 10);
  };

  return { fetchItems, debounceMs: format ? 250 : 0 };
}
