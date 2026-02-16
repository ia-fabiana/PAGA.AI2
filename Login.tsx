
import React, { useState } from 'react';
import { auth, isMockMode } from './firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { Wallet, LogIn, Mail, Lock, Loader2, Sparkles, ShieldCheck, AlertCircle } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('fabianajjvsf@gmail.com');
  const [password, setPassword] = useState('Paga@2026');
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');

  const SUPER_ADMIN = 'fabianajjvsf@gmail.com';
  const ADMIN_PASSWORD = 'Paga@2026';

  const handleDemoLogin = () => {
    setLoading(true);
    // Simula um login de admin localmente
    const mockUser = {
      uid: 'super-admin-123',
      email: SUPER_ADMIN,
      displayName: 'Fabiana Admin',
    };
    localStorage.setItem('pagaai_user', JSON.stringify(mockUser));
    setTimeout(() => window.location.reload(), 800);
  };

  const handleClearData = () => {
    if (window.confirm('Deseja realmente limpar todos os dados locais? Isso não pode ser desfeito.')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMockMode) {
      if (email === SUPER_ADMIN) {
        handleDemoLogin();
        return;
      }
      setError('No modo demonstração, use o botão de Acesso Admin.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      if (isRegister) {
        await createUserWithEmailAndPassword(auth, email, password);
        console.log('✅ Conta criada com sucesso!');
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('Email já cadastrado. Tente outro ou faça login.');
      } else if (err.code === 'auth/weak-password') {
        setError('Senha muito fraca. Use no mínimo 6 caracteres.');
      } else if (err.code === 'auth/user-not-found') {
        setError('Usuário não encontrado. Crie uma conta primeiro.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Senha incorreta.');
      } else {
        setError('Falha na autenticação. Verifique os dados.');
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full"></div>
      </div>

      <div className="w-full max-w-md glass p-10 rounded-[2.5rem] shadow-2xl z-10 animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-indigo-600 rounded-3xl text-white shadow-xl shadow-indigo-500/20 mb-6">
            <Wallet size={32} />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">PAGA.AI</h1>
          <p className="text-slate-500 font-medium text-sm mt-2">Gestão Financeira Inteligente</p>
          
          {isMockMode && (
            <div className="mt-4 flex items-center justify-center gap-2 text-xs font-black text-amber-600 bg-amber-50 py-2 px-4 rounded-full border border-amber-100 uppercase tracking-widest mx-auto w-fit">
              <AlertCircle size={12} /> Modo Demonstração (Local)
            </div>
          )}
        </div>

        <form onSubmit={handleAuth} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">E-mail Corporativo</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="email" 
                required
                className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium transition-all"
                placeholder="exemplo@suaempresa.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Sua Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="password" 
                required
                className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium transition-all"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-rose-500 text-xs font-black text-center uppercase tracking-tight">{error}</p>}

          <div className="flex flex-col gap-3">
            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-slate-800 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-slate-900 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : 'Entrar com E-mail'}
            </button>

            {(isMockMode || email === SUPER_ADMIN) && (
              <button 
                type="button"
                onClick={() => {handleDemoLogin(); console.log('Senha padrão: ' + ADMIN_PASSWORD);}}
                className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 border-2 border-indigo-400"
              >
                <ShieldCheck size={20} /> Acesso Rápido Admin
              </button>
            )}
          </div>
        </form>

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
            {isMockMode ? "Dados salvos localmente no seu PC" : "Conectado ao Firebase Cloud"}
          </p>
          {isMockMode && (
            <button
              type="button"
              onClick={handleClearData}
              className="mt-4 text-xs font-bold text-amber-600 hover:text-amber-700 uppercase tracking-widest underline"
            >
              🗑️ Limpar Todos os Dados
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
