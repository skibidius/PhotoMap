import { defineConfig } from 'vite';

// Separate entry for the GitHub Pages build. The app reuses the modules in
// `src/` and lives under `web/`; the desktop build keeps using vite.config.ts.
export default defineConfig(({ command, isPreview }) => ({
  root: 'web',
  // Project pages are served from https://<user>.github.io/PhotoMap/.
  // `vite preview` serves the already-built assets, so it needs the same base.
  base: command === 'build' || isPreview ? '/PhotoMap/' : '/',
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  server: {
    port: 5174,
    strictPort: true,
    // Allow the web entry to import from ../src.
    fs: { allow: ['..'] },
  },
  build: {
    target: 'es2021',
    outDir: '../dist-web',
    emptyOutDir: true,
    sourcemap: false,
  },
}));
