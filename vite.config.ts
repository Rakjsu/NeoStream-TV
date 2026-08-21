import { defineConfig } from 'vite'
import pkg from './package.json'
import react from '@vitejs/plugin-react'

// Modern web build used for browser preview/development.
export default defineConfig({
  // Versao exposta no bundle: a tela de diagnostico (item 59) precisa
  // dizer qual build esta rodando na TV
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TARGET__: JSON.stringify('web'),
  },
  plugins: [react()],
  build: {
    minify: 'terser',
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          media: ['hls.js'],
          icons: ['react-icons/fa'],
        },
      },
    },
    terserOptions: {
      compress: {
        drop_console: false,
      },
    },
  },
})
