import { useState } from 'react';
import { t } from '../../i18n/t';
import { pushToast } from '../../store/toastStore';
import { useEntitlementStore } from '../../store/entitlementStore';
import { DialogFrame } from '../timeline/dialogShared';
import styles from '../sketcher/Sketcher.module.css';

/**
 * License menu + dialog (M11). Shows the current tier and lets the user paste a
 * Pro license key, which is verified **offline** (WebCrypto Ed25519) and, on
 * success, persisted so Pro survives reloads with no network. Invalid keys fail
 * closed with a toast; Pro can be removed to return to free.
 */
export function LicenseButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const tier = useEntitlementStore((s) => s.tier);
  const license = useEntitlementStore((s) => s.license);
  const activate = useEntitlementStore((s) => s.activate);
  const deactivate = useEntitlementStore((s) => s.deactivate);
  const [key, setKey] = useState('');

  const isPro = tier === 'pro';

  const onActivate = (): void => {
    void activate(key.trim()).then((result) => {
      if (result.ok) {
        pushToast(t('license.activated'), 'success');
        setKey('');
        setOpen(false);
      } else {
        pushToast(t('license.invalid'), 'error');
      }
    });
  };

  return (
    <>
      <button
        type="button"
        className={styles.button}
        title={t('license.title')}
        data-testid="license-open"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('license.menu')} · {isPro ? t('license.pro') : t('license.free')}
      </button>
      {open && (
        <DialogFrame
          title={t('license.title')}
          okDisabled={!isPro && key.trim().length === 0}
          onOk={
            isPro
              ? () => {
                  setOpen(false);
                }
              : onActivate
          }
          onCancel={() => {
            setOpen(false);
          }}
        >
          {isPro ? (
            <div className={styles.licenseBody} data-testid="license-status">
              <p>{t('license.statusPro')}</p>
              {license && <p className={styles.licenseEmail}>{license.email}</p>}
              <button
                type="button"
                className={styles.button}
                data-testid="license-remove"
                onClick={() => {
                  deactivate();
                  pushToast(t('license.free'), 'info');
                }}
              >
                {t('license.remove')}
              </button>
            </div>
          ) : (
            <div className={styles.licenseBody} data-testid="license-status">
              <p>{t('license.statusFree')}</p>
              <textarea
                className={styles.licenseInput}
                data-testid="license-key"
                aria-label={t('license.enter')}
                placeholder={t('license.enter')}
                rows={4}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                }}
              />
            </div>
          )}
        </DialogFrame>
      )}
    </>
  );
}
