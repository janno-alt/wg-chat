import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Für lokale Entwicklung: /api und /ws an das Backend proxien, damit das Dashboard
// dieselben (relativen, same-origin) Aufrufe nutzt wie in Produktion (cookie-basiert).
const target = process.env.VITE_API_TARGET || 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target, ws: true, changeOrigin: true },
    },
  },
});
