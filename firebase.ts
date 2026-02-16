
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAs-SUA-CHAVE-AQUI",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto-id",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

// Verifica se as chaves ainda são as de exemplo
export const isMockMode = firebaseConfig.apiKey.includes("SUA-CHAVE-AQUI");

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
