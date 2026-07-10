import { distance } from '../../core';
import { DEFAULT_GUIDE_PROVIDERS } from './guideProviders';
import { DEFAULT_POINT_PROVIDERS } from './pointProviders';
import type {
  Guide,
  GuideProvider,
  SnapCandidate,
  SnapContext,
  SnapProvider,
  SnapResult,
} from './types';

/**
 * SnapEngine (ARCHITECTURE §10): queries an ordered list of providers and
 * picks the highest-priority candidate within tolerance; ties break by
 * distance to cursor, then by provider order (stable). The engine contains
 * NO per-kind logic — add providers, never special-case here. Unit-pure and
 * DOM-free (R11): callers convert pixel tolerance to sketch units first.
 */
export class SnapEngine {
  constructor(
    private readonly pointProviders: readonly SnapProvider[] = DEFAULT_POINT_PROVIDERS,
    private readonly guideProviders: readonly GuideProvider[] = DEFAULT_GUIDE_PROVIDERS
  ) {}

  query(ctx: SnapContext): SnapResult {
    const disabled = ctx.disabledKinds;
    const candidates: SnapCandidate[] = [];
    const guides: Guide[] = [];

    for (const provider of this.pointProviders) {
      for (const c of provider.provide(ctx)) {
        if (!disabled?.has(c.kind)) candidates.push(c);
      }
    }
    for (const provider of this.guideProviders) {
      const result = provider.provide(ctx);
      for (const guide of result.guides) {
        if (!disabled?.has(guide.kind)) guides.push(guide);
      }
      for (const c of result.candidates) {
        if (!disabled?.has(c.kind)) candidates.push(c);
      }
    }

    let best: SnapCandidate | null = null;
    let bestDistance = Infinity;
    for (const c of candidates) {
      const d = distance(ctx.cursor, c.point);
      if (d > ctx.toleranceMm) continue;
      if (
        !best ||
        c.priority > best.priority ||
        (c.priority === best.priority && d < bestDistance)
      ) {
        best = c;
        bestDistance = d;
      }
    }

    return { snap: best, guides };
  }
}
