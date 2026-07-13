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
  readonly __setBodyEdges: (bodyEdges: BodyEdges[]) => void;
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
      statuses: outcome.statuses,
      liveBodyIds: outcome.liveBodyIds,
    });
    // Refresh pickable edges only while a consumer (edge-pick/measure) wants
    // them — otherwise a 100-body regen never pays the edge-tessellation cost.
    if (edgeConsumers > 0) refreshBodyEdges();
  },
  __setReady: () => {
    set({ ready: true });
  },
  __setError: (message) => {
    set({ error: message });
  },
  __setBodyEdges: (bodyEdges) => {
    set({ bodyEdges });
  },
}));

/**
 * Edge-consumer refcount (F4 edge picking, F10 measure). Edges are fetched
 * on demand while at least one consumer is active — never on every regen.
 */
let edgeConsumers = 0;

/** Fetches pickable edges for the live bodies into the store (best-effort). */
export function refreshBodyEdges(): void {
  const activeClient = client;
  if (!activeClient) return;
  const ids = [...useKernelStore.getState().liveBodyIds];
  activeClient.bodyEdges(ids).then(
    (edges) => {
      useKernelStore.getState().__setBodyEdges(edges);
    },
    () => {
      /* transient — the next regen or re-acquire refreshes */
    }
  );
}

/** Marks a consumer as needing edges (fetches immediately). */
export function acquireEdges(): void {
  edgeConsumers += 1;
  refreshBodyEdges();
}

/** Releases a consumer; clears cached edges when the last one leaves. */
export function releaseEdges(): void {
  edgeConsumers = Math.max(0, edgeConsumers - 1);
  if (edgeConsumers === 0) useKernelStore.getState().__setBodyEdges([]);
}

let client: KernelClient | null = null;
let scheduler: RegenScheduler | null = null;
let started = false;

/** Boots the kernel + scheduler exactly once (call from an app mount effect). */
export function startRegen(): void {
  if (started) return;
  started = true;
  client = new KernelClient();
  scheduler = new RegenScheduler(client, commandBus, () => useDocumentStore.getState().document);
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
