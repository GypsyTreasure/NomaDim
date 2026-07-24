/**
 * document/ — document model: operations (timeline), sketch data, body
 * metadata, undo/redo transactions, XML codecs, validation. May import only
 * `core` (ARCHITECTURE §3). Timeline ops + history arrive in M3.
 */
export * from './sketch/types';
export * from './sketch/roles';
export * from './sketch/access';
export * from './sketch/meta';
export * from './sketch/loopGeometry';
export * from './bodies/types';
export * from './bodies/access';
export * from './datums/types';
export * from './datums/access';
export * from './datums/geometry';
export { validateSketch } from './sketch/validate';
export { sketchToXml, sketchFromXml } from './xml/sketchXml';
export { timelineToXml, timelineFromXml, type TimelineData } from './xml/timelineXml';
export { documentToXml, documentFromXml, SCHEMA_VERSION } from './xml/documentXml';
export * from './model';
export * from './history';
export * from './commands';
export * from './ops/types';
export * from './ops/definition';
export * from './ops/registry';
export * from './timelineCommands';
