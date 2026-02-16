import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAKNh4nU9TWC0NkV_WjpBlAu8SiPe_O988",
  authDomain: "pagaai-c5222.firebaseapp.com",
  projectId: "pagaai-c5222",
  storageBucket: "pagaai-c5222.firebasestorage.app",
  messagingSenderId: "467825360385",
  appId: "1:467825360385:web:79a4c647f2f5f617ef4a00",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const email = "fabianajjvsf@gmail.com";
const password = "Paga@2026";

createUserWithEmailAndPassword(auth, email, password)
  .then((userCredential) => {
    const user = userCredential.user;
    console.log("✅ Usuário criado com sucesso!");
    console.log("📧 Email:", email);
    console.log("🔐 Senha:", password);
    console.log("👤 UID:", user.uid);
    process.exit(0);
  })
  .catch((error) => {
    if (error.code === "auth/email-already-in-use") {
      console.log("⚠️ Conta já existe! Use a senha: Paga@2026");
    } else {
      console.error("❌ Erro:", error.message);
    }
    process.exit(1);
  });
