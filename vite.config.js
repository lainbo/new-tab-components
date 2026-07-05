import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// 多页应用：每新增一个 widget 路由，在 input 中登记其 index.html 即可
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        currency: resolve(import.meta.dirname, 'currency/index.html'),
      },
    },
  },
})
