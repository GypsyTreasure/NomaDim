import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyId, ProfileId } from '../core';
import { edgeFingerprintKey } from '../kernel';
import { defaultBodyMeta, isDatumPlane, type DatumPlane } from '../document';
import {
  Viewport,
  VIEW_IDS,
  type BodyStyle,
  type EdgePickProps,
  type ProjectionMode,
  type SketchPreview,
  type ViewId,
} from '../viewport';
import { NumericHud } from './features/sketcher/NumericHud';
import { PlanePicker } from './features/sketcher/PlanePicker';
import { ImportLayersDialog } from './features/sketcher/ImportLayersDialog';
import { ConstructMenu } from './features/construct/ConstructMenu';
import { ConstructDialog } from './features/construct/ConstructDialog';
import { buildDatumRenders } from './features/construct/datumRenders';
import { useConstructStore } from './store/constructStore';
import { PropertiesPanel } from './features/sketcher/PropertiesPanel';
import { SketchToolbar } from './features/sketcher/SketchToolbar';
import { useSketcher } from './features/sketcher/useSketcher';
import { buildSketchPreviews } from './features/sketcher/sketchPreviews';
import { Logo } from './features/brand/Logo';
import { ProjectNameField } from './features/project/ProjectNameField';
import { UndoRedo } from './features/history/UndoRedo';
import { BrowserTree } from './features/browser/BrowserTree';
import { MeasureHud } from './features/measure/MeasureHud';
import { useMeasure } from './features/measure/useMeasure';
import { DocumentIO } from './features/document-io/DocumentIO';
import { ImportStepButton } from './features/document-io/ImportStepButton';
import { KeyboardShortcuts } from './features/help/KeyboardShortcuts';
import { OnboardingHint } from './features/onboarding/OnboardingHint';
import { Toaster } from './features/toast/Toaster';
import { useOpErrorToasts } from './features/toast/useOpErrorToasts';
import { useModelingShortcuts } from './features/shortcuts/useModelingShortcuts';
import { loadDocumentText } from './features/document-io/documentIO';
import { pushToast } from './store/toastStore';
import { usePreviewStore } from './store/previewStore';
import { restorePersistedDocument, startAutosave } from './features/persistence/autosave';
import { isSafeMode, markBootStable } from './features/persistence/resilience';
import { NewProjectButton } from './features/persistence/NewProjectButton';
import { ExportStlButton } from './features/timeline/ExportStlButton';
import { LicenseButton } from './features/licensing/LicenseButton';
import { SettingsButton } from './features/admin/SettingsButton';
import { ProjectsButton } from './features/projects/ProjectsButton';
import { useFolderStore } from './features/projects/folderStore';
import { IconButton } from './features/ui/IconButton';
import { ToolbarGroup } from './features/ui/ToolbarGroup';
import toolbarStyles from './features/ui/Toolbar.module.css';
import { useEntitlementStore } from './store/entitlementStore';
import { OpDialogHost } from './features/timeline/OpDialogHost';
import { TimelineBar } from './features/timeline/TimelineBar';
import { CreateOpsBar } from './features/timeline/CreateOpsBar';
import { useTimeline } from './features/timeline/useTimeline';
import { t } from './i18n/t';
import { scheduleKernelBoot, useKernelStore } from './store/kernelStore';
import { useDocumentStore } from './store/documentStore';
import { useSessionStore } from './store/sessionStore';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useMediaQuery } from './useMediaQuery';
import styles from './App.module.css';
import sketcherStyles from './features/sketcher/Sketcher.module.css';

export function App(): React.JSX.Element {
  const sketcher = useSketcher();
  const timeline = useTimeline();
  const measure = useMeasure();
  const bodies = useKernelStore((s) => s.bodies);
  const bodyEdges = useKernelStore((s) => s.bodyEdges);
  const liveBodyIds = useKernelStore((s) => s.liveBodyIds);
  const kernelError = useKernelStore((s) => s.error);
  const kernelReady = useKernelStore((s) => s.ready);
  const kernelLoadProgress = useKernelStore((s) => s.loadProgress);
  const previewGhosts = usePreviewStore((s) => s.ghosts);
  useOpErrorToasts(); // §7: failed op → toast (the red chip is the other half)

  const edgePicking = useSessionStore((s) => s.edgePicking);
  const edgePickBodyId = useSessionStore((s) => s.edgePickBodyId);
  const pickedEdges = useSessionStore((s) => s.pickedEdges);
  const toggleEdge = useSessionStore((s) => s.toggleEdge);
  const bodyMeta = useDocumentStore((s) => s.document.bodyMeta);
  const sketches = useDocumentStore((s) => s.document.sketches);
  const sketchMeta = useDocumentStore((s) => s.document.sketchMeta);
  const datums = useDocumentStore((s) => s.document.datums);
  const datumPreview = useConstructStore((s) => s.preview);
  const constructOpen = useConstructStore((s) => s.open);
  const openConstruct = useConstructStore((s) => s.openCreate);
  const selectedBodyId = useSessionStore((s) => s.selectedBodyId);
  const planeVisibility = useSessionStore((s) => s.planeVisibility);
  const profileHighlight = useSessionStore((s) => s.profileHighlight);
  const setSelectedBody = useSessionStore((s) => s.setSelectedBody);
  const setHelpOpen = useSessionStore((s) => s.setHelpOpen);
  // Clicking a highlighted profile region in the 3D view toggles it in the open
  // op dialog (#11); the dialog registers the toggle handler via profilePick.
  const onPickProfile = useCallback((id: string) => {
    useSessionStore.getState().profilePick?.(id as ProfileId);
  }, []);
  // Mobile hamburger: whether the app-action cluster is expanded (ignored on
  // desktop, where the cluster is always shown inline).
  const [actionsOpen, setActionsOpen] = useState(false);
  // The browser tree (origin planes / sketches / bodies) and the view bar are
  // collapsed behind their own toggles in the top-right menu cluster.
  const [treeOpen, setTreeOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const appBarRef = useRef<HTMLDivElement>(null);

  // Crash-loop guard (ADR-0110): after repeated OOM crash-reloads, come up in
  // safe mode — the document is still restored, but the heavy 3D kernel waits
  // for a tap so the reload loop can't continue. `recovered` flips once the user
  // opts back into 3D.
  const [recovered, setRecovered] = useState(false);
  const safeMode = isSafeMode() && !recovered;

  // On phones the ribbon collapses behind the hamburger and only the essentials
  // stay on the bar (#1) — the Browser/View toggles and Undo/Redo move into the
  // dropdown in modeling mode, keeping the top bar simple and aligned.
  const isMobile = useMediaQuery('(max-width: 700px)');

  // Tapping outside the app bar closes the menu — but NOT on item clicks, so a
  // dialog opened from the menu (e.g. New Project) keeps the menu open while
  // the decision is made (the dialog's scrim lives inside the app bar subtree).
  useEffect(() => {
    if (!actionsOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (appBarRef.current && !appBarRef.current.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [actionsOpen]);

  useGlobalShortcuts(sketcher.activeSketch !== null);
  useModelingShortcuts(sketcher.activeSketch === null, {
    newSketch: sketcher.newSketch,
    toggleMeasure: measure.toggle,
    createOp: timeline.openCreate,
    hasSketch: sketches.length > 0,
    createPlane: () => {
      openConstruct('plane');
    },
    createAxis: () => {
      openConstruct('axis');
    },
  });

  // Restore the autosaved document, boot the worker + RegenScheduler, then keep
  // autosaving — once, on first mount (§4). Restore runs BEFORE startRegen so
  // the scheduler's initial regen rebuilds bodies from the restored timeline.
  useEffect(() => {
    restorePersistedDocument();
    // Re-verify a persisted Pro license offline (M11) — free tier otherwise.
    useEntitlementStore.getState().restore();
    // Silently re-authorize the saved local project folder, if any (ADR-0089).
    void useFolderStore.getState().restore();
    // Defer the multi-MB WASM boot to idle so the shell + empty viewport paint
    // first (M8 lazy kernel). Restore stays synchronous and ordered before it.
    // In safe mode (crash loop) the kernel waits for an explicit tap (ADR-0110).
    if (!isSafeMode()) scheduleKernelBoot();
    // Surviving a few seconds without another crash-reload = a clean boot.
    const stableTimer = setTimeout(markBootStable, 6000);
    const stopAutosave = startAutosave();
    return () => {
      clearTimeout(stableTimer);
      stopAutosave();
    };
  }, []);

  // A ready kernel means this boot succeeded — clear the crash counter now.
  useEffect(() => {
    if (kernelReady) markBootStable();
  }, [kernelReady]);

  const edgePick = useMemo<EdgePickProps | null>(() => {
    if (!edgePicking) return null;
    const scoped = edgePickBodyId
      ? bodyEdges.filter((b) => b.bodyId === edgePickBodyId)
      : bodyEdges;
    return {
      bodyEdges: scoped,
      pickedKeys: new Set(pickedEdges.map(edgeFingerprintKey)),
      onPick: toggleEdge,
    };
  }, [edgePicking, edgePickBodyId, bodyEdges, pickedEdges, toggleEdge]);

  // Committed-sketch previews (Fusion parity): every visible sketch NOT
  // currently being edited draws as 3D reference geometry. The active sketch
  // is excluded — the 2D overlay already renders it. Auto-hidden sketches
  // (consumed by a feature) simply fall out until re-shown from the tree.
  const activeSketchId = sketcher.activeSketch?.id ?? null;
  const sketchPreviews = useMemo<readonly SketchPreview[]>(
    () => buildSketchPreviews(sketches, sketchMeta, activeSketchId),
    [sketches, sketchMeta, activeSketchId]
  );

  // Construction geometry (datum planes/axes) + the live creation ghost → the
  // viewport. Placement is derived (document math); hidden datums are dropped.
  const datumRenders = useMemo(
    () => buildDatumRenders(datums, datumPreview),
    [datums, datumPreview]
  );
  // Construction planes offered as sketch bases in the plane picker (#datum).
  const datumPlanes = useMemo<readonly DatumPlane[]>(() => datums.filter(isDatumPlane), [datums]);

  // Translated labels for the standard view buttons (F11).
  const viewLabels = useMemo<Partial<Record<ViewId, string>>>(() => {
    const labels: Partial<Record<ViewId, string>> = {};
    for (const id of VIEW_IDS) labels[id] = t(`view.${id}`);
    return labels;
  }, []);

  // Translated labels for the perspective/orthographic toggle (F11).
  const projectionLabels = useMemo<Record<ProjectionMode, string>>(
    () => ({
      perspective: t('view.projection.perspective'),
      orthographic: t('view.projection.orthographic'),
    }),
    []
  );

  // Per-body colour/visibility/selection for the viewport (F8). Depends on
  // metadata + selection only, so sketch edits don't rebuild body meshes.
  const bodyStyles = useMemo<ReadonlyMap<BodyId, BodyStyle>>(() => {
    const map = new Map<BodyId, BodyStyle>();
    for (const id of liveBodyIds) {
      const meta = bodyMeta.find((m) => m.id === id) ?? defaultBodyMeta(id);
      map.set(id, { color: meta.color, visible: meta.visible, selected: id === selectedBodyId });
    }
    return map;
  }, [bodyMeta, liveBodyIds, selectedBodyId]);

  const inSketch = sketcher.activeSketch !== null;

  // Header controls reused across the desktop bar and the mobile dropdown, so
  // each renders in exactly one place per layout (#1).
  const browserToggle = (
    <IconButton
      icon="browser"
      label={t('menu.browser')}
      active={treeOpen}
      ariaPressed={treeOpen}
      testid="browser-toggle"
      badge={
        <span className={toolbarStyles.badge} data-testid="body-count">
          {liveBodyIds.length}
        </span>
      }
      onClick={() => {
        setTreeOpen((open) => !open);
      }}
    />
  );
  const viewToggle = !inSketch ? (
    <IconButton
      icon="view"
      label={t('menu.view')}
      active={viewOpen}
      ariaPressed={viewOpen}
      testid="view-toggle"
      onClick={() => {
        setViewOpen((open) => !open);
      }}
    />
  ) : null;
  const historyGroup = (
    <ToolbarGroup label={t('ribbon.history')}>
      <UndoRedo />
    </ToolbarGroup>
  );

  return (
    <div className={styles.shell}>
      {safeMode && (
        <div className={styles.recoveryBar} role="status" data-testid="recovery-bar">
          <span className={styles.recoveryText}>{t('recovery.message')}</span>
          <button
            type="button"
            className={styles.recoveryButton}
            data-testid="recovery-load"
            onClick={() => {
              markBootStable();
              setRecovered(true);
              scheduleKernelBoot();
            }}
          >
            {t('recovery.load')}
          </button>
        </div>
      )}
      {!kernelReady && !kernelError && !safeMode && (
        <div className={styles.kernelLoading} data-testid="kernel-loading" role="status">
          <span className={styles.kernelLoadingLabel}>
            {t('kernel.loading')}
            {kernelLoadProgress > 0 && ` ${String(Math.round(kernelLoadProgress * 100))}%`}
          </span>
          <div className={styles.kernelLoadingTrack}>
            {kernelLoadProgress > 0 ? (
              <div
                className={styles.kernelLoadingBarDeterminate}
                style={{ width: `${String(Math.round(kernelLoadProgress * 100))}%` }}
              />
            ) : (
              <div className={styles.kernelLoadingBar} />
            )}
          </div>
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <h1 className={styles.title}>
            {/* Clicking the logo returns to the marketing/landing page (#1). */}
            <a className={styles.homeLink} href={import.meta.env.BASE_URL} title={t('nav.home')}>
              <Logo />
            </a>
          </h1>
          {/* Hidden on phones (#1) to give the compact header room — the name is
              still editable on wider screens and shown in the browser tab. */}
          <span className={styles.projectName}>
            <ProjectNameField />
          </span>
        </div>
        {/* Menus live IN the top bar (#5), not floating over the model. Browser
            is present in both modes; View + the app-action menu are modeling. */}
        <div className={styles.headerActions} ref={appBarRef}>
          <div className={toolbarStyles.bar}>
            {/* Desktop: Browser + View inline. Mobile: these move into the
                hamburger dropdown (modeling) — but in a sketch (no dropdown)
                Browser stays on the bar so body visibility is always reachable. */}
            {!isMobile && (
              <ToolbarGroup label={t('ribbon.view')}>
                {browserToggle}
                {viewToggle}
              </ToolbarGroup>
            )}
            {isMobile && inSketch && (
              <ToolbarGroup label={t('ribbon.view')}>{browserToggle}</ToolbarGroup>
            )}
            {!inSketch && (
              <ToolbarGroup label={t('ribbon.sketch')}>
                <IconButton
                  icon="newSketch"
                  label={t('sketch.newSketch')}
                  shortcut="N"
                  primary
                  testid="new-sketch"
                  onClick={sketcher.newSketch}
                />
              </ToolbarGroup>
            )}
            {!inSketch && (
              <button
                type="button"
                className={sketcherStyles.menuToggle}
                aria-label={t('menu.toggle')}
                aria-expanded={actionsOpen}
                data-testid="app-menu-toggle"
                onClick={() => {
                  setActionsOpen((open) => !open);
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M3 5h14M3 10h14M3 15h14"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
          {!inSketch && (
            <div
              className={`${sketcherStyles.menuPanel ?? ''} ${
                actionsOpen ? (sketcherStyles.menuPanelOpen ?? '') : ''
              }`}
              data-testid="app-actions"
            >
              {/* On phones the toggles + Undo/Redo live at the top of the
                  dropdown (the bar keeps only New Sketch + hamburger, #1). */}
              {isMobile && (
                <>
                  <ToolbarGroup label={t('ribbon.view')}>
                    {browserToggle}
                    {viewToggle}
                  </ToolbarGroup>
                  {historyGroup}
                  <span className={toolbarStyles.divider} aria-hidden="true" />
                </>
              )}
              {/* Create/Modify/Pattern ops, moved up onto the logo bar (#5c). */}
              <CreateOpsBar timeline={timeline} />
              <span className={toolbarStyles.divider} aria-hidden="true" />
              {/* Datum + Inspect. */}
              <ToolbarGroup label={t('ribbon.datum')}>
                <ConstructMenu />
              </ToolbarGroup>
              <ToolbarGroup label={t('ribbon.inspect')}>
                <IconButton
                  icon="measure"
                  label={t('measure.toggle')}
                  shortcut="M"
                  active={measure.active}
                  ariaPressed={measure.active}
                  onClick={measure.toggle}
                />
              </ToolbarGroup>
              <span className={toolbarStyles.divider} aria-hidden="true" />
              <ToolbarGroup label={t('ribbon.file')}>
                <NewProjectButton />
                <DocumentIO />
                <ImportStepButton />
                <ExportStlButton />
                <ProjectsButton />
              </ToolbarGroup>
              <span className={toolbarStyles.divider} aria-hidden="true" />
              <ToolbarGroup label={t('ribbon.system')}>
                <SettingsButton />
                <LicenseButton />
                <IconButton
                  icon="help"
                  label={t('help.openButton')}
                  shortcut="?"
                  testid="shortcuts-open"
                  onClick={() => {
                    setHelpOpen(true);
                  }}
                />
              </ToolbarGroup>
              {kernelError && (
                <span className={sketcherStyles.summary} role="alert">
                  {t('kernel.status.error')} {kernelError}{' '}
                  <button
                    type="button"
                    className={sketcherStyles.button}
                    data-testid="kernel-reload"
                    onClick={() => {
                      window.location.reload();
                    }}
                  >
                    {t('kernel.reload')}
                  </button>
                </span>
              )}
            </div>
          )}
          {/* History stays on the bar on desktop and in a sketch; on mobile in
              modeling mode it rides in the dropdown instead (above). */}
          {(!isMobile || inSketch) && historyGroup}
        </div>
      </header>
      <main className={styles.viewportArea}>
        {/* The create-op launcher now lives on the top logo bar as thematic
            ribbon groups (#5c); the timeline history stays in the bottom dock. */}
        <div
          className={styles.canvasRegion}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (!file) return;
            void file.text().then((text) => {
              const error = loadDocumentText(text);
              if (error !== null) pushToast(`${t('io.loadError')} ${error}`, 'error');
            });
          }}
        >
          <Viewport
            zoomToFitLabel={t('viewport.zoomToFit')}
            viewLabels={viewLabels}
            projectionLabels={projectionLabels}
            bodies={bodies}
            previewBodies={previewGhosts}
            sketchMode={sketcher.viewportSketchMode}
            fitNonce={sketcher.fitNonce}
            sectionView={sketcher.intersect}
            edgePick={edgePick}
            measure={measure.measureProps}
            bodyStyles={bodyStyles}
            planeVisibility={planeVisibility}
            sketchPreviews={sketchPreviews}
            datums={datumRenders}
            opHighlight={profileHighlight}
            onPickProfile={onPickProfile}
            onSelectBody={setSelectedBody}
            facePick={sketcher.pickingFace ? { onPick: sketcher.pickFace } : null}
            viewBarOpen={viewOpen}
          />

          {treeOpen && <BrowserTree />}

          {sketcher.activeSketch ? (
            <>
              <NumericHud
                input={sketcher.inputState}
                onFocus={sketcher.focusField}
                onChangeField={sketcher.setFieldText}
                onSubmit={sketcher.submitInput}
                onCancel={sketcher.cancelInput}
                onCycle={sketcher.cycleField}
              />
              <PropertiesPanel sketch={sketcher.activeSketch} />
            </>
          ) : (
            <>
              {!sketcher.choosingPlane && !sketcher.pickingFace && <OnboardingHint />}
              {sketcher.choosingPlane && (
                <PlanePicker
                  onChoose={sketcher.choosePlane}
                  onChooseDatum={sketcher.sketchOnDatum}
                  onPickFace={sketcher.beginFacePick}
                  onCancel={sketcher.cancelPlaneChoice}
                  datumPlanes={datumPlanes}
                />
              )}
              {sketcher.pickingFace && (
                <div className={sketcherStyles.summary} data-testid="face-pick-hint">
                  {sketcher.faceError ?? t('sketch.facePickHint')}{' '}
                  <button
                    type="button"
                    className={sketcherStyles.button}
                    onClick={sketcher.cancelFacePick}
                  >
                    {t('dialog.cancel')}
                  </button>
                </div>
              )}
              {sketcher.lastFinish && (
                <div className={sketcherStyles.summary} data-testid="finish-summary">
                  {t('sketch.summary.profiles')} {sketcher.lastFinish.profiles}{' '}
                  {t('sketch.summary.withHoles')} {sketcher.lastFinish.withHoles}{' '}
                  {t('sketch.summary.open')} {sketcher.lastFinish.open}
                </div>
              )}
              {measure.active && <MeasureHud result={measure.result} />}
            </>
          )}
          {/* Op dialogs (Extrude/Fillet/…) are non-modal panels anchored to the
              same top-right corner as the app menu; kept here, after the app
              bar, so they paint above it and their edge-pick backdrop stays
              within the canvas region. */}
          <OpDialogHost timeline={timeline} />
          {/* Construction plane/axis create-edit dialog — keyed per open so its
              form state resets each time (fresh mint / edit target). */}
          {constructOpen && (
            <ConstructDialog
              key={constructOpen.editing ? constructOpen.editing.id : `new-${constructOpen.kind}`}
            />
          )}
          <KeyboardShortcuts />
          {sketcher.pendingImport && (
            <ImportLayersDialog
              pending={sketcher.pendingImport}
              onConfirm={sketcher.confirmImport}
              onCancel={sketcher.cancelImport}
            />
          )}
        </div>

        {/* Shared bottom tool dock (#3): the sketch tools and the 3D timeline
            occupy the same reserved strip in both modes. Because it is a flex
            sibling of the canvas (not floating over it), the model is never
            hidden behind it. */}
        <div className={styles.toolDock} data-testid="tool-dock">
          {inSketch ? <SketchToolbar sketcher={sketcher} /> : <TimelineBar timeline={timeline} />}
        </div>
      </main>
      <Toaster />
    </div>
  );
}
