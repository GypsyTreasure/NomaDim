import { create } from 'zustand';
import type { BodyId, EntityId, SketchId, Vec2 } from '../../core';
import type { EdgeFingerprint } from '../../document';

/**
 * Transient highlight of the geometry a 3D-op dialog is about to act on
 * (F3 preview): the selected profile loops (and a revolve axis) drawn bright
 * in the viewport. Sketch-local polylines + the plane; the viewport maps them.
 */
export interface ProfileHighlight {
  readonly plane: 'XY' | 'XZ' | 'YZ';
  readonly loops: readonly (readonly Vec2[])[];
  readonly axis: readonly Vec2[] | null;
}
import { edgeFingerprintKey } from '../../kernel';
import type { SketchToolId } from '../../sketch';

/**
 * sessionStore (ARCHITECTURE §5): selection, hover, active tool, active
 * sketch, snap toggles, and transient F4 edge-pick state. Never persisted;
 * not part of undo history.
 */

interface SessionStore {
  readonly activeSketchId: SketchId | null;
  readonly activeTool: SketchToolId | null;
  readonly selectedEntityIds: readonly EntityId[];
  readonly snapEnabled: boolean;
  /** True while a Fillet/Chamfer dialog is in edge-pick mode (F4). */
  readonly edgePicking: boolean;
  /** Body whose edges are pickable (scopes the viewport highlight). */
  readonly edgePickBodyId: BodyId | null;
  /** Edges picked for the active finishing op (source of truth while open). */
  readonly pickedEdges: readonly EdgeFingerprint[];
  /** Selected body (tree ⇄ viewport sync, F8); also the copy/paste source. */
  readonly selectedBodyId: BodyId | null;
  /** Origin plane visibility (F8 Origin section). */
  readonly planeVisibility: Readonly<Record<'XY' | 'XZ' | 'YZ', boolean>>;
  /** Geometry an open Extrude/Revolve dialog will act on, highlighted (F3). */
  readonly profileHighlight: ProfileHighlight | null;
  /** Keyboard-shortcuts help overlay visibility (F11). */
  readonly helpOpen: boolean;

  readonly enterSketch: (sketchId: SketchId) => void;
  readonly exitSketch: () => void;
  readonly setActiveTool: (tool: SketchToolId | null) => void;
  readonly setSelection: (entityIds: readonly EntityId[]) => void;
  readonly setSnapEnabled: (enabled: boolean) => void;
  readonly setEdgePicking: (on: boolean) => void;
  readonly setEdgePickBodyId: (bodyId: BodyId | null) => void;
  readonly setPickedEdges: (edges: readonly EdgeFingerprint[]) => void;
  readonly toggleEdge: (edge: EdgeFingerprint) => void;
  readonly resetEdgePick: () => void;
  readonly setSelectedBody: (bodyId: BodyId | null) => void;
  readonly togglePlane: (plane: 'XY' | 'XZ' | 'YZ') => void;
  readonly setProfileHighlight: (highlight: ProfileHighlight | null) => void;
  readonly setHelpOpen: (open: boolean) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  activeSketchId: null,
  activeTool: null,
  selectedEntityIds: [],
  snapEnabled: true,
  edgePicking: false,
  edgePickBodyId: null,
  pickedEdges: [],
  selectedBodyId: null,
  planeVisibility: { XY: true, XZ: true, YZ: true },
  profileHighlight: null,
  helpOpen: false,

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
  setEdgePicking: (on) => {
    set({ edgePicking: on });
  },
  setEdgePickBodyId: (bodyId) => {
    set({ edgePickBodyId: bodyId });
  },
  setPickedEdges: (edges) => {
    set({ pickedEdges: edges });
  },
  toggleEdge: (edge) => {
    set((state) => {
      const key = edgeFingerprintKey(edge);
      const exists = state.pickedEdges.some((e) => edgeFingerprintKey(e) === key);
      return {
        pickedEdges: exists
          ? state.pickedEdges.filter((e) => edgeFingerprintKey(e) !== key)
          : [...state.pickedEdges, edge],
      };
    });
  },
  resetEdgePick: () => {
    set({ edgePicking: false, edgePickBodyId: null, pickedEdges: [] });
  },
  setSelectedBody: (bodyId) => {
    set({ selectedBodyId: bodyId });
  },
  togglePlane: (plane) => {
    set((state) => ({
      planeVisibility: { ...state.planeVisibility, [plane]: !state.planeVisibility[plane] },
    }));
  },
  setProfileHighlight: (highlight) => {
    set({ profileHighlight: highlight });
  },
  setHelpOpen: (open) => {
    set({ helpOpen: open });
  },
}));
