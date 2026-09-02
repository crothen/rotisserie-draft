import { useState } from 'react';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { useNameSuggest } from './useNameSuggest';
import { usePickActions } from './usePickActions';

export function Pickbar({ myTurn }: { myTurn: boolean }) {
  const { pickName, queueName } = usePickActions();
  const { fetchItems, debounceMs } = useNameSuggest();
  const [value, setValue] = useState('');

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
        debounceMs={debounceMs}
        onSubmit={() => { if (myTurn) doPick(); }}
      />
      <button className="btn btn-primary" disabled={!myTurn} onClick={doPick}>Pick</button>
      <button className="btn" title="Add to queue" onClick={doQueue}>Queue</button>
    </div></div>
  );
}
