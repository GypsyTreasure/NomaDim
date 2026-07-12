import type { BodyId, OpId } from '../core';
import { findSketch, opDefinition, type DocumentState } from '../document';
import type { KernelClient, BodyEdges } from '../kernel';
import { StaleRegenError, type MeshTransfer, type OpStatusReport } from '../kernel';
import type { CommandBus } from './CommandBus';
import { buildRegenPlan } from './regenPlan';

/**
 * RegenScheduler (ARCHITECTURE §4, §9): the ONLY trigger of the kernel.
 * Subscribes to the CommandBus, diffs successive documents to find the
 * lowest dirty op, builds a RegenPlan for the active prefix, and drives the
 * worker with a monotonically increasing generation so rapid edits cancel
 * superseded runs (R6). Regen outcomes fan out to app listeners (bodies +
 * per-op statuses) — this layer never touches React or the store directly.
 */

export interface RegenOutcome {
  /** Per-op run status, keyed by OpId (F1 chip colours). */
  readonly statuses: ReadonlyMap<OpId, OpStatusReport>;
  /** Viewport-quality meshes of every live body (R5 Transferables). */
  readonly meshes: MeshTransfer[];
  /** Per-body pickable edge polylines + fingerprints (F4). */
  readonly bodyEdges: BodyEdges[];
  readonly liveBodyIds: readonly BodyId[];
}

export type RegenListener = (outcome: RegenOutcome) => void;

/**
 * Lowest op index whose evaluation could differ between two documents:
 * the first op whose object reference changed, the first op whose consumed
 * sketch changed, or — when the rollback marker moved — the lower marker.
 */
export function computeFromIndex(prev: DocumentState, next: DocumentState): number {
  const maxLen = Math.max(prev.ops.length, next.ops.length);
  let dirty = maxLen;
  for (let i = 0; i < maxLen; i += 1) {
    const a = prev.ops[i];
    const b = next.ops[i];
    if (a !== b) {
      dirty = i;
      break;
    }
    if (b) {
      const consumes = opDefinition(b).dependencies(b).consumesSketch;
      if (consumes !== null && findSketch(prev, consumes) !== findSketch(next, consumes)) {
        dirty = i;
        break;
      }
    }
  }
  if (prev.rollbackIndex !== next.rollbackIndex) {
    dirty = Math.min(dirty, prev.rollbackIndex, next.rollbackIndex);
  }
  return dirty;
}

export class RegenScheduler {
  private generation = 0;
  private prevDoc: DocumentState;
  private readonly listeners = new Set<RegenListener>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly client: KernelClient,
    private readonly bus: CommandBus,
    private readonly getDocument: () => DocumentState
  ) {
    this.prevDoc = getDocument();
  }

  /** Boots the worker, runs an initial full regen, then tracks every edit. */
  async start(): Promise<void> {
    await this.client.init();
    const initial = this.getDocument();
    this.prevDoc = initial;
    await this.runRegen(initial, 0);
    this.unsubscribe = this.bus.onChange((state) => {
      void this.onChange(state);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  onRegen(listener: RegenListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async onChange(state: DocumentState): Promise<void> {
    const fromIndex = computeFromIndex(this.prevDoc, state);
    this.prevDoc = state;
    await this.runRegen(state, fromIndex);
  }

  private async runRegen(doc: DocumentState, fromIndex: number): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    const plan = buildRegenPlan(doc);
    try {
      const result = await this.client.regen(generation, fromIndex, plan);
      // A newer generation was dispatched while this ran — drop stale meshes.
      if (generation < this.generation) return;
      const statuses = new Map(result.statuses.map((s) => [s.opId, s]));
      for (const listener of this.listeners) {
        listener({
          statuses,
          meshes: result.meshes,
          bodyEdges: result.bodyEdges,
          liveBodyIds: result.liveBodyIds,
        });
      }
    } catch (error) {
      if (error instanceof StaleRegenError) return; // superseded (benign, R6)
      throw error;
    }
  }
}
