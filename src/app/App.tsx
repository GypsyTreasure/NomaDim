import { Viewport } from '../viewport';
import { t } from './i18n/t';
import styles from './App.module.css';

export function App(): React.JSX.Element {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('app.title')}</h1>
      </header>
      <main className={styles.viewportArea}>
        <Viewport zoomToFitLabel={t('viewport.zoomToFit')} />
      </main>
    </div>
  );
}
