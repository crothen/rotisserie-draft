// Firebase init for the standalone rotisserie-draft.ch deployment.
// The web config (including apiKey) is public by design; access control
// lives in the Firestore rules and the Cloud Functions.
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

export const firebaseConfig = {
  apiKey: 'AIzaSyAfWNM8pNdcx0ePx1J4rUj3v0FDPHXNnYY',
  authDomain: 'rotisserie-draft-ch.firebaseapp.com',
  projectId: 'rotisserie-draft-ch',
  storageBucket: 'rotisserie-draft-ch.firebasestorage.app',
  messagingSenderId: '526169606077',
  appId: '1:526169606077:web:bc2815d03022b208b974d4',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Local dev (`vite dev` or the hosting emulator): point the SDK at the
// local emulators.
if (['127.0.0.1', 'localhost'].includes(location.hostname)) {
  connectFirestoreEmulator(db, location.hostname, 8080);
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
}
