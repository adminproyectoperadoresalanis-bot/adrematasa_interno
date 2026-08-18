// Configuración del proyecto Firebase — AppAdrematasaInterno
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDrF0PX-S5EfPcb3JWBYXaRpbcV08Dc6KM",
  authDomain: "appadrematasainterno.firebaseapp.com",
  projectId: "appadrematasainterno",
  storageBucket: "appadrematasainterno.firebasestorage.app",
  messagingSenderId: "734586339164",
  appId: "1:734586339164:web:d7bfd9fe7aa922323e4b99"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
