import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { input: 'src/main/index.ts' } } },
  // sandbox: true richiede un preload CommonJS
  preload: {
    build: { rollupOptions: { input: 'src/preload/index.ts', output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      react(),
      // in sviluppo Vite inietta uno script inline (React Refresh) e usa un websocket per l'HMR
      {
        name: 'dev-csp',
        apply: 'serve',
        transformIndexHtml: (html) =>
          html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace('connect-src', 'connect-src ws://localhost:* http://localhost:*')
      }
    ],
    build: { rollupOptions: { input: 'src/renderer/index.html' } }
  }
})
