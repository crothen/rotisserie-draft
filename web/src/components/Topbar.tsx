import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { googleSignIn, googleSignOut, useAuth } from '../hooks/useAuth';
import { useToast } from './Toasts';
import { IconBellOff, IconBellOn, IconShare } from './icons';

export interface TopbarProps {
  title: string;
  sub?: string;
  share?: { title: string; onShare: () => void } | null;
  bell?: { on: boolean; onToggle: () => void } | null;
}

export function Topbar({ title, sub, share, bell }: TopbarProps) {
  const { realUser, ownerOk } = useAuth();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('#user-menu') && !t.closest('#auth-btn')) setMenuOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [menuOpen]);

  const signIn = async () => {
    try {
      if (await googleSignIn()) toast('Signed in.');
    } catch (e) { toast((e as Error).message, true); }
  };
  const signOut = async () => {
    if (!confirm(`Sign out ${realUser?.displayName || realUser?.email}?`)) return;
    await googleSignOut();
    toast('Signed out.');
  };

  return (
    <div className="topbar">
      <Link className="logo" to="/">RD</Link>
      <div className="title">
        {title}
        {sub ? <small>{sub}</small> : null}
      </div>
      {share && (
        <button className="iconbtn" id="share-btn" title={share.title} onClick={share.onShare}>
          <IconShare />
        </button>
      )}
      {bell && (
        <button
          className={'iconbtn' + (bell.on ? ' on' : '')}
          id="bell-btn"
          title={bell.on ? 'Notifications on — click to turn off' : 'Notifications off — click to enable'}
          onClick={bell.onToggle}
        >
          {bell.on ? <IconBellOn /> : <IconBellOff />}
        </button>
      )}
      {realUser ? (
        <>
          <button
            className="iconbtn userbtn"
            id="auth-btn"
            title={`Signed in as ${realUser.displayName || realUser.email}`}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {realUser.photoURL
              ? <img className="avatar" src={realUser.photoURL} alt="" referrerPolicy="no-referrer" />
              : <span className="avatar avatar-letter">{(realUser.displayName || realUser.email || '?')[0].toUpperCase()}</span>}
            <span className="userbtn-name">{(realUser.displayName || realUser.email || '').split(' ')[0]}</span>
          </button>
          {menuOpen && (
            <div className="usermenu" id="user-menu" ref={menuRef}>
              <div className="usermenu-note">{realUser.email || ''}</div>
              <Link className="usermenu-item" to="/dashboard">Dashboard</Link>
              {ownerOk && <Link className="usermenu-item" to="/admin">Site admin</Link>}
              <button className="usermenu-item" onClick={signOut}>Sign out</button>
            </div>
          )}
        </>
      ) : (
        <button className="iconbtn" id="auth-btn" title="Sign in with Google" onClick={signIn}>Sign in</button>
      )}
    </div>
  );
}

/** Native share sheet where available, clipboard copy otherwise. */
export async function shareOrCopy(
  url: string, title: string, text: string, label: string,
  copy: (text: string, label?: string) => void,
) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  copy(url, label);
}
