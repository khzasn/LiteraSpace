import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

export default defineConfig({
  // Sesuaikan base dengan nama repo GitHub Pages
  base: '/pembaca-nyaman/',

  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Pembaca Nyaman',
        short_name: 'Pembaca',
        description: 'Baca ebook PDF dengan tampilan nyaman seperti buku fisik',
        theme_color: '#faf7f0',
        background_color: '#faf7f0',
        display: 'standalone',
        lang: 'id',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // pdfjs worker jangan di-cache SW karena besar
        navigateFallback: 'index.html',
      },
    }),
  ],

  worker: {
    format: 'es',
  },

  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },

  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) {
            return 'pdfjs';
          }
        },
      },
    },
  },

  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    alias: {
      // Arahkan pdfjs-dist ke legacy build di Node test environment
      'pdfjs-dist': resolve(
        fileURLToPath(new URL('.', import.meta.url)),
        'node_modules/pdfjs-dist/legacy/build/pdf.mjs'
      ),
    },
  },
}); 
