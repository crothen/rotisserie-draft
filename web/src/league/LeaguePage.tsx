import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Topbar, shareOrCopy } from '../components/Topbar';
import { useCopy, useToast } from '../components/Toasts';
import { useHashTab } from '../hooks/useHashTab';
import { useTicker } from '../hooks/useCountdown';
import { cbFormatLabel, cbLeagueTotals, cbRoundPoints, cbSettings, fmtLeft, fmtWhen } from '../lib/cbLogic';
import { leagueCreds } from '../lib/creds';
import { useLeague } from './useLeague';
import { LeagueContext, playerName, useLeagueCtx, type LeagueCtx } from './context';
import { RoundTab } from './RoundTab';
import { StandingsTab } from './StandingsTab';
import { HistoryTab } from './HistoryTab';
import { PlayersTab } from './PlayersTab';
import { AdminTab } from './AdminTab';

const LEAGUE_TABS = ['round', 'standings', 'history', 'players', 'admin'];

export function LeaguePage({ leagueId }: { leagueId: string }) {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const copy = useCopy();
  const api = useLeague(leagueId);
  const [tab, setTab] = useHashTab(LEAGUE_TABS, 'round');
  useTicker(60_000); // countdowns in banner/subtitles

  // private rejoin link params
  useEffect(() => {
    const p = params.get('p'), s = params.get('s');
    if (p && s) api.setCreds(leagueCreds.save(leagueId, { pid: p, secret: s }));
    if (p) setParams({ l: leagueId }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { league, notFound, rounds, me } = api;

  useEffect(() => {
    if (league) document.title = `${league.name} — Card Blind`;
  }, [league?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) {
    return (
      <div className="container"><div className="panel empty">
        League not found. <br /><br /><a className="btn" href="/4cb">← Card Blind</a>
      </div></div>
    );
  }
  if (!league) {
    return <div className="loading-screen"><div className="spinner" /><p>Loading…</p></div>;
  }

  const s = cbSettings(league);
  const n = league.curRound;
  const round = n ? rounds[n] : null;
  const joined = !!me && !!league.players?.[me];

  let sub: string;
  if (league.archived) sub = 'Archived — read only';
  else if (league.status === 'done') sub = 'League complete';
  else if (!n) sub = `${cbFormatLabel(s.format)} · ${s.handSize}-card blind — waiting to start`;
  else if (round?.status === 'submission') sub = `Round ${n}/${s.rounds} — submissions until ${fmtWhen(round.deadline)}`;
  else if (round?.status === 'playing') sub = `Round ${n}/${s.rounds} — matches in progress`;
  else sub = `Round ${n}/${s.rounds}`;

  const tabs: [string, string][] = [
    ['round', 'Round'], ['standings', 'Standings'], ['history', 'History'], ['players', 'Players'],
  ];
  if (api.amAdmin) tabs.push(['admin', 'Admin']);
  const activeTab = tabs.some(([id]) => id === tab) ? tab : 'round';

  const ctx: LeagueCtx = { leagueId, league, rounds, me, amAdmin: api.amAdmin, api };

  return (
    <LeagueContext.Provider value={ctx}>
      <Topbar
        title={league.name || 'Card Blind'}
        sub={sub}
        share={{
          title: 'Share the invite link',
          onShare: () => shareOrCopy(`${location.origin}/4cb?l=${leagueId}`, league.name,
            `Join our Card Blind league "${league.name}"`, 'Invite link', copy),
        }}
        bell={joined ? {
          on: api.pushOn,
          onToggle: () => api.togglePush()
            .then(() => toast(api.pushOn ? 'Notifications off.' : 'Notifications enabled.'))
            .catch((e) => toast((e as Error).message, true)),
        } : null}
      />
      <div className="container">
        <Banner />
        <div className="tabs">
          {tabs.map(([id, lbl]) => (
            <button key={id} className={'tab-btn' + (activeTab === id ? ' active' : '')} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>
        <div id="tab-content">
          {activeTab === 'round' && <RoundTab />}
          {activeTab === 'standings' && <StandingsTab />}
          {activeTab === 'history' && <HistoryTab />}
          {activeTab === 'players' && <PlayersTab />}
          {activeTab === 'admin' && api.amAdmin && <AdminTab />}
        </div>
      </div>
    </LeagueContext.Provider>
  );
}

function Banner() {
  const { league, rounds, me, amAdmin } = useLeagueCtx();
  const s = cbSettings(league);
  const n = league.curRound;
  const round = n ? rounds[n] : null;
  let cls = '', txt: React.ReactNode = '', small: React.ReactNode = null;

  if (league.status === 'done') {
    const totals = cbLeagueTotals(rounds);
    const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    txt = best ? `League complete — ${playerName(league, best[0])} wins with ${best[1]} points!` : 'League complete';
  } else if (round?.status === 'submission') {
    const mine = me && league.players?.[me] && !league.players[me].dropped && !round.submitted?.[me];
    cls = mine ? 'mine' : '';
    txt = mine
      ? `Submit your ${s.handSize}-card deck — ${fmtLeft(round.deadline)} left`
      : `Round ${n}: submissions close ${fmtWhen(round.deadline)}`;
    if (!mine) small = 'Decks stay hidden until the deadline.';
  } else if (round?.status === 'playing') {
    const myOpen = me ? Object.values(round.matches || {})
      .filter((m) => (m.a === me || m.b === me) && !m.result && !m.reports?.[me]).length : 0;
    cls = myOpen ? 'mine' : '';
    txt = myOpen
      ? `Play your matches — ${myOpen} result${myOpen === 1 ? '' : 's'} to report`
      : `Round ${n}: matches in progress`;
  } else if (!n) {
    txt = amAdmin ? 'Start round 1 from the Admin tab' : 'Waiting for the admin to start round 1';
  } else {
    txt = `Round ${n} is complete`;
    const totals = round ? cbRoundPoints(round) : {};
    const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    if (best) small = `${playerName(league, best[0])} won the round with ${best[1]} points.`;
  }

  return (
    <div className={'turn-banner ' + cls}>
      <div className="big">{txt}</div>
      {small && <div className="sub">{small}</div>}
    </div>
  );
}
