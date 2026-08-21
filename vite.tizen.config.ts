import { defineConfig } from 'vite'
import pkg from './package.json'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// Samsung Tizen build: legacy browser support and a single app bundle.
export default defineConfig({
  // Versao exposta no bundle: a tela de diagnostico (item 59) precisa
  // dizer qual build esta rodando na TV
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TARGET__: JSON.stringify('tizen'),
  },
  plugins: [
    react(),
    legacy({
      targets: ['chrome >= 50', 'safari >= 10'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      renderLegacyChunks: true,
      modernPolyfills: ['es.promise', 'es.array.iterator'],
    }),
  ],
  base: './',
  build: {
    outDir: 'dist-tizen',
    minify: 'terser',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
    terserOptions: {
      compress: {
        drop_console: false,
      },
    },
  },
})
