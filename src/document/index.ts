/**
 * document/ — document model: operations (timeline), sketch data, body
 * metadata, undo/redo transactions, XML codecs, validation. May import only
 * `core` (ARCHITECTURE §3). Timeline ops + history arrive in M3.
 */
export * from './sketch/types';
export * from './sketch/roles';
export * from './sketch/access';
export { validateSketch } from './sketch/validate';
export { sketchToXml, sketchFromXml } from './xml/sketchXml';
