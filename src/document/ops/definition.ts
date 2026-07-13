import type { Result, ValidationError, ImportError } from '../../core';
import type { XmlElement } from '../xml/xmlWriter';
import type { Raw } from '../xml/xmlRaw';
import type { DocumentState } from '../model';
import type { OpDependencies, OpType, TimelineOp } from './types';

/**
 * Per-op document definition (ARCHITECTURE §7): param validation, XML
 * codec, and dependency semantics — one entry per OpType in
 * `document/ops/registry.ts`. Timeline UI, XML codec, and dirty tracking
 * iterate the registry and contain zero per-op switches (R10).
 */
export interface OpDefinition<T extends TimelineOp = TimelineOp> {
  readonly type: OpType;
  /** i18n key for chip/dialog labels (`t()` resolved in app/). */
  readonly labelKey: string;
  /** Element tag `toXml` emits — lets the timeline codec map tag → type (R10). */
  readonly xmlTag: string;
  validate(op: T, doc: DocumentState): Result<void, ValidationError>;
  toXml(op: T): XmlElement;
  fromXml(raw: Raw): Result<T, ImportError>;
  dependencies(op: T): OpDependencies;
}
