/**
 * Branded ID types (ARCHITECTURE §8). Never use raw `string` for entity
 * identity in signatures — brand it here first.
 */

declare const brand: unique symbol;

export type Brand<T, B> = T & { readonly [brand]: B };

export type OpId = Brand<string, 'OpId'>;
export type BodyId = Brand<string, 'BodyId'>;
export type SketchId = Brand<string, 'SketchId'>;
export type EntityId = Brand<string, 'EntityId'>;
export type PointId = Brand<string, 'PointId'>;
export type ProfileId = Brand<string, 'ProfileId'>;
export type DimensionId = Brand<string, 'DimensionId'>;
/** Construction (datum) plane / axis identity — reusable reference geometry. */
export type DatumId = Brand<string, 'DatumId'>;

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 8;

function randomId(): string {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i += 1) {
    id += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
  }
  return id;
}

/**
 * One factory for all branded ids. Collision-checked against the ids already
 * present in the current document (ARCHITECTURE §8).
 */
export function createId<T extends string>(existingIds: ReadonlySet<string>): Brand<string, T> {
  let id = randomId();
  while (existingIds.has(id)) {
    id = randomId();
  }
  return id as Brand<string, T>;
}
