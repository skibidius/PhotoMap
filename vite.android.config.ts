import { defineConfig } from 'vite';

// Android uses the same browser frontend as the web build. Relative asset
// paths are required because Tauri serves the bundle from the APK.
export default defineConfig({
  root: 'web',
  base: './',
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  build: {
    target: 'es2021',
    outDir: '../dist-android',
    emptyOutDir: true,
    sourcemap: false,
  },
});
