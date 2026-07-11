import { useEffect, useRef, useState } from 'react';
import { KernelClient, type MeshTransfer } from '../../../kernel';
import {
  type BodyId,
  DEFAULT_EXPORT_ANGULAR_DEFLECTION_DEG,
  DEFAULT_EXPORT_LINEAR_DEFLECTION_MM,
  VIEWPORT_ANGULAR_DEFLECTION_DEG,
  VIEWPORT_LINEAR_DEFLECTION_MM,
} from '../../../core';

/**
 * M1 stepping stone (MASTER_DOCUMENT §8): hardcoded box -> tessellate ->
 * render -> STL download -> live-handle counter, proving the worker
 * pipeline before there is a real document to dispatch Commands against.
 * There is no document yet, so this hook talks to the kernel client
 * directly — the single-write-path Command/Transaction/RegenScheduler flow
 * (ARCHITECTURE §4) arrives in M3 once `document/ops` and `services/` exist
 * to mediate it.
 */

type Status = 'loading' | 'ready' | 'error';

export interface KernelDemoState {
  status: Status;
  errorMessage: string | null;
  bodies: MeshTransfer[];
  liveHandleCount: number | null;
  exportStl: () => void;
  disposeBody: () => void;
}

function downloadBlob(data: ArrayBuffer, fileName: string): void {
  const blob = new Blob([data], { type: 'application/sla' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useKernelDemo(): KernelDemoState {
  const clientRef = useRef<KernelClient | null>(null);
  const bodyIdsRef = useRef<BodyId[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bodies, setBodies] = useState<MeshTransfer[]>([]);
  const [liveHandleCount, setLiveHandleCount] = useState<number | null>(null);

  const fail = (error: unknown): void => {
    setErrorMessage(error instanceof Error ? error.message : String(error));
    setStatus('error');
  };

  useEffect(() => {
    const client = new KernelClient();
    clientRef.current = client;
    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      try {
        const bodyIds = await client.init();
        const meshes = await client.tessellate(bodyIds, {
          linearDeflectionMm: VIEWPORT_LINEAR_DEFLECTION_MM,
          angularDeflectionDeg: VIEWPORT_ANGULAR_DEFLECTION_DEG,
        });
        const count = await client.stats();
        if (cancelled) return;
        bodyIdsRef.current = bodyIds;
        setBodies(meshes);
        setLiveHandleCount(count);
        setStatus('ready');
      } catch (error) {
        if (!cancelled) fail(error);
      }
    };
    void bootstrap();

    return () => {
      cancelled = true;
      client.terminate();
    };
  }, []);

  const exportStl = (): void => {
    const client = clientRef.current;
    if (!client) return;
    void (async () => {
      try {
        const result = await client.exportStl({
          bodyIds: bodyIdsRef.current,
          format: 'binary',
          linearDeflectionMm: DEFAULT_EXPORT_LINEAR_DEFLECTION_MM,
          angularDeflectionDeg: DEFAULT_EXPORT_ANGULAR_DEFLECTION_DEG,
        });
        downloadBlob(result.stl, result.fileName);
      } catch (error) {
        fail(error);
      }
    })();
  };

  const disposeBody = (): void => {
    const client = clientRef.current;
    if (!client) return;
    void (async () => {
      try {
        await client.disposeBodies(bodyIdsRef.current);
        bodyIdsRef.current = [];
        setBodies([]);
        setLiveHandleCount(await client.stats());
      } catch (error) {
        fail(error);
      }
    })();
  };

  return { status, errorMessage, bodies, liveHandleCount, exportStl, disposeBody };
}
