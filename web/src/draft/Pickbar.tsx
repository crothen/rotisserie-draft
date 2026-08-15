import { useState } from 'react';
import { AutocompleteInput, type AcItem } from '../components/AutocompleteInput';
import { isFormatDraft, pickedNamesSet } from '../lib/draftLogic';
import { scryfallAutocomplete } from '../lib/scryfall';
import { useDraftCtx } from './context';
import { usePickActions } from './usePickActions';

export function Pickbar({ myTurn }: { myTurn: boolean }) {
  const { draft, pool, v } = useDraftCtx();
  const { pickName, queueName } = usePickActions();
  const [value, setValue] = useState('');
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

  const doPick = async () => {
    if (!value.trim()) return;
    await pickName(value.trim());
    setValue('');
  };
  const doQueue = async () => {
    if (!value.trim()) return;
    await queueName(value.trim());
    setValue('');
  };

  return (
    <div className="pickbar"><div className="inner">
      <AutocompleteInput
        id="pick-input"
        placeholder={myTurn ? 'Type a card name to pick…' : 'Type a card name to queue…'}
        value={value}
        onValue={setValue}
        fetchItems={fetchItems}
        debounceMs={format ? 250 : 0}
        onSubmit={() => { if (myTurn) doPick(); }}
      />
      <button className="btn btn-primary" disabled={!myTurn} onClick={doPick}>Pick</button>
      <button className="btn" title="Add to queue" onClick={doQueue}>Queue</button>
    </div></div>
  );
}
