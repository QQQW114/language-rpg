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
  build: {
    rollupOptions: {
      output: {
        // 路由级 import() 已经按页面分包（见 src/App.tsx），这里再把跨页面共享的
        // 大依赖拆成稳定的 vendor chunk：它们升级频率远低于业务代码，独立后
        // 业务包更新不会让玩家重新下载整个 React / Markdown 运行时。
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom', 'zustand'],
          'markdown-vendor': ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
});
