// src/Authentication/firebase.js

// --- Core Firebase SDK imports ---
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  // persistentMultipleTabManager, // uncomment if you want multi-tab persistence
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

// --- Firebase config ---
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API,
  authDomain: "investment-portfolio-tra-8dce1.firebaseapp.com",
  projectId: "investment-portfolio-tra-8dce1",
  storageBucket: "investment-portfolio-tra-8dce1.firebasestorage.app",
  messagingSenderId: "655180529759",
  appId: "1:655180529759:web:96e51aafde0a6db0b1dbea",
};

// --- Initialize (safe for hot reload) ---
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// --- Firestore with local cache ---
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
  // For multi-tab persistence, use:
  // localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// --- Auth & Storage ---
export const auth = getAuth(app);
export const storage = getStorage(app);

// --- Export app (optional, if needed elsewhere) ---
export { app };
