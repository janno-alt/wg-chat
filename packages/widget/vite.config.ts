import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Baut das Widget als EINE selbstständige IIFE-Datei (dist/w.js), die auf
 * beliebigen Seiten via <script src=".../w.js" data-tenant="KEY"> eingebunden wird.
 * CSS wird per JS in den Shadow DOM injiziert (styles.ts) – keine separate CSS-Datei.
 */
export default defineConfig({
  plugins: [preact()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: 'src/main.tsx',
      name: 'KineChat',
      formats: ['iife'],
      fileName: () => 'w.js',
    },
    outDir: 'dist',
    cssCodeSplit: false,
    emptyOutDir: true,
    target: 'es2019',
  },
});
