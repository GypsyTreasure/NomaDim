/**
 * services/ — orchestration: command bus, regeneration scheduler, dirty
 * tracking, autosave, file import/export flows. May import `core`,
 * `document`, `sketch`, `kernel` (ARCHITECTURE §3). RegenScheduler and
 * autosave arrive in M3/M6.
 */
export { CommandBus, type DocumentHost } from './CommandBus';
export {
  RegenScheduler,
  computeFromIndex,
  type RegenListener,
  type RegenOutcome,
} from './RegenScheduler';
export { buildRegenPlan, placementForPlane, OP_PLAN_RESOLVERS } from './regenPlan';
