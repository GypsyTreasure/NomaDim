import { useEffect } from 'react';
import { t } from '../../i18n/t';
import { useDocumentStore } from '../../store/documentStore';
import { useSettings, useSettingsStore, type StlFormat } from '../../store/settingsStore';
import { buildExportBaseName } from '../naming/exportName';
import {
  isErrorReportingAvailable,
  isErrorReportingEnabled,
  setErrorReporting,
} from '../telemetry/errorReporting';
import styles from './Admin.module.css';

/**
 * Admin panel (post-M12): user-level preferences that are NOT part of a
 * document — UI language, default export parameters, autosave retention, and
 * the export-filename naming pattern. Everything applies live and persists to
 * localStorage (static-host safe). Kept out of the document so changing a
 * preference never dirties the open project.
 */

const TTL_OPTIONS: readonly {
  readonly value: number | null;
  readonly key: Parameters<typeof t>[0];
}[] = [
  { value: null, key: 'admin.ttl.never' },
  { value: 7, key: 'admin.ttl.7' },
  { value: 30, key: 'admin.ttl.30' },
  { value: 90, key: 'admin.ttl.90' },
];

export function AdminPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const settings = useSettings();
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);
  const projectName = useDocumentStore((s) => s.document.name);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const previewName = `${buildExportBaseName(projectName || 'MyPart', settings)}.stl`;

  return (
    <div className={styles.backdrop} data-testid="admin-overlay" onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label={t('admin.title')}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{t('admin.title')}</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="admin-close"
            aria-label={t('dialog.cancel')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {/* General */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('admin.general')}</h3>
            <label className={styles.row}>
              <span>{t('admin.language')}</span>
              <select className={styles.control} value={settings.language} disabled>
                <option value="en">English</option>
              </select>
            </label>
          </section>

          {/* Export defaults */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('admin.export')}</h3>
            <label className={styles.row}>
              <span>{t('admin.stlFormat')}</span>
              <select
                className={styles.control}
                data-testid="admin-stl-format"
                value={settings.stlFormat}
                onChange={(e) => {
                  update({ stlFormat: e.target.value as StlFormat });
                }}
              >
                <option value="binary">{t('stl.format.binary')}</option>
                <option value="ascii">{t('stl.format.ascii')}</option>
              </select>
            </label>
            <label className={styles.row}>
              <span>{t('admin.linear')}</span>
              <input
                className={styles.control}
                type="number"
                min={0.001}
                step={0.01}
                value={settings.stlLinearDeflectionMm}
                onChange={(e) => {
                  update({ stlLinearDeflectionMm: Number(e.target.value) });
                }}
              />
            </label>
            <label className={styles.row}>
              <span>{t('admin.angular')}</span>
              <input
                className={styles.control}
                type="number"
                min={1}
                step={1}
                value={settings.stlAngularDeflectionDeg}
                onChange={(e) => {
                  update({ stlAngularDeflectionDeg: Number(e.target.value) });
                }}
              />
            </label>
          </section>

          {/* Retention */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('admin.retention')}</h3>
            <label className={styles.row}>
              <span>{t('admin.keepProject')}</span>
              <select
                className={styles.control}
                data-testid="admin-ttl"
                value={
                  settings.autosaveTtlDays === null ? 'never' : String(settings.autosaveTtlDays)
                }
                onChange={(e) => {
                  update({
                    autosaveTtlDays: e.target.value === 'never' ? null : Number(e.target.value),
                  });
                }}
              >
                {TTL_OPTIONS.map((o) => (
                  <option key={o.key} value={o.value === null ? 'never' : String(o.value)}>
                    {t(o.key)}
                  </option>
                ))}
              </select>
            </label>
            <p className={styles.hint}>{t('admin.retention.hint')}</p>
          </section>

          {/* File naming */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('admin.naming')}</h3>
            <label className={styles.row}>
              <span>{t('admin.namingBase')}</span>
              <input
                className={styles.control}
                type="text"
                data-testid="admin-naming-base"
                value={settings.namingBase}
                onChange={(e) => {
                  update({ namingBase: e.target.value });
                }}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.namingIncludeProjectName}
                onChange={(e) => {
                  update({ namingIncludeProjectName: e.target.checked });
                }}
              />
              {t('admin.namingProject')}
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.namingIncludeDate}
                onChange={(e) => {
                  update({ namingIncludeDate: e.target.checked });
                }}
              />
              {t('admin.namingDate')}
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.namingIncludeRevision}
                onChange={(e) => {
                  update({ namingIncludeRevision: e.target.checked });
                }}
              />
              {t('admin.namingRevision')}
            </label>
            {settings.namingIncludeRevision && (
              <label className={styles.row}>
                <span>{t('admin.revisionNumber')}</span>
                <input
                  className={styles.control}
                  type="number"
                  min={1}
                  step={1}
                  value={settings.namingRevision}
                  onChange={(e) => {
                    update({ namingRevision: Math.max(1, Math.round(Number(e.target.value))) });
                  }}
                />
              </label>
            )}
            <p className={styles.preview} data-testid="admin-name-preview">
              {t('admin.namingPreview')} <code>{previewName}</code>
            </p>
          </section>

          {/* Privacy */}
          {isErrorReportingAvailable() && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t('admin.privacy')}</h3>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  defaultChecked={isErrorReportingEnabled()}
                  onChange={(e) => {
                    setErrorReporting(e.target.checked);
                  }}
                />
                {t('support.crashReports')}
              </label>
            </section>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.reset} data-testid="admin-reset" onClick={reset}>
            {t('admin.reset')}
          </button>
          <span className={styles.footNote}>{t('admin.savedNote')}</span>
        </div>
      </div>
    </div>
  );
}
