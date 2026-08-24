/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Core is pure, so it needs no environment at all. A DOM is added in Phase 4, scoped to the
    // component tests that actually need one.
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // Thresholds apply to core and adapter only — the layers with no I/O to mock (ADR-0005).
      include: ['src/core/**/*.ts', 'src/adapter/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
