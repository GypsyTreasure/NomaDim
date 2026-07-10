/**
 * kernel-worker/ — Worker entry point. The ONLY layer permitted to import
 * opencascade.js (ARCHITECTURE §3). This file is the sole import the
 * `kernel/` client is allowed to reach into (kernel-worker-entry-only rule)
 * — solely for `new Worker(new URL('./index.ts', import.meta.url))`
 * instantiation. OCCT bridge, executors/, shape cache land in M1.
 */
export {};
