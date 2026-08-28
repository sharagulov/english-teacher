import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Запросы к API идут через прокси: в разработке нет разъезда источников,
    // а в продакшене клиент и сервер живут на одном домене.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Роутер и React меняются редко — держим их отдельным чанком,
        // чтобы обновления кода приложения не сбрасывали кеш вендора.
        manualChunks: (id) =>
          /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)
            ? 'react'
            : undefined,
      },
    },
  },
});
