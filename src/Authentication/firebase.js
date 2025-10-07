// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache  } from "firebase/firestore";


// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API,
  authDomain: "investment-portfolio-tra-8dce1.firebaseapp.com",
  projectId: "investment-portfolio-tra-8dce1",
  storageBucket: "investment-portfolio-tra-8dce1.firebasestorage.app",
  messagingSenderId: "655180529759",
  appId: "1:655180529759:web:96e51aafde0a6db0b1dbea"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firestore with offline cache
const db = initializeFirestore(app, {
  // If you need multi-tab persistence, use:
  // localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  localCache: persistentLocalCache(),
});

export { db };

// If you ever decide to skip persistence, use this instead (but not both):
// import { getFirestore } from "firebase/firestore";
// export const db = getFirestore(app);