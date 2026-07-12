import { create } from 'zustand';
import type { BodyId, OpId } from '../../core';
import { KernelClient, type BodyEdges, type MeshTransfer, type OpStatusReport } from '../../kernel';
import { RegenScheduler, type RegenOutcome } from '../../services';
import { commandBus, useDocumentStore } from './documentStore';

/**
 * kernelStore (ARCHITECTURE §5): holds the latest regen result — body meshes
 * for the viewport and per-op statuses for the timeline. The worker + the
 * single RegenScheduler are created lazily on `startRegen()` so importing
 * this module never spins up a Worker (tests, SSR). Writes arrive ONLY from
 * the scheduler's regen fan-out (R1: the kernel is downstream of the write
 * path, never a second source of truth).
 */

interface KernelStore {
  readonly bodies: MeshTransfer[];
  readonly bodyEdges: BodyEdges[];
  readonly statuses: ReadonlyMap<OpId, OpStatusReport>;
  readonly liveBodyIds: readonly BodyId[];
  readonly ready: boolean;
  readonly error: string | null;
  readonly __applyOutcome: (outcome: RegenOutcome) => void;
  readonly __setReady: () => void;
  readonly __setError: (message: string) => void;
}

const EMPTY_STATUSES: ReadonlyMap<OpId, OpStatusReport> = new Map();

export const useKernelStore = create<KernelStore>((set) => ({
  bodies: [],
  bodyEdges: [],
  statuses: EMPTY_STATUSES,
  liveBodyIds: [],
  ready: false,
  error: null,
  __applyOutcome: (outcome) => {
    set({
      bodies: outcome.meshes,
      bodyEdges: outcome.bodyEdges,
      statuses: outcome.statuses,
      liveBodyIds: outcome.liveBodyIds,
    });
  },
  __setReady: () => {
    set({ ready: true });
  },
  __setError: (message) => {
    set({ error: message });
  },
}));

let client: KernelClient | null = null;
let scheduler: RegenScheduler | null = null;
let started = false;

/** Boots the kernel + scheduler exactly once (call from an app mount effect). */
export function startRegen(): void {
  if (started) return;
  started = true;
  client = new KernelClient();
  scheduler = new RegenScheduler(
    client,
    commandBus,
    () => useDocumentStore.getState().document
  );
  scheduler.onRegen((outcome) => {
    useKernelStore.getState().__applyOutcome(outcome);
  });
  scheduler.start().then(
    () => {
      useKernelStore.getState().__setReady();
    },
    (error: unknown) => {
      useKernelStore.getState().__setError(error instanceof Error ? error.message : String(error));
    }
  );
}

/** The live kernel client (STL export, stats) — null until `startRegen()`. */
export function getKernelClient(): KernelClient | null {
  return client;
}
