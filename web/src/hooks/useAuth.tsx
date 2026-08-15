import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { checkOwner } from '../lib/owner';

interface AuthState {
  /** Raw firebase user (may be anonymous). */
  user: User | null;
  /** The signed-in Google user, if any — anonymous sessions are
   *  invisible plumbing and never count as "signed in" for the UI. */
  realUser: User | null;
  ownerOk: boolean;
  ready: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, realUser: null, ownerOk: false, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, realUser: null, ownerOk: false, ready: false });
  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      const ownerOk = await checkOwner(user);
      setState({
        user,
        realUser: user && !user.isAnonymous ? user : null,
        ownerOk,
        ready: true,
      });
    });
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export async function googleSignIn(): Promise<boolean> {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    return true;
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/popup-closed-by-user') throw e;
    return false;
  }
}

export const googleSignOut = () => signOut(auth);
