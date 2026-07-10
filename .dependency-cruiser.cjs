/**
 * Enforces the layer table in ARCHITECTURE.md §3. This file and that table
 * are ONE artifact — a PR changing either must change both (CLAUDE.md,
 * ARCHITECTURE.md §3 "Rule of maintenance").
 */
module.exports = {
  forbidden: [
    {
      name: 'core-is-leaf',
      comment: 'core/ is a leaf layer: math, ids, units, Result, error taxonomy only.',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/(?!core)' },
    },
    {
      name: 'document-purity',
      comment:
        'document/ may only import core/ — no geometry computation, rendering, workers, or UI state.',
      severity: 'error',
      from: { path: '^src/document' },
      to: { path: '^src/(?!core|document)' },
    },
    {
      name: 'sketch-purity',
      comment:
        'sketch/ is pure 2D geometry/snap/input-machine/profile logic — no React, Three.js, OCCT.',
      severity: 'error',
      from: { path: '^src/sketch' },
      to: { path: '^src/(app|viewport|kernel|kernel-worker|services)' },
    },
    {
      name: 'kernel-client-scope',
      comment:
        'kernel/ is the main-thread worker client — no app/viewport/services/sketch imports.',
      severity: 'error',
      from: { path: '^src/kernel/' },
      to: { path: '^src/(app|viewport|services|sketch)' },
    },
    {
      name: 'kernel-worker-entry-only',
      comment:
        'kernel/ may reach into kernel-worker/ ONLY via the entry file (index.ts), solely for Worker instantiation.',
      severity: 'error',
      from: { path: '^src/kernel/' },
      to: { path: '^src/kernel-worker/(?!index\\.ts)' },
    },
    {
      name: 'viewport-scope',
      comment:
        'viewport/ renders Three.js scenes from mesh buffers and read-only sketch geometry — no document mutation, no OCCT, no business rules.',
      severity: 'error',
      from: { path: '^src/viewport' },
      to: { path: '^src/(app|services|document|kernel-worker)' },
    },
    {
      name: 'services-no-render',
      comment:
        'services/ orchestrates (command bus, regen scheduler, autosave, file io) — no rendering or worker internals.',
      severity: 'error',
      from: { path: '^src/services' },
      to: { path: '^src/(app|viewport|kernel-worker)' },
    },
    {
      name: 'only-worker-occt',
      comment: 'opencascade.js may only be imported from kernel-worker/ (ARCHITECTURE §3, R5-R8).',
      severity: 'error',
      from: { path: '^src/(?!kernel-worker)' },
      to: { path: 'opencascade' },
    },
    {
      name: 'ui-not-in-domain',
      comment: 'Domain/kernel layers stay framework-free — no react/three/zustand imports.',
      severity: 'error',
      from: { path: '^src/(core|document|sketch|kernel|kernel-worker|services)' },
      to: { path: 'react|three|zustand' },
    },
    {
      name: 'no-worker-from-app',
      comment: 'app/ never reaches into kernel-worker/ directly — only through the kernel/ client.',
      severity: 'error',
      from: { path: '^src/app' },
      to: { path: '^src/kernel-worker' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
