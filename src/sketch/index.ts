/**
 * sketch/ — 2D geometry evaluation (entity → curves), snap engine, guide
 * inference, numeric-input state machine, profile detection. Pure logic:
 * may import `core` and `document` (types only); no React, Three.js, OCCT,
 * or DOM (ARCHITECTURE §3, R11).
 */
export * from './entities/curves';
export * from './entities/queries';
export * from './entities/topology';
export * from './snap/types';
export * from './snap/engine';
export * from './snap/pointProviders';
export * from './snap/guideProviders';
export * from './input/machine';
export * from './input/toolFields';
export * from './profiles/hash';
export * from './profiles/loops';
export * from './profiles/detect';
