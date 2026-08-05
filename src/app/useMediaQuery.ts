import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query and re-render on change (ADR-0111). Used to
 * give the header a genuinely mobile layout rather than fighting it with CSS —
 * e.g. `useMediaQuery('(max-width: 700px)')`. SSR/no-`matchMedia` safe: falls
 * back to `false`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const noop = (): undefined => undefined;
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return noop;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => {
        mql.removeEventListener('change', onChange);
      };
    },
    () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
      return window.matchMedia(query).matches;
    },
    () => false
  );
}
