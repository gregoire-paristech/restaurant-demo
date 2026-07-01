import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.VERCEL ? '/' : '/restaurant-demo/',
  server: {
    proxy: {
      // Toutes les requêtes /api/* sont proxifiées vers le serveur Express en dev
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
