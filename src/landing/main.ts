import './landing.css';

/**
 * Marketing landing entry (M10). Deliberately tiny — the landing must load with
 * **zero WASM** and almost no JS: it only wires the mobile nav toggle, stamps
 * the year, and (optionally) injects a privacy-friendly, cookieless analytics
 * snippet when configured via build-time env. No app/kernel code is imported.
 */

const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
const nav = document.querySelector<HTMLElement>('[data-nav]');
if (toggle && nav) {
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
  });
}

const yearEl = document.querySelector<HTMLElement>('[data-year]');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

/**
 * Cookieless analytics (Plausible-compatible), off unless configured at build:
 * `VITE_ANALYTICS_SRC` (script URL) + `VITE_ANALYTICS_DOMAIN`. No cookies → no
 * consent banner required (ADR-0080). Never loads on the app itself.
 */
const analyticsSrc = import.meta.env.VITE_ANALYTICS_SRC;
const analyticsDomain = import.meta.env.VITE_ANALYTICS_DOMAIN;
if (typeof analyticsSrc === 'string' && analyticsSrc.length > 0) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = analyticsSrc;
  if (typeof analyticsDomain === 'string' && analyticsDomain.length > 0) {
    s.setAttribute('data-domain', analyticsDomain);
  }
  document.head.appendChild(s);
}
