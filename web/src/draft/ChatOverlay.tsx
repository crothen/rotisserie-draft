// Players-only chat: floating overlay with [[Card Name]] references and
// a `/` card-name autocomplete inside the input.
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toasts';
import { useCardHover } from '../components/CardTip';
import { ManaCost } from '../components/ManaCost';
import { chatSeenKey } from '../lib/creds';
import { IconChat, IconDeck } from '../components/icons';
import { useDraftCtx } from './context';
import { useCardModals } from './CardModals';
import { sendChatMsg } from './actions';

export function ChatFabs({ onOpenChat }: { onOpenChat: () => void }) {
  const { chat } = useDraftCtx().api;
  const { v, me } = useDraftCtx();
  const { openMyDeckModal } = useCardModals();
  const seen = +(localStorage.getItem(chatSeenKey(useDraftCtx().draftId)) || 0);
  const unread = chat.filter((m) => m.at > seen && m.pid !== me).length;
  return (
    <div className="fab-stack">
      <button className="fab fab-alt" title="Chat" onClick={onOpenChat}>
        <IconChat />{unread > 0 && <span className="fab-count">{unread}</span>}
      </button>
      <button className="fab" title="Your deck" onClick={openMyDeckModal}>
        <IconDeck /><span className="fab-count">{v.picks.filter((p) => p.p === me && !p.skip).length}</span>
      </button>
    </div>
  );
}

/** [[Card Name]] tokens render as highlighted references into the pool. */
function ChatText({ text }: { text: string }) {
  const { pool } = useDraftCtx();
  const { openCardModal } = useCardModals();
  const hover = useCardHover();
  const parts = text.split(/(\[\[[^[\]]{1,80}\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[\[([^[\]]+)\]\]$/);
        if (!m) return <span key={i}>{part}</span>;
        const id = pool.findIndex((c) => c && c.n.toLowerCase() === m[1].toLowerCase());
        return id >= 0
          ? <span key={i} className="cardref" onClick={() => openCardModal(id)} {...hover(pool[id].img)}>{pool[id].n}</span>
          : <span key={i} className="cardref">{m[1]}</span>;
      })}
    </>
  );
}

export function ChatOverlay({ onClose }: { onClose: () => void }) {
  const ctx = useDraftCtx();
  const { draftId, draft, pool, me, archived, api } = ctx;
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [acItems, setAcItems] = useState<{ n: string; m: string }[]>([]);
  const [acSel, setAcSel] = useState(-1);
  const tokStart = useRef(-1);
  const chat = api.chat;

  // mark read + keep scrolled to the bottom
  useEffect(() => {
    localStorage.setItem(chatSeenKey(draftId), String(Date.now()));
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [draftId, chat.length]);

  const fmt = (at: number) => {
    const d = new Date(at || 0);
    const today = new Date().toDateString() === d.toDateString();
    return (today ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ') +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const hideAc = () => { setAcItems([]); setAcSel(-1); tokStart.current = -1; };

  const updateAc = (value: string, caret: number) => {
    setText(value);
    const upto = value.slice(0, caret);
    const m = upto.match(/(?:^|\s)\/([^/]{2,50})$/);
    if (!m) { hideAc(); return; }
    const q = m[1].toLowerCase();
    tokStart.current = caret - m[1].length - 1;
    const seen = new Set<string>();
    const cands: { n: string; m: string }[] = [];
    for (const c of pool) {
      if (!c) continue;
      const k = c.n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      cands.push({ n: c.n, m: c.m });
    }
    const starts = cands.filter((c) => c.n.toLowerCase().startsWith(q));
    const contains = cands.filter((c) => !c.n.toLowerCase().startsWith(q) && c.n.toLowerCase().includes(q));
    const items = [...starts, ...contains].slice(0, 8);
    setAcItems(items);
    setAcSel(-1);
  };

  const pickAcName = (name: string) => {
    const input = inputRef.current;
    if (!input || tokStart.current < 0) return;
    const caret = input.selectionStart ?? text.length;
    const next = text.slice(0, tokStart.current) + `[[${name}]] ` + text.slice(caret);
    const pos = tokStart.current + name.length + 5;
    setText(next);
    hideAc();
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const t = text.trim();
    if (!t || !me) return;
    if (t.length > 500) { toast('Keep messages under 500 characters.', true); return; }
    setText('');
    hideAc();
    try {
      await sendChatMsg(draftId, me, draft.players?.[me]?.name || '?', t);
    } catch (e) { toast('Sending failed: ' + (e as Error).message, true); }
  };

  return (
    <div className="chat-overlay">
      <div className="chat-ov-head"><span>Chat</span><button className="btn btn-sm" onClick={onClose}>✕</button></div>
      <div className="chat-list" id="chat-list" ref={listRef}>
        {chat.length ? chat.map((m) => (
          <div key={m.id || m.at} className={'chat-msg' + (m.pid === me ? ' mine' : '')}>
            <div className="chat-head"><span className="who">{m.name}</span><span className="when">{fmt(m.at)}</span></div>
            <div className="txt"><ChatText text={m.text} /></div>
          </div>
        )) : <p className="hint">No messages yet. Say hello! Type / to reference a card.</p>}
      </div>
      {archived ? (
        <p className="hint">This draft is archived — the chat is read only.</p>
      ) : (
        <div className="chat-form">
          <div className="ac-wrap">
            <input
              ref={inputRef}
              type="text" maxLength={500} placeholder="Message… ( / for a card )" autoComplete="off"
              value={text}
              onChange={(e) => updateAc(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onBlur={() => setTimeout(hideAc, 150)}
              onKeyDown={(e) => {
                if (acItems.length) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setAcSel((s) => (s + 1) % acItems.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setAcSel((s) => (s - 1 + acItems.length) % acItems.length); return; }
                  if (e.key === 'Enter') { e.preventDefault(); pickAcName(acItems[acSel >= 0 ? acSel : 0].n); return; }
                  if (e.key === 'Escape') { hideAc(); return; }
                  return;
                }
                if (e.key === 'Enter') send();
              }}
            />
            {acItems.length > 0 && (
              <div className="ac-list chat-ac">
                {acItems.map((c, i) => (
                  <div key={c.n} className={'ac-item' + (i === acSel ? ' sel' : '')}
                    onMouseDown={(e) => { e.preventDefault(); pickAcName(c.n); }}>
                    <span>{c.n}</span><span className="mana"><ManaCost cost={c.m} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={send}>Send</button>
        </div>
      )}
    </div>
  );
}
