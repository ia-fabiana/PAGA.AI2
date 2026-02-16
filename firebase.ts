
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Configuração do Firebase
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
};

// Verifica se as chaves ainda são as de exemplo ou estão vazias
export const isMockMode = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("SUA-CHAVE-AQUI");

console.log("PAGA.AI - Firebase Config:", {
  apiKey: firebaseConfig.apiKey ? `${firebaseConfig.apiKey.slice(0, 10)}...` : "VAZIO",
  projectId: firebaseConfig.projectId,
  isMockMode,
});

let auth: any;
let db: any;

if (isMockMode) {
  console.warn("PAGA.AI: Rodando em modo de demonstração (LocalStorage).");
  
  // Mock robusto para o Auth
  auth = {
    currentUser: null,
    onAuthStateChanged: (callback: any) => {
      const savedUser = localStorage.getItem('pagaai_user');
      const user = savedUser ? JSON.parse(savedUser) : null;
      
      // Simula o comportamento assíncrono do Firebase
      const timer = setTimeout(() => {
        callback(user);
      }, 100);

      return () => clearTimeout(timer);
    },
    signOut: async () => {
      localStorage.removeItem('pagaai_user');
      window.location.reload();
    }
  };
  
  // Mock para o Firestore
  db = {
    collection: () => ({
      doc: () => ({
        set: async () => {},
        get: async () => ({ exists: () => false, data: () => ({}) }),
        onSnapshot: (cb: any) => { cb({ docs: [] }); return () => {}; }
      })
    })
  }; 
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    console.error("Erro ao inicializar Firebase real. Revertendo para Mock.");
    auth = { onAuthStateChanged: (cb: any) => { cb(null); return () => {}; }, signOut: () => {} };
    db = {};
  }
}

export { auth, db };
