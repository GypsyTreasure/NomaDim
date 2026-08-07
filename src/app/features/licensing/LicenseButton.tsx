import { useState } from 'react';
import { t } from '../../i18n/t';
import { pushToast } from '../../store/toastStore';
import { useEntitlementStore } from '../../store/entitlementStore';
import { useAccountStore } from '../../store/accountStore';
import { IconButton } from '../ui/IconButton';
import { DialogFrame } from '../timeline/dialogShared';
import styles from '../sketcher/Sketcher.module.css';

/**
 * License + account menu (M11 + M13). Always offers the offline paste-a-key
 * path (verified with WebCrypto Ed25519, persisted, no network — GYP$Y works
 * here). When the account service is configured (M13), it ALSO offers Sign in
 * with Google/GitHub, which leases a device-bound Pro token and shows account
 * status + device management. Unconfigured builds show exactly the M11 dialog.
 */
export function LicenseButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const tier = useEntitlementStore((s) => s.tier);
  const license = useEntitlementStore((s) => s.license);
  const activate = useEntitlementStore((s) => s.activate);
  const deactivate = useEntitlementStore((s) => s.deactivate);
  const [key, setKey] = useState('');

  const accountConfigured = useAccountStore((s) => s.configured);
  const account = useAccountStore((s) => s.account);
  const signIn = useAccountStore((s) => s.signIn);
  const accountSignOut = useAccountStore((s) => s.signOut);

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
      <IconButton
        icon="license"
        label={`${t('license.menu')} · ${isPro ? t('license.pro') : t('license.free')}`}
        active={isPro}
        testid="license-open"
        onClick={() => {
          setOpen(true);
        }}
      />
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
          {accountConfigured && (
            <div className={styles.licenseBody} data-testid="account-section">
              {account ? (
                <>
                  <p className={styles.licenseEmail}>
                    {t('account.signedInAs')} {account.email}
                  </p>
                  {!account.paid && !isPro && <p>{t('account.notPaid')}</p>}
                  <button
                    type="button"
                    className={styles.button}
                    data-testid="account-signout"
                    onClick={accountSignOut}
                  >
                    {t('account.signOut')}
                  </button>
                </>
              ) : (
                <>
                  <p>{t('account.signInHint')}</p>
                  <button
                    type="button"
                    className={styles.button}
                    data-testid="signin-google"
                    onClick={() => {
                      signIn('google');
                    }}
                  >
                    {t('account.signInGoogle')}
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    data-testid="signin-apple"
                    onClick={() => {
                      signIn('apple');
                    }}
                  >
                    {t('account.signInApple')}
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    data-testid="signin-github"
                    onClick={() => {
                      signIn('github');
                    }}
                  >
                    {t('account.signInGithub')}
                  </button>
                </>
              )}
            </div>
          )}
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
              <p>{accountConfigured ? t('account.orKey') : t('license.statusFree')}</p>
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
