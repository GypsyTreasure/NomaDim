import { describe, expect, it } from 'vitest';
import type { EntityId, OpId, PointId, SketchId } from '../../src/core/ids';
import { emptyDocument, findSketch, type Command, type DocumentState } from '../../src/document';
import { CommandBus, type DocumentHost } from '../../src/services';

const skId = 'sk1' as SketchId;
const skOpId = 'op1' as OpId;
const pid = (id: string): PointId => id as PointId;
const eid = (id: string): EntityId => id as EntityId;

function makeHost(): DocumentHost & { current: DocumentState } {
  const host = {
    current: emptyDocument(),
    getDocument() {
      return host.current;
    },
    setDocument(state: DocumentState) {
      host.current = state;
    },
  };
  return host;
}

const createSketch: Command = {
  type: 'CreateSketch',
  payload: { sketchId: skId, opId: skOpId, name: 'Sketch1', plane: { kind: 'origin', plane: 'XY' } },
};

const addLine: Command = {
  type: 'AddSketchGeometry',
  payload: {
    sketchId: skId,
    points: [
      { id: pid('p1'), x: 0, y: 0 },
      { id: pid('p2'), x: 40, y: 0 },
    ],
    entities: [
      { type: 'line', id: eid('e1'), start: pid('p1'), end: pid('p2'), construction: false },
    ],
  },
};

describe('CommandBus (single write path, R1-R3)', () => {
  it('dispatch validates, applies, and notifies exactly once', () => {
    const host = makeHost();
    const bus = new CommandBus(host);
    let notifications = 0;
    bus.onChange(() => {
      notifications += 1;
    });

    expect(bus.dispatch(createSketch).ok).toBe(true);
    expect(bus.dispatch(addLine).ok).toBe(true);
    expect(notifications).toBe(2);
    expect(findSketch(host.current, skId)?.entities).toHaveLength(1);
  });

  it('fails atomically: invalid geometry leaves the document untouched', () => {
    const host = makeHost();
    const bus = new CommandBus(host);
    bus.dispatch(createSketch);
    const before = host.current;

    const bad: Command = {
      type: 'AddSketchGeometry',
      payload: {
        sketchId: skId,
        points: [],
        entities: [
          { type: 'line', id: eid('eX'), start: pid('ghost'), end: pid('p2'), construction: false },
        ],
      },
    };
    const result = bus.dispatch(bad);
    expect(result.ok).toBe(false);
    expect(host.current).toBe(before);
    expect(bus.canUndo()).toBe(true); // only the create is on the stack
  });

  it('undo/redo round-trips through the same notification path (R2)', () => {
    const host = makeHost();
    const bus = new CommandBus(host);
    let notifications = 0;
    bus.onChange(() => {
      notifications += 1;
    });

    bus.dispatch(createSketch);
    bus.dispatch(addLine);
    expect(bus.undo()).toBe(true);
    expect(findSketch(host.current, skId)?.entities).toHaveLength(0);
    expect(bus.undo()).toBe(true);
    expect(findSketch(host.current, skId)).toBeUndefined();
    expect(bus.undo()).toBe(false); // stack empty

    expect(bus.redo()).toBe(true);
    expect(bus.redo()).toBe(true);
    expect(findSketch(host.current, skId)?.entities).toHaveLength(1);
    expect(bus.redo()).toBe(false);
    expect(notifications).toBe(6); // 2 dispatches + 2 undos + 2 redos

    // A new dispatch clears the redo stack.
    bus.undo();
    bus.dispatch(addLineWithId('e2', 'p3', 'p4'));
    expect(bus.canRedo()).toBe(false);
  });

  it('delete garbage-collects orphaned pool points but keeps shared ones', () => {
    const host = makeHost();
    const bus = new CommandBus(host);
    bus.dispatch(createSketch);
    bus.dispatch(addLine);
    // Second line chained off p2 (shared endpoint).
    bus.dispatch({
      type: 'AddSketchGeometry',
      payload: {
        sketchId: skId,
        points: [{ id: pid('p3'), x: 40, y: 20 }],
        entities: [
          { type: 'line', id: eid('e2'), start: pid('p2'), end: pid('p3'), construction: false },
        ],
      },
    });

    bus.dispatch({
      type: 'DeleteSketchEntities',
      payload: { sketchId: skId, entityIds: [eid('e2')] },
    });
    const sketch = findSketch(host.current, skId);
    expect(sketch?.entities.map((e) => e.id)).toEqual(['e1']);
    // p3 orphaned → gone; p2 still used by e1 → kept.
    expect(sketch?.points.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('move/radius/construction/rename commands are undoable edits', () => {
    const host = makeHost();
    const bus = new CommandBus(host);
    bus.dispatch(createSketch);
    bus.dispatch(addLine);
    bus.dispatch({
      type: 'MoveSketchPoints',
      payload: { sketchId: skId, moves: [{ pointId: pid('p2'), x: 60, y: 5 }] },
    });
    expect(findSketch(host.current, skId)?.points.find((p) => p.id === 'p2')).toMatchObject({
      x: 60,
      y: 5,
    });
    bus.undo();
    expect(findSketch(host.current, skId)?.points.find((p) => p.id === 'p2')).toMatchObject({
      x: 40,
      y: 0,
    });

    bus.dispatch({
      type: 'SetEntityConstruction',
      payload: { sketchId: skId, entityId: eid('e1'), construction: true },
    });
    expect(findSketch(host.current, skId)?.entities[0]?.construction).toBe(true);

    expect(
      bus.dispatch({
        type: 'SetCircleRadius',
        payload: { sketchId: skId, entityId: eid('e1'), r: 3 },
      }).ok
    ).toBe(false); // e1 is a line, atomically rejected

    bus.dispatch({ type: 'RenameSketch', payload: { sketchId: skId, name: 'Base' } });
    expect(findSketch(host.current, skId)?.name).toBe('Base');
  });
});

function addLineWithId(entityId: string, a: string, b: string): Command {
  return {
    type: 'AddSketchGeometry',
    payload: {
      sketchId: skId,
      points: [
        { id: pid(a), x: 1, y: 1 },
        { id: pid(b), x: 2, y: 2 },
      ],
      entities: [
        { type: 'line', id: eid(entityId), start: pid(a), end: pid(b), construction: false },
      ],
    },
  };
}
