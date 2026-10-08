import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
const require = createRequire(import.meta.url)
const classicAssetsPath = require.resolve('./planner-classic-assets.cjs')
// Refresh classic editor, discipline and study assets on config reload.
delete require.cache[classicAssetsPath]
const classicPlannerAssets = require(classicAssetsPath)

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  base: './',
  plugins: [classicPlannerAssets(projectRoot), react()],
  server: {
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        migrationPreview: resolve(projectRoot, 'migration-preview.html'),
        platform: resolve(projectRoot, 'platform.html'),
      },
    },
  },
})
