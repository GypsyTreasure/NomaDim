import { useEffect, useState } from 'react';
import { documentToXml } from '../../../document';
import { t } from '../../i18n/t';
import { useDocumentStore } from '../../store/documentStore';
import { pushToast } from '../../store/toastStore';
import { loadDocumentText } from '../document-io/documentIO';
import { IconButton } from '../ui/IconButton';
import { DialogFrame } from '../timeline/dialogShared';
import sketcherStyles from '../sketcher/Sketcher.module.css';
import {
  PROJECT_EXT,
  isFolderAccessSupported,
  useFolderStore,
  type ProjectFile,
} from './folderStore';

/**
 * PROJECTS button + browser (ADR-0089): lists `.nomadim.xml` files in the
 * user-chosen local folder (Settings → Project folder) and opens one through
 * the normal document load path, and saves the current project into the folder.
 * Self-contained (button + dialog + open state), like Settings/License.
 * Shortcut "Shift+P" (master rule, ADR-0032), ignored while typing in a field.
 */

/** Turns a project name into a filesystem-safe base name for `<name>.nomadim.xml`. */
function fileNameFor(projectName: string): string {
  const base = projectName.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${base || 'MyPart'}${PROJECT_EXT}`;
}

export function ProjectsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [busy, setBusy] = useState(false);
  const folderName = useFolderStore((s) => s.name);
  const list = useFolderStore((s) => s.list);
  const read = useFolderStore((s) => s.read);
  const saveToFolder = useFolderStore((s) => s.save);
  const doc = useDocumentStore((s) => s.document);
  const supported = isFolderAccessSupported();

  const refresh = (): void => {
    if (!folderName) {
      setFiles([]);
      return;
    }
    setBusy(true);
    void list()
      .then((found) => {
        setFiles(found);
      })
      .catch(() => {
        setFiles([]);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  // Load the list whenever the dialog opens or the folder changes. State is set
  // only inside the async callbacks (never synchronously in the effect body).
  useEffect(() => {
    if (!open || !folderName) return undefined;
    let cancelled = false;
    void list()
      .then((found) => {
        if (!cancelled) setFiles(found);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, folderName, list]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'P') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const openProject = (name: string): void => {
    setBusy(true);
    void read(name)
      .then((text) => {
        const error = loadDocumentText(text);
        if (error !== null) pushToast(`${t('projects.loadError')} ${error}`, 'error');
        else setOpen(false);
      })
      .catch((e: unknown) => {
        pushToast(`${t('projects.loadError')} ${String(e)}`, 'error');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const saveHere = (): void => {
    setBusy(true);
    void saveToFolder(fileNameFor(doc.name), documentToXml(doc))
      .then(() => {
        pushToast(t('projects.saved'), 'info');
        refresh();
      })
      .catch((e: unknown) => {
        pushToast(`${t('projects.saveError')} ${String(e)}`, 'error');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <IconButton
        icon="projects"
        label={t('projects.menu')}
        shortcut="Shift+P"
        testid="projects-open"
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <DialogFrame
          title={t('projects.title')}
          okDisabled
          onOk={() => {
            setOpen(false);
          }}
          onCancel={() => {
            setOpen(false);
          }}
        >
          {!supported ? (
            <p className={sketcherStyles.importHint}>{t('projects.unsupported')}</p>
          ) : !folderName ? (
            <p className={sketcherStyles.importHint}>{t('projects.noFolder')}</p>
          ) : (
            <>
              <div className={sketcherStyles.layerActions}>
                <button
                  type="button"
                  className={sketcherStyles.button}
                  data-testid="projects-save-here"
                  disabled={busy}
                  onClick={saveHere}
                >
                  {t('projects.saveHere')}
                </button>
                <button
                  type="button"
                  className={sketcherStyles.button}
                  data-testid="projects-refresh"
                  disabled={busy}
                  onClick={refresh}
                >
                  {t('projects.refresh')}
                </button>
              </div>
              {files.length === 0 ? (
                <p className={sketcherStyles.importHint}>{t('projects.empty')}</p>
              ) : (
                <div className={sketcherStyles.sampleList} data-testid="projects-list">
                  {files.map((file) => (
                    <button
                      key={file.name}
                      type="button"
                      className={sketcherStyles.sampleCard}
                      data-testid={`project-${file.label}`}
                      disabled={busy}
                      onClick={() => {
                        openProject(file.name);
                      }}
                    >
                      <span className={sketcherStyles.sampleName}>{file.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </DialogFrame>
      )}
    </>
  );
}
