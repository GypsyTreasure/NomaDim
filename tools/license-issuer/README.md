# NomaDim license issuer (M11, ADR-0081)

Out-of-bundle tooling that issues **offline-verifiable** Pro license keys. None
of this ships in the app; the app only carries the **public** key and verifies
signatures locally (WebCrypto Ed25519), so it needs no backend at runtime.

## One-time setup

1. `node keygen.mjs` (offline) → prints a PUBLIC and a PRIVATE key.
2. Paste PUBLIC into `LICENSE_PUBLIC_KEY_B64` in
   `src/app/features/licensing/license.ts` and redeploy the app.
3. Store PRIVATE as the issuer secret `NOMADIM_LICENSE_PRIVATE_KEY`
   (PKCS8 base64). **Never commit it.**

## Issue a key by hand

```
NOMADIM_LICENSE_PRIVATE_KEY=<pkcs8-b64> node sign.mjs buyer@example.com ORDER-123
```

Paste the printed token into the app's **License** dialog → Pro unlocks offline.

## Automated (Merchant of Record)

`worker.js` is a Cloudflare Worker that turns a Paddle / Lemon Squeezy purchase
webhook into a signed token and emails it. The MoR handles EU VAT + refunds, so
there is no tax logic in the app or the worker. Deploy separately with the
private key as a Worker secret; verify the MoR webhook signature before issuing.

**Owner-confirm:** Merchant of Record (Paddle vs Lemon Squeezy) and the email
provider. Defaults documented in ADR-0081.
