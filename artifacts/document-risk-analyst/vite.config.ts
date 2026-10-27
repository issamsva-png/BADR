import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rawPort = process.env.VITE_PORT || process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  envDir: path.resolve(import.meta.dirname, '..', '..'),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: process.env.DEMO_MODE_LOCAL === 'true' ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.API_PORT || '5000'}`,
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: process.env.DEMO_MODE_LOCAL === 'true' ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: true,
  },
});
