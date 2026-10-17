import { defineConfig } from 'vite';

// Tauri expects a fixed dev port and a plain `dist` folder.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'es2021',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
