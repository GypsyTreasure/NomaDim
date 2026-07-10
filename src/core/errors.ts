/**
 * Error taxonomy (ARCHITECTURE §12). No silent catches — every catch site
 * either narrows to one of these or is a genuine invariant breach
 * (InternalError). UI behavior per class is documented in ARCHITECTURE §12,
 * implemented by the layers that own each class (kept out of core/).
 */

export class ValidationError extends Error {
  override readonly name = 'ValidationError';
  constructor(
    message: string,
    readonly field?: string
  ) {
    super(message);
  }
}

export class KernelError extends Error {
  override readonly name = 'KernelError';
  constructor(
    message: string,
    readonly code: string,
    readonly opId?: string
  ) {
    super(message);
  }
}

export class ProfileError extends Error {
  override readonly name = 'ProfileError';
  constructor(
    message: string,
    readonly entityIds: readonly string[]
  ) {
    super(message);
  }
}

export class ImportError extends Error {
  override readonly name = 'ImportError';
  constructor(
    message: string,
    readonly line?: number,
    readonly detail?: string
  ) {
    super(message);
  }
}

export class InternalError extends Error {
  override readonly name = 'InternalError';
  constructor(
    message: string,
    readonly stateDump?: unknown
  ) {
    super(message);
  }
}

export type DomainError =
  ValidationError | KernelError | ProfileError | ImportError | InternalError;
