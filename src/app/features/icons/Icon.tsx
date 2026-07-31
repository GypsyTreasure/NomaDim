/**
 * Minimal line-icon set (ADR-0090) — a single consistent visual language for
 * every toolbar/menu button: 24×24 viewBox, `currentColor`, 1.7 stroke, round
 * caps/joins, no fills. Apple-SF-Symbols-like restraint so the UI reads as one
 * system. Icons are decorative: every button still carries an `aria-label` and
 * a `title` (label + shortcut), so screen readers and tests use the text name.
 */

export type IconName =
  | 'browser'
  | 'view'
  | 'measure'
  | 'plane'
  | 'axis'
  | 'construct'
  | 'newProject'
  | 'save'
  | 'open'
  | 'importStep'
  | 'exportStl'
  | 'projects'
  | 'settings'
  | 'license'
  | 'help'
  | 'menu'
  | 'undo'
  | 'redo'
  | 'select'
  | 'change'
  | 'dimension'
  | 'line'
  | 'centerline'
  | 'rectangle'
  | 'rectangleCenter'
  | 'circle'
  | 'arc'
  | 'arcCenter'
  | 'point'
  | 'polygon'
  | 'spline'
  | 'construction'
  | 'snap'
  | 'intersect'
  | 'delete'
  | 'finish'
  | 'importSketch'
  | 'mirror'
  | 'mirrorY'
  | 'pattern';

const P = ({ d }: { d: string }): React.JSX.Element => (
  <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
);

const GLYPHS: Record<IconName, React.JSX.Element> = {
  browser: <P d="M4 6h16M4 12h16M4 18h16" />,
  view: (
    <>
      <P d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </>
  ),
  measure: <P d="M4 14 14 4l6 6L10 20zM8 12l1.5 1.5M11 9l1.5 1.5M14 6l1.5 1.5" />,
  plane: <P d="M3 8l9-4 9 4-9 4-9-4Zm0 0v8l9 4 9-4V8" />,
  axis: <P d="M4 20 20 4M6 4H4v2M20 18v2h-2" />,
  construct: <P d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13" />,
  newProject: <P d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM13 3v6h6M12 12v5M9.5 14.5h5" />,
  save: <P d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" />,
  open: <P d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  importStep: <P d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M13 21H5a2 2 0 0 1-2-2v-9m18 4h-9m0 0 3-3m-3 3 3 3" />,
  exportStl: <P d="M12 15V4m0 0 4 4m-4-4-4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />,
  projects: <P d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 13h8M8 16h5" />,
  settings: <P d="M6 7h12M6 12h12M6 17h12M9 5v4M15 10v4M11 15v4" />,
  license: (
    <>
      <circle cx="8" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <P d="M11 12h9m-3 0v3m-3-3v2" />
    </>
  ),
  help: <P d="M9.2 9a2.8 2.8 0 1 1 3.7 2.7c-.9.4-1.4 1-1.4 2M12 17h.01M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" />,
  menu: <P d="M4 7h16M4 12h16M4 17h16" />,
  undo: <P d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1" />,
  redo: <P d="m15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h1" />,
  select: <P d="m5 3 6 16 2.5-6.5L20 10 5 3Z" />,
  change: (
    <>
      <P d="M6 18 18 6" />
      <circle cx="5" cy="19" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="19" cy="5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </>
  ),
  dimension: <P d="M4 8v8M20 8v8M4 12h16m-16 0 3-2m-3 2 3 2m13-2-3-2m3 2-3 2" />,
  line: <P d="M5 19 19 5" />,
  centerline: <P d="M4 12h3m3 0h4m3 0h3" />,
  rectangle: <P d="M4 6h16v12H4z" />,
  rectangleCenter: (
    <>
      <P d="M4 6h16v12H4z" />
      <P d="M12 10.5v3M10.5 12h3" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />,
  arc: <P d="M4 18a12 12 0 0 1 16 0" />,
  arcCenter: <P d="M4 18a12 12 0 0 1 16 0M12 18v-6" />,
  point: <circle cx="12" cy="12" r="2.4" fill="currentColor" />,
  polygon: <P d="M12 3 21 9v6l-9 6-9-6V9l9-6Z" />,
  spline: <P d="M3 17c4 0 5-10 9-10s5 10 9 10" />,
  construction: <P d="M4 8h4M12 8h4M20 8v4M20 16h-4M12 16H8M4 16v-4M4 12v0" />,
  snap: <P d="M6 4v7a6 6 0 0 0 12 0V4M6 8h3m6 0h3" />,
  intersect: <P d="M9 4a6 6 0 0 0 0 16M15 4a6 6 0 0 1 0 16M9 12h6" />,
  delete: <P d="M5 7h14M10 7V5h4v2m4 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7m4 4v6m4-6v6" />,
  finish: <P d="m4 12 5 5L20 6" />,
  importSketch: <P d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14" />,
  mirror: <P d="M12 3v18M7 7 4 12l3 5V7Zm5 0 3-5-3 5m5 0 3 5-3 5V7Z" />,
  mirrorY: <P d="M3 12h18M7 7 12 4l5 3H7Zm0 10 5 3 5-3H7Z" />,
  pattern: <P d="M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z" />,
};

export function Icon({
  name,
  size = 20,
}: {
  name: IconName;
  size?: number;
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {GLYPHS[name]}
    </svg>
  );
}
