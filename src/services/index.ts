/**
 * services/ — orchestration: command bus, regeneration scheduler, dirty
 * tracking, autosave, file import/export flows. May import `core`,
 * `document`, `sketch`, `kernel` (ARCHITECTURE §3). RegenScheduler and
 * autosave arrive in M3/M6.
 */
export { CommandBus, type DocumentHost } from './CommandBus';
