import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Contact } from './pages/Contact';
import { Dashboard } from './pages/Dashboard';
import { NewDraft } from './pages/NewDraft';
import { SiteAdmin } from './pages/SiteAdmin';
import { CbHome } from './pages/CbHome';
import { CbRules } from './pages/CbRules';
import { DraftPage } from './draft/DraftPage';
import { LeaguePage } from './league/LeaguePage';

/** "/" serves the landing page, or the draft app when ?d= is present. */
function HomeSwitch() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // legacy hash links (#app, #contact) from old shared URLs
  useEffect(() => {
    if (location.hash === '#app') navigate('/dashboard', { replace: true });
    if (location.hash === '#contact') navigate('/contact', { replace: true });
  }, [navigate]);
  const draftId = params.get('d');
  if (draftId) return <DraftPage draftId={draftId} />;
  return <Landing />;
}

/** "/4cb" serves the Card Blind home, or a league when ?l= is present. */
function CbSwitch() {
  const [params] = useSearchParams();
  const leagueId = params.get('l');
  if (leagueId) return <LeaguePage leagueId={leagueId} />;
  return <CbHome />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeSwitch />} />
      <Route path="/new" element={<NewDraft />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/admin" element={<SiteAdmin />} />
      <Route path="/4cb" element={<CbSwitch />} />
      <Route path="/4cb/rules" element={<CbRules />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
