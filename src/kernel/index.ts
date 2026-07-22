/**
 * kernel/ — main-thread kernel client: worker lifecycle, request/response
 * correlation, cancellation, mesh buffer cache. Defines `protocol.ts` (the
 * only main<->worker contract). May import `core` and `document` (op types).
 */
export {
  KernelClient,
  StaleRegenError,
  type RegenResult,
  type StlExportRequest,
  type StlExportResult,
} from './KernelClient';
export type {
  MeshQuality,
  MeshTransfer,
  MeshStat,
  KernelErrorPayload,
  OpStatusReport,
  OpRunStatus,
  PlanePlacement,
  PlanProfile,
  PlanOp,
  RegenPlan,
  WorldAxis,
  BodyEdges,
  EdgeTessellation,
  FacePlaneResult,
  FaceFingerprint,
} from './protocol';
export type { EdgeFingerprint } from '../document';
export { edgeFingerprintKey } from './edgeKey';
