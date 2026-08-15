import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { rid } from '../lib/api';
import { Topbar } from '../components/Topbar';
import { googleSignIn, useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toasts';
import { CB_FORMATS } from '../lib/cbLogic';
import { draftCreds } from '../lib/creds';
import { recordDraftMembership } from '../lib/membership';
import { writePool } from '../lib/pool';
import {
  buildSetPool, parseCubeId, parseTextList, resolveOldestImages, resolveScryfall,
  type CubeCard,
} from '../lib/scryfall';

type Source = 'cube' | 'sets' | 'list' | 'format';

interface SetInfo { code: string; name: string; released?: string; count?: number }

export function NewDraft() {
  const { realUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('cube');
  const [cube, setCube] = useState('');
  const [listText, setListText] = useState('');
  const [format, setFormat] = useState('modern');
  const [players, setPlayers] = useState(8);
  const [totalPicks, setTotalPicks] = useState(40);
  const [singleRounds, setSingleRounds] = useState(20);
  const [reminderHours, setReminderHours] = useState(24);
  const [oldest, setOldest] = useState(false);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);

  // set picker
  const [catalog, setCatalog] = useState<SetInfo[] | null>(null);
  const [chosenSets, setChosenSets] = useState<SetInfo[]>([]);
  const [setSearch, setSetSearch] = useState('');
  const [rc, setRc] = useState(3);
  const [ru, setRu] = useState(2);
  const [rr, setRr] = useState(1);
  const [rm, setRm] = useState(1);

  useEffect(() => { document.title = 'New draft — Rotisserie Draft'; }, []);

  useEffect(() => {
    if (source !== 'sets' || catalog) return;
    (async () => {
      try {
        const res = await fetch('/api/rd/sets');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load sets');
        setCatalog(data.sets || []);
      } catch (e) { toast((e as Error).message, true); setCatalog([]); }
    })();
  }, [source, catalog, toast]);

  const setMatches = (catalog || [])
    .filter((s) => !chosenSets.some((c) => c.code === s.code))
    .filter((s) => {
      const q = setSearch.trim().toLowerCase();
      return !q || s.name.toLowerCase().includes(q) || s.code.includes(q);
    })
    .slice(0, setSearch.trim() ? 40 : 25);

  const setEstimate = () => {
    if (!chosenSets.length) return null;
    const raw = chosenSets.reduce((n, s) => n + (s.count || 0), 0);
    // rough set composition: ~35% common, ~35% uncommon, ~22% rare, ~8% mythic
    const est = Math.round(raw * (0.35 * rc + 0.35 * ru + 0.22 * rr + 0.08 * rm) * 0.8);
    return `${chosenSets.length} set(s), roughly ${est} cards in the pool ` +
      `(about ${raw} printings listed; basic lands, variants and non-booster cards are excluded).`;
  };

  const create = async () => {
    if (!realUser) { toast('Please sign in to create a draft.', true); return; }
    const draftName = name.trim() || 'Rotisserie Draft';
    const p = Math.max(2, Math.min(16, players || 8));
    const tp = Math.max(4, totalPicks || 40);
    const sr = Math.max(0, Math.min(tp, singleRounds || 0));
    const rh = Math.max(0, reminderHours || 0);
    setCreating(true);
    try {
      const base = {
        name: draftName, createdAt: Date.now(),
        adminUid: realUser.uid,
        status: 'lobby',
        settings: { players: p, totalPicks: tp, singleRounds: sr, reminderHours: rh },
        players: {}, uids: {}, order: [], picks: [],
        turnStartedAt: null, lastReminderAt: null,
      };
      const finish = async (draftId: string) => {
        draftCreds.save(draftId, { draftName });
        await recordDraftMembership(realUser.uid, draftId, draftName, 'admin');
        navigate(`/?d=${draftId}`);
      };

      if (source === 'format') {
        setStatus('Creating draft…');
        const draftId = rid(12);
        await setDoc(doc(db, 'rd-drafts', draftId), {
          ...base, cubeUrl: '', source: 'format', format,
        });
        await finish(draftId);
        return;
      }

      if (source === 'sets') {
        if (!chosenSets.length) throw new Error('Pick at least one set.');
        const mult: Record<string, number> = {
          common: Math.max(0, rc), uncommon: Math.max(0, ru),
          rare: Math.max(0, rr), mythic: Math.max(0, rm),
          special: 1, bonus: 1,
        };
        const setPool = await buildSetPool(chosenSets, mult, setStatus);
        const need = p * tp;
        if (setPool.length < need) {
          throw new Error(`The chosen sets give ${setPool.length} cards but ${p} players × ${tp} picks needs ${need}. Add a set or raise the rarity copies.`);
        }
        setStatus('Creating draft…');
        const draftId = rid(12);
        await setDoc(doc(db, 'rd-drafts', draftId), {
          ...base, cubeUrl: '', source: 'sets',
          sets: chosenSets.map((s) => ({ code: s.code, name: s.name })),
          rarityCopies: { common: rc, uncommon: ru, rare: rr, mythic: rm },
        });
        await writePool(draftId, setPool);
        await finish(draftId);
        return;
      }

      let cubeCards: CubeCard[];
      let cubeUrl = '';
      if (source === 'list') {
        cubeCards = parseTextList(listText).map((n) => ({ name: n, elo: 0, customId: null }));
        if (!cubeCards.length) throw new Error('Card list is empty.');
      } else {
        const cubeId = parseCubeId(cube);
        if (!cubeId) throw new Error('Enter a CubeCobra link, or switch the card pool to Sets or Card list.');
        cubeUrl = `https://cubecobra.com/cube/list/${cubeId}`;
        setStatus('Fetching cube from CubeCobra…');
        const res = await fetch(`/api/rd/fetchCube?cube=${encodeURIComponent(cubeId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch cube');
        cubeCards = (data.cards as (string | { name: string; elo?: number; customId?: string })[]).map((c) =>
          typeof c === 'string'
            ? { name: c, elo: 0, customId: null }
            : { name: c.name, elo: c.elo || 0, customId: c.customId || null });
      }
      const need = p * tp;
      if (cubeCards.length < need) {
        throw new Error(`Pool has ${cubeCards.length} cards but ${p} players × ${tp} picks needs ${need}. Reduce players/picks or use a bigger cube.`);
      }
      const { byName, byId, notFound } = await resolveScryfall(cubeCards, setStatus);
      const oldestMap = oldest
        ? await resolveOldestImages(
          [...new Set(cubeCards.filter((c) => !c.customId).map((c) => c.name))], setStatus)
        : {};
      const pool = cubeCards.map(({ name: n, elo, customId }) => {
        const custom = customId ? byId[customId] : null;
        const cardBase = custom || byName[n.toLowerCase()] ||
          { n, img: null, m: '', t: '', c: '', v: 0, r: '' };
        const img = custom ? cardBase.img : (oldestMap[n.toLowerCase()] || cardBase.img);
        return { ...cardBase, img, e: elo };
      });
      if (notFound.length) {
        toast(`${notFound.length} card(s) not found on Scryfall (kept without image): ${notFound.slice(0, 3).join(', ')}…`, true);
      }
      setStatus('Creating draft…');
      const draftId = rid(12);
      await setDoc(doc(db, 'rd-drafts', draftId), { ...base, cubeUrl });
      await writePool(draftId, pool);
      await finish(draftId);
    } catch (e) {
      setStatus('');
      toast((e as Error).message, true);
      setCreating(false);
    }
  };

  const signIn = async () => {
    try { await googleSignIn(); } catch (e) { toast((e as Error).message, true); }
  };

  return (
    <>
      <Topbar title="Rotisserie Draft" sub="New draft" />
      <div className="container">
        <div className="panel" style={{ borderBottom: 'none' }}>
          <h1>New Rotisserie Draft</h1>
          <p className="hint">Everyone sees the whole pool and drafts one card at a time, snake order
            (1→8, 8→1, …). After a while players pick 2 cards per turn.</p>
          <div className="field"><label>Draft name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Legacy Cube Rotisserie 2026" /></div>
          <div className="field"><label>Card pool</label>
            <div className="viewtoggle">
              {([['cube', 'CubeCobra'], ['sets', 'Sets'], ['list', 'Card list'], ['format', 'Format']] as [Source, string][]).map(([s, lbl]) => (
                <button key={s} className={'mini-chip' + (source === s ? ' active' : '')} onClick={() => setSource(s)}>{lbl}</button>
              ))}
            </div>
          </div>

          {source === 'cube' && (
            <div className="field">
              <label>CubeCobra link or cube id</label>
              <input type="text" value={cube} onChange={(e) => setCube(e.target.value)}
                placeholder="https://cubecobra.com/cube/list/cr_cu_cube" />
            </div>
          )}

          {source === 'list' && (
            <div className="field">
              <label>Card list (one per line, "2 Card Name" for copies)</label>
              <textarea value={listText} onChange={(e) => setListText(e.target.value)}
                placeholder={'1 Lightning Bolt\n2 Squadron Hawk\nBrainstorm'} />
            </div>
          )}

          {source === 'format' && (
            <div className="field">
              <label>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                {CB_FORMATS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
              <p className="hint">The pool is <b>every card legal in the format</b> — nothing is stored
                up front. Players browse the format's top staples and search all legal cards via
                Scryfall; each card can be drafted once (basic lands excluded — add those when
                building your deck). Picks are validated for legality on the server.</p>
            </div>
          )}

          {source === 'sets' && (
            <>
              <div className="field"><label>Sets in the pool</label>
                <div className="setchips">
                  {chosenSets.length
                    ? chosenSets.map((s) => (
                      <span key={s.code} className="chip active">{s.name}
                        <button className="chipx" title="Remove"
                          onClick={() => setChosenSets(chosenSets.filter((x) => x.code !== s.code))}>✕</button>
                      </span>
                    ))
                    : <span className="hint">No sets selected yet.</span>}
                </div>
                <input type="text" value={setSearch} onChange={(e) => setSetSearch(e.target.value)}
                  placeholder="Search sets by name or code…" autoComplete="off" />
                <div className="setlist">
                  {catalog === null
                    ? <p className="hint">Loading sets…</p>
                    : setMatches.length
                      ? setMatches.map((s) => (
                        <button key={s.code} className="setrow"
                          onClick={() => setChosenSets([...chosenSets, s])}>
                          <span className="setcode">{s.code.toUpperCase()}</span>
                          <span className="setname">{s.name}</span>
                          <span className="setmeta">{(s.released || '').slice(0, 4)} · {s.count} cards</span>
                        </button>
                      ))
                      : <p className="hint">No matching sets.</p>}
                </div>
              </div>
              <div className="field"><label>Copies of each card by rarity</label>
                <div className="row">
                  <div className="field"><label>Common</label>
                    <input type="number" min={0} max={10} value={rc} onChange={(e) => setRc(+e.target.value)} /></div>
                  <div className="field"><label>Uncommon</label>
                    <input type="number" min={0} max={10} value={ru} onChange={(e) => setRu(+e.target.value)} /></div>
                  <div className="field"><label>Rare</label>
                    <input type="number" min={0} max={10} value={rr} onChange={(e) => setRr(+e.target.value)} /></div>
                  <div className="field"><label>Mythic</label>
                    <input type="number" min={0} max={10} value={rm} onChange={(e) => setRm(+e.target.value)} /></div>
                </div>
                <p className="hint">{setEstimate() || 'Basic lands are excluded. The pool size updates as you pick sets.'}</p>
              </div>
            </>
          )}

          <div className="row">
            <div className="field"><label>Players</label>
              <input type="number" min={2} max={16} value={players} onChange={(e) => setPlayers(+e.target.value)} /></div>
            <div className="field"><label>Cards per player</label>
              <input type="number" min={4} max={100} value={totalPicks} onChange={(e) => setTotalPicks(+e.target.value)} /></div>
            <div className="field"><label>Single-pick rounds</label>
              <input type="number" min={0} max={100} value={singleRounds} onChange={(e) => setSingleRounds(+e.target.value)} /></div>
            <div className="field"><label>Reminder after (h)</label>
              <input type="number" min={0} max={168} value={reminderHours} onChange={(e) => setReminderHours(+e.target.value)} /></div>
          </div>
          <p className="hint">Single-pick rounds: how many rounds are 1 card per turn before switching
            to 2 cards per turn. Reminder 0 = off.</p>
          {(source === 'cube' || source === 'list') && (
            <div className="field">
              <label className="checkline" style={{ textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={oldest} onChange={(e) => setOldest(e.target.checked)} />
                {' '}Use each card's oldest printing for images
              </label>
              <p className="hint">Looks up the first paper printing of every card on Scryfall — creating
                the draft takes noticeably longer. Off = default printing (artwork pinned in the cube
                is always respected either way).</p>
            </div>
          )}
          {realUser
            ? <button className="btn btn-primary btn-block" onClick={create} disabled={creating}>Create draft</button>
            : <>
              <p className="hint">Creating a draft requires an account, so you can manage it later from any device.</p>
              <button className="btn btn-primary btn-block" onClick={signIn}>Sign in with Google to create</button>
            </>}
          <p className="hint">{status}</p>
          <p className="hint" style={{ marginTop: 14 }}><Link to="/dashboard">Back to the dashboard</Link></p>
        </div>
      </div>
    </>
  );
}
