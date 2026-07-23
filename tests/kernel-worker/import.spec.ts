import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenCascadeInstance, TopoDS_Shape } from 'opencascade.js';
import initOpenCascade from 'opencascade.js/dist/node.js';
import type { BodyId } from '../../src/core';
import type { ImportOp } from '../../src/document';
import { executeImport } from '../../src/kernel-worker/executors/import';
import { readStepToBrepBase64 } from '../../src/kernel-worker/stepio';
import { getLiveShapeCount, trackShapeDisposal } from '../../src/kernel-worker/handleCounter';
import type { BodyStateMap, ExecCtx } from '../../src/kernel-worker/executors/types';

/**
 * STEP import (roadmap P1): a STEP file parses to a solid, embeds as base64
 * BREP, and reconstructs to the same volume at regen (self-contained document).
 */

let oc: OpenCascadeInstance;
beforeAll(async () => {
  oc = await initOpenCascade();
}, 60_000);

const bid = (id: string): BodyId => id as BodyId;

/** Minimal typed view of the STEP writer bits (not on the generated instance
 * type) — an `unknown` cast to a named shape, never `any`. */
interface StepWriterApi {
  readonly STEPControl_Writer_1: new () => {
    Transfer(shape: unknown, mode: unknown, compound: boolean, progress: unknown): unknown;
    Write(file: string): unknown;
    delete(): void;
  };
  readonly STEPControl_StepModelType: { readonly STEPControl_AsIs: unknown };
}

/** Writes a 10³ box to a STEP file and returns its bytes (as `importStep` gets). */
function stepBoxBytes(): ArrayBuffer {
  const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
  const so = oc as unknown as StepWriterApi;
  const writer = new so.STEPControl_Writer_1();
  writer.Transfer(
    box,
    so.STEPControl_StepModelType.STEPControl_AsIs,
    true,
    new oc.Message_ProgressRange_1()
  );
  writer.Write('/box.step');
  writer.delete();
  box.delete();
  const bytes = oc.FS.readFile('/box.step');
  oc.FS.unlink('/box.step');
  return bytes.slice().buffer;
}

function volumeOf(shape: TopoDS_Shape): number {
  const g = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
  const v = g.Mass();
  g.delete();
  return v;
}

describe('STEP import', () => {
  it('parses a STEP solid, embeds BREP, and reconstructs the same volume', () => {
    const brepBase64 = readStepToBrepBase64(oc, stepBoxBytes());
    expect(brepBase64.length).toBeGreaterThan(0);

    const bodies: BodyStateMap = new Map();
    const op: ImportOp = {
      type: 'Import',
      id: 'i1' as ImportOp['id'],
      name: 'Import1',
      suppressed: false,
      format: 'step',
      sourceName: 'box.step',
      brepBase64,
      bodyId: bid('B'),
    };
    executeImport({ oc, bodies, profiles: new Map() } satisfies ExecCtx, op);

    const body = bodies.get(bid('B'));
    expect(body).toBeDefined();
    if (body) {
      expect(volumeOf(body)).toBeCloseTo(1000, 1);
      body.delete();
      trackShapeDisposal();
    }
  });
});

afterAll(() => {
  expect(getLiveShapeCount()).toBe(0);
});
