import type { OpType } from '../../document';
import { executeExtrude } from './extrude';
import { executeRevolve } from './revolve';
import { executeFillet } from './fillet';
import { executeChamfer } from './chamfer';
import { executeCombine } from './combine';
import { executeCopyBody } from './copyBody';
import { executeMirror } from './mirror';
import { executePattern } from './pattern';
import { executeImport } from './import';
import { executeShell } from './shell';
import type { OpExecutor } from './types';

/**
 * Worker-side executor registry (ARCHITECTURE §7). The regen loop iterates
 * THIS map (R10) and builds each op's ExecCtx (bodies + that op's resolved
 * profiles); registry-completeness.spec.ts asserts parity with the document
 * and app registries (R9).
 */
export const OP_EXECUTORS: Record<OpType, OpExecutor> = {
  // Sketch geometry never reaches the kernel — profiles are resolved on the
  // main thread (R7). The op exists in the timeline for ordering/suppression.
  Sketch: () => undefined,

  Extrude: (ctx, planOp) => {
    if (planOp.op.type === 'Extrude') executeExtrude(ctx, planOp.op);
  },

  Revolve: (ctx, planOp) => {
    if (planOp.op.type === 'Revolve') executeRevolve(ctx, planOp.op, planOp.axisWorld);
  },

  Fillet: (ctx, planOp) => {
    if (planOp.op.type === 'Fillet') executeFillet(ctx, planOp.op);
  },

  Chamfer: (ctx, planOp) => {
    if (planOp.op.type === 'Chamfer') executeChamfer(ctx, planOp.op);
  },

  Combine: (ctx, planOp) => {
    if (planOp.op.type === 'Combine') executeCombine(ctx, planOp.op);
  },

  CopyBody: (ctx, planOp) => {
    if (planOp.op.type === 'CopyBody') executeCopyBody(ctx, planOp.op);
  },

  Mirror: (ctx, planOp) => {
    if (planOp.op.type === 'Mirror') executeMirror(ctx, planOp.op);
  },

  Pattern: (ctx, planOp) => {
    if (planOp.op.type === 'Pattern') executePattern(ctx, planOp.op);
  },

  Import: (ctx, planOp) => {
    if (planOp.op.type === 'Import') executeImport(ctx, planOp.op);
  },

  Shell: (ctx, planOp) => {
    if (planOp.op.type === 'Shell') executeShell(ctx, planOp.op);
  },
};
