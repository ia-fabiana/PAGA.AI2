import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    commit = 'unknown';
  }
  const buildTime = new Date().toISOString();
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api/trinks-proxy': {
          target: 'https://api.trinks.com',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq: any, req: any) => {
              const url = new URL('http://x' + req.url);
              const trinkPath = url.searchParams.get('_path') || '/v1/transacoes';
              url.searchParams.delete('_path');
              const qs = url.searchParams.toString();
              proxyReq.path = trinkPath + (qs ? '?' + qs : '');
              proxyReq.setHeader('X-API-KEY', env.VITE_TRINKS_API_KEY || '');
              proxyReq.setHeader('estabelecimentoId', env.VITE_TRINKS_ESTABLISHMENT_ID || '');
            });
          },
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __BUILD_INFO__: JSON.stringify({ commit, buildTime })
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    optimizeDeps: {
      include: ['pdfjs-dist']
    },
    worker: {
      format: 'es'
    }
  };
});
