import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";

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

const email = process.env.EMAIL || "";
const password = process.env.PASSWORD || "";

if (!email || !password) {
  console.error("Uso: EMAIL=seu@email.com PASSWORD=sua_senha node create-user.js");
  process.exit(1);
}

const run = async () => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log("✅ Usuário criado com sucesso!");
    console.log("📧 Email:", email);
    console.log("👤 UID:", user.uid);
    process.exit(0);
  } catch (error) {
    if (error?.code === "auth/email-already-in-use") {
      try {
        await sendPasswordResetEmail(auth, email);
        console.log("⚠️ Conta já existe. Enviamos email de redefinição de senha.");
        process.exit(0);
      } catch (resetError) {
        console.error("❌ Falha ao enviar redefinição:", resetError?.message || resetError);
        process.exit(1);
      }
    }

    console.error("❌ Erro:", error?.message || error);
    process.exit(1);
  }
};

run();
