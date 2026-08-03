// Firebase init for the standalone rotisserie-draft.ch deployment
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js';

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
