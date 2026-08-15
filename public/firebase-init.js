// Firebase init for the standalone rotisserie-draft.ch deployment
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js';

export const firebaseConfig = {
  apiKey: "AIzaSyAfWNM8pNdcx0ePx1J4rUj3v0FDPHXNnYY",
  authDomain: "rotisserie-draft-ch.firebaseapp.com",
  projectId: "rotisserie-draft-ch",
  storageBucket: "rotisserie-draft-ch.firebasestorage.app",
  messagingSenderId: "526169606077",
  appId: "1:526169606077:web:bc2815d03022b208b974d4"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Local dev via `firebase emulators:start`: the hosting emulator serves
// on 127.0.0.1/localhost, so point the SDK at the local emulators there.
if (['127.0.0.1', 'localhost'].includes(location.hostname)) {
  connectFirestoreEmulator(db, location.hostname, 8080);
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
}
