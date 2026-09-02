// Generic card-name autocomplete input (pool names or Scryfall-backed).
import { useRef, useState } from 'react';
import { ManaCost } from './ManaCost';

export interface AcItem { name: string; mana?: string }

interface Props {
  id?: string;
  placeholder?: string;
  value: string;
  onValue: (v: string) => void;
  fetchItems: (q: string) => Promise<AcItem[]> | AcItem[];
  /** Enter pressed with no dropdown selection (submit the raw value). */
  onSubmit?: () => void;
  /** A dropdown suggestion was chosen (after onValue). */
  onSelect?: (name: string) => void;
  minLen?: number;
  debounceMs?: number;
  disabled?: boolean;
}

export function AutocompleteInput({
  id, placeholder, value, onValue, fetchItems, onSubmit, onSelect, minLen = 2, debounceMs = 0, disabled,
}: Props) {
  const [items, setItems] = useState<AcItem[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const hide = () => { setOpen(false); setItems([]); setSel(-1); };

  const refresh = (q: string) => {
    clearTimeout(timer.current);
    if (q.trim().length < minLen) { hide(); return; }
    timer.current = setTimeout(async () => {
      let list: AcItem[] = [];
      try { list = await fetchItems(q.trim()); } catch { list = []; }
      // stale response guard
      if (inputRef.current && inputRef.current.value.trim() !== q.trim()) return;
      setItems(list);
      setSel(-1);
      setOpen(list.length > 0);
    }, debounceMs);
  };

  const pick = (name: string) => {
    onValue(name);
    hide();
    onSelect?.(name);
  };

  return (
    <div className="ac-wrap">
      <input
        ref={inputRef}
        type="text"
        id={id}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={(e) => { onValue(e.target.value); refresh(e.target.value); }}
        onBlur={() => setTimeout(hide, 150)}
        onKeyDown={(e) => {
          if (open && items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); pick(items[sel].name); return; }
            if (e.key === 'Escape') { hide(); return; }
          }
          if (e.key === 'Enter') onSubmit?.();
        }}
      />
      {open && (
        <div className="ac-list">
          {items.map((it, i) => (
            <div
              key={it.name}
              className={'ac-item' + (i === sel ? ' sel' : '')}
              onMouseDown={(e) => { e.preventDefault(); pick(it.name); }}
            >
              <span>{it.name}</span>
              {it.mana ? <span className="mana"><ManaCost cost={it.mana} /></span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
