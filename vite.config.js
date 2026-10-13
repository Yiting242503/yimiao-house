import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', target: 'es2022' },
  server: {
    port: 5173,
    strictPort: false,
    watch: { ignored: ['**/.wrangler/**', '**/.sites-runtime/**', '**/test-results/**'] },
    proxy: { '/api': 'http://127.0.0.1:8787' }
  }
});
