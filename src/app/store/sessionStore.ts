import { create } from 'zustand';
import type { EntityId, SketchId } from '../../core';
import type { SketchToolId } from '../../sketch';

/**
 * sessionStore (ARCHITECTURE §5): selection, hover, active tool, active
 * sketch, snap toggles. Never persisted; not part of undo history.
 */

interface SessionStore {
  readonly activeSketchId: SketchId | null;
  readonly activeTool: SketchToolId | null;
  readonly selectedEntityIds: readonly EntityId[];
  readonly snapEnabled: boolean;

  readonly enterSketch: (sketchId: SketchId) => void;
  readonly exitSketch: () => void;
  readonly setActiveTool: (tool: SketchToolId | null) => void;
  readonly setSelection: (entityIds: readonly EntityId[]) => void;
  readonly setSnapEnabled: (enabled: boolean) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  activeSketchId: null,
  activeTool: null,
  selectedEntityIds: [],
  snapEnabled: true,

  enterSketch: (sketchId) => {
    set({ activeSketchId: sketchId, activeTool: 'line', selectedEntityIds: [] });
  },
  exitSketch: () => {
    set({ activeSketchId: null, activeTool: null, selectedEntityIds: [] });
  },
  setActiveTool: (tool) => {
    set({ activeTool: tool, selectedEntityIds: [] });
  },
  setSelection: (entityIds) => {
    set({ selectedEntityIds: entityIds });
  },
  setSnapEnabled: (enabled) => {
    set({ snapEnabled: enabled });
  },
}));
