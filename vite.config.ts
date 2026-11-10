import { defineConfig } from 'vite';

// Live on GitHub Pages under /setlist-playlist/, locally at the root so the
// redirect URI http://127.0.0.1:5173/ matches exactly.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/setlist-playlist/' : '/',
  build: { rollupOptions: { input: { main: 'index.html', stats: 'stats.html' } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
