import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // ARCHITECTURE §14: unit tests are jsdom-free (core, sketch, document, registries).
    // No DOM-dependent component tests in M0 — keep the fixed stack free of a jsdom dep.
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    exclude: ['tests/e2e/**'],
  },
});
