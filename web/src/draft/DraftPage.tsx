import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Topbar, shareOrCopy } from '../components/Topbar';
import { useCopy, useToast } from '../components/Toasts';
import { useHashTab } from '../hooks/useHashTab';
import { draftView, isFormatDraft } from '../lib/draftLogic';
import { draftCreds, saveWatched } from '../lib/creds';
import { setTabIndicator } from '../lib/tabIndicator';
import { useDraft } from './useDraft';
import { DraftContext, type DraftCtx } from './context';
import { Lobby } from './Lobby';
import { TurnBanner } from './TurnBanner';
import { Pickbar } from './Pickbar';
import { PoolTab } from './PoolTab';
import { FormatSearchTab } from './FormatSearchTab';
import { GridTab } from './GridTab';
import { DecksTab } from './DecksTab';
import { QueueTab } from './QueueTab';
import { AdminPanel } from './AdminPanel';
import { ChatOverlay, ChatFabs } from './ChatOverlay';

const DRAFT_TABS = ['pool', 'grid', 'players', 'queue', 'admin'];

export function DraftPage({ draftId }: { draftId: string }) {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const copy = useCopy();
  const api = useDraft(draftId);
  const [tab, setTab] = useHashTab(DRAFT_TABS, 'pool');
  const [chatOpen, setChatOpen] = useState(false);

  // one-time URL param processing: private-link creds + watcher flag
  const watcher = useMemo(() => params.get('w') === '1', []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = params.get('p'), s = params.get('s');
    if (p && s) api.setCreds(draftCreds.save(draftId, { pid: p, secret: s }));
    if (p || params.get('a')) setParams({ d: draftId }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { draft, notFound, pool, me } = api;

  // watcher bookkeeping
  useEffect(() => {
    if (draft && watcher && !api.creds?.pid) saveWatched(draftId, draft.name);
  }, [draft?.name, watcher]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = draft ? draftView(draft) : null;

  // favicon/title turn indicator
  useEffect(() => {
    if (!draft || !v) return;
    let mode: 'mine' | 'next' | null = null;
    if (draft.status === 'active' && !v.done && me && !draft.archived) {
      if (v.curPid === me) mode = 'mine';
      else {
        const curIdx = v.seq[v.picks.length];
        let j = v.picks.length;
        while (j < v.seq.length && v.seq[j] === curIdx) j++;
        if (j < v.seq.length && v.order[v.seq[j]] === me) mode = 'next';
      }
    }
    setTabIndicator(mode, draft.name);
    return () => { setTabIndicator(null); };
  }, [draft, v?.picks.length, me]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) {
    return (
      <div className="container"><div className="panel empty">
        Draft not found. <br /><br /><a className="btn" href="/">← Home</a>
      </div></div>
    );
  }
  if (!draft) {
    return <div className="loading-screen"><div className="spinner" /><p>Loading…</p></div>;
  }

  const share = {
    title: draft.status === 'lobby' ? 'Share the invite link' : 'Share a watcher link',
    onShare: () => {
      if (draft.status === 'lobby') {
        shareOrCopy(`${location.origin}/?d=${draftId}`, draft.name,
          `Join our rotisserie draft "${draft.name}"`, 'Invite link', copy);
      } else {
        shareOrCopy(`${location.origin}/?d=${draftId}&w=1`, draft.name,
          `Watch our rotisserie draft "${draft.name}" live`, 'Watcher link', copy);
      }
    },
  };
  const bell = me ? {
    on: api.pushOn,
    onToggle: () => api.togglePush()
      .then(() => toast(api.pushOn ? 'Notifications off.' : 'Notifications enabled.'))
      .catch((e) => toast((e as Error).message, true)),
  } : null;

  if (draft.status === 'lobby') {
    return (
      <DraftContext.Provider value={{ draftId, draft, v: v!, pool: pool || [], priv: api.priv, me, amAdmin: api.amAdmin, archived: api.archived, watcher, api }}>
        <Topbar title={draft.name} sub="Lobby — waiting for players" share={share} bell={bell} />
        <Lobby />
      </DraftContext.Provider>
    );
  }

  if (!pool) {
    return <div className="loading-screen"><div className="spinner" /><p>Loading pool…</p></div>;
  }

  const ctx: DraftCtx = {
    draftId, draft, v: v!, pool, priv: api.priv, me,
    amAdmin: api.amAdmin, archived: api.archived, watcher, api,
  };
  const myTurn = !!me && v!.curPid === me;
  const dropped = !!me && !!draft.players[me]?.dropped;

  const tabs: [string, string][] = [
    ['pool', isFormatDraft(draft) ? 'Search' : 'Pool'],
    ['grid', 'Grid'],
    ['players', 'Decks'],
  ];
  if (me) tabs.push(['queue', `Queue${api.priv?.queue?.length ? ` (${api.priv.queue.length})` : ''}`]);
  if (ctx.amAdmin) tabs.push(['admin', 'Admin']);
  const activeTab = tab === 'queue' && !me ? 'pool' : tab;

  return (
    <DraftContext.Provider value={ctx}>
      <Topbar
        title={draft.name}
        sub={ctx.archived ? 'Archived — read only'
          : v!.done ? 'Draft complete' : (watcher && !me ? 'Watching live' : 'Drafting…')}
        share={share}
        bell={bell}
      />
      <div className="container">
        <TurnBanner />
        {!v!.done && me && !ctx.archived && !dropped && <Pickbar myTurn={myTurn} />}
        {dropped && <p className="hint">You were dropped from this draft — your turns are skipped. Ask the admin to bring you back.</p>}
        <div className="tabs">
          {tabs.map(([id, lbl]) => (
            <button key={id} className={'tab-btn' + (activeTab === id ? ' active' : '')} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>
        <div id="tab-content">
          {activeTab === 'pool' && (isFormatDraft(draft) ? <FormatSearchTab /> : <PoolTab />)}
          {activeTab === 'grid' && <GridTab />}
          {activeTab === 'players' && <DecksTab />}
          {activeTab === 'queue' && me && <QueueTab />}
          {activeTab === 'admin' && ctx.amAdmin && <AdminPanel />}
        </div>
      </div>
      {me && (chatOpen
        ? <ChatOverlay onClose={() => setChatOpen(false)} />
        : <ChatFabs onOpenChat={() => setChatOpen(true)} />)}
    </DraftContext.Provider>
  );
}
