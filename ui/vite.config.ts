import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so dist/index.html loads via file:// (Electron launcher)
  // Works equally well when served from http://localhost:7777
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7777',
      '/ws': { target: 'ws://localhost:7777', ws: true },
    },
  },
})
