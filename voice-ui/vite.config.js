import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../public/voice-app'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/main.jsx'),
      output: { entryFileNames: 'voice.js', assetFileNames: 'voice.[ext]', chunkFileNames: 'voice-[name].js' },
    },
  },
});
