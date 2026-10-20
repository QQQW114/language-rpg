import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // GitHub Pages 项目页部署在 /<仓库名>/ 子路径下，构建时用 PAGES_BASE 指定；
  // 本地开发与普通构建保持根路径不受影响。
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
