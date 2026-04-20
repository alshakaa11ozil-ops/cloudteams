// vite.config.ts
// PURPOSE: Configures the Vite build tool.
// The key addition here is the `resolve.alias` section which maps
// the @ symbol to the src/ directory.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'   // Node.js built-in for file paths

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Now `import X from '@/api/axios'` resolves to `src/api/axios`
      // regardless of where the importing file lives.
      // WHY: Eliminates '../../../' relative imports. Every import is
      // absolute from src/. Much cleaner and refactor-safe.
      '@': path.resolve(__dirname, './src'),
    },
  },
})