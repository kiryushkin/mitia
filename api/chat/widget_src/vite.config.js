import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'MityaWidget',
      fileName: (format) => `chat-widget.${format}.js`,
      formats: ['iife']
    },
    outDir: '../static/dist',
    emptyOutDir: true,
    minify: 'terser',
    cssCodeSplit: false,
    terserOptions: {
      compress: {
        drop_console: false,
      },
    },
  },
});
