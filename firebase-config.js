import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAQU7RcDqBMkZbNf164I2nsiKpBT6sipoY",
  authDomain: "onawadak-lk.firebaseapp.com",
  projectId: "onawadak-lk",
  storageBucket: "onawadak-lk.firebasestorage.app",
  messagingSenderId: "774498985945",
  appId: "1:774498985945:web:e09d842f9f3e0bfb839bc8",
  measurementId: "G-LE328HH3SC"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
