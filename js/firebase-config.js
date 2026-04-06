import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBZoy3U28mBcGpG58kSPa-djyDbSeBZ4Hg",
  authDomain: "varillas-8421d.firebaseapp.com",
  projectId: "varillas-8421d",
  storageBucket: "varillas-8421d.firebasestorage.app",
  messagingSenderId: "1008238915036",
  appId: "1:1008238915036:web:f9ef6de0c6230579def319"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
