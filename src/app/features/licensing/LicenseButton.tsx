import { useState } from 'react';
import { t } from '../../i18n/t';
import { pushToast } from '../../store/toastStore';
import { useEntitlementStore } from '../../store/entitlementStore';
import { useAccountStore } from '../../store/accountStore';
import type { AccountError } from '../account/authClient';
import { IconButton } from '../ui/IconButton';
import { DialogFrame } from '../timeline/dialogShared';
import styles from '../sketcher/Sketcher.module.css';

/**
 * License + account menu (M11 + M13). Always offers the offline paste-a-key
 * path (verified with WebCrypto Ed25519, persisted, no network — GYP$Y works
 * here). When the account service is configured (M13, ADR-0124), it ALSO offers
 * a simple internal email + password login (register / log in), which leases a
 * device-bound Pro token and shows account status. Unconfigured builds show
 * exactly the M11 dialog.
 */

function accountErrorMessage(error: AccountError): string {
  switch (error.kind) {
    case 'emailTaken':
      return t('account.errEmailTaken');
    case 'badCredentials':
      return t('account.errBadCredentials');
    case 'invalidInput':
      return t('account.errInvalidInput');
    case 'notPaid':
      return t('account.notPaid');
    case 'network':
      return t('account.errNetwork');
    case 'unconfigured':
    case 'unauthorized':
    case 'server':
      return t('account.errServer');
  }
}

export function LicenseButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const tier = useEntitlementStore((s) => s.tier);
  const license = useEntitlementStore((s) => s.license);
  const activate = useEntitlementStore((s) => s.activate);
  const deactivate = useEntitlementStore((s) => s.deactivate);
  const [key, setKey] = useState('');

  const accountConfigured = useAccountStore((s) => s.configured);
  const account = useAccountStore((s) => s.account);
  const accountStatus = useAccountStore((s) => s.status);
  const registerAccount = useAccountStore((s) => s.register);
  const loginAccount = useAccountStore((s) => s.login);
  const accountSignOut = useAccountStore((s) => s.signOut);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const isPro = tier === 'pro';
  const busy = accountStatus === 'working';
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

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

  const runAuth = (fn: (e: string, p: string) => Promise<{ ok: boolean }>): void => {
    if (!canSubmit) return;
    void fn(email.trim(), password).then((result) => {
      if (result.ok) {
        pushToast(t('account.loggedIn'), 'success');
        setPassword('');
      } else {
        const errored = useAccountStore.getState().error;
        pushToast(errored ? accountErrorMessage(errored) : t('account.errServer'), 'error');
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
                  <input
                    className={styles.licenseInput}
                    data-testid="account-email"
                    type="email"
                    autoComplete="email"
                    aria-label={t('account.email')}
                    placeholder={t('account.email')}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                    }}
                  />
                  <input
                    className={styles.licenseInput}
                    data-testid="account-password"
                    type="password"
                    autoComplete="current-password"
                    aria-label={t('account.password')}
                    placeholder={t('account.password')}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    className={styles.button}
                    data-testid="account-login"
                    disabled={!canSubmit}
                    onClick={() => {
                      runAuth(loginAccount);
                    }}
                  >
                    {t('account.login')}
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    data-testid="account-register"
                    disabled={!canSubmit}
                    onClick={() => {
                      runAuth(registerAccount);
                    }}
                  >
                    {t('account.register')}
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
