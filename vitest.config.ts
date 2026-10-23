import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.next'],
    setupFiles: ['src/tests/setup.ts'],
    testTimeout: 10_000,
  },
});
