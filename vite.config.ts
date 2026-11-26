/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  server: { port: 5173 },
  build: { sourcemap: false, target: 'es2022' },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
