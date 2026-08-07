# NomaDim account + license service (M13)

A tiny **Cloudflare Worker + D1** that adds user accounts and device-bound Pro
leases on top of the offline license model (M11, ADR-0081). It runs **outside**
the app bundle and is contacted **only** at register / log in, lease-renew, and
device management — never on the app's hot path, so the client keeps running
fully offline (prime directive #7).

See `ADR-0124` in `DECISIONS.md` for the design rationale (it supersedes the
third-party-login part of ADR-0123 with a simple internal login).

## What it does

- **Register / log in with email + password** → creates or authenticates an
  account. Passwords are hashed with **PBKDF2-SHA256** (per-account random salt,
  210k iterations) and never stored in the clear. No third-party providers.
- **Issues a device-bound Pro lease** — an Ed25519-signed token (same format the
  app already verifies offline) that carries `accountId`, `deviceId`, and an
  `expiresAt` ~30 days out. The app renews it silently when online and keeps
  working through an offline grace window; a leaked/revoked device simply stops
  renewing.
- **Device cap + revoke** — `MAX_DEVICES` per account (default 3); revoking a
  device frees a slot and drops that device to free at its next launch.
- **Purchase webhook** — a Merchant-of-Record (Paddle / Lemon Squeezy) purchase
  marks the account `paid`. VAT/refunds stay the MoR's responsibility.

The app decides Free vs Pro **entirely offline** by verifying the lease's
signature against the baked-in public key (`LICENSE_PUBLIC_KEY_B64`) — the
service can't be spoofed without the private key, and there's no runtime ping.

## Cracker-resistance (what this buys)

- Tokens are **Ed25519-signed** — unforgeable without the Worker's private key.
- Tokens are **device-bound** — a copied token is inert on another machine.
- Tokens are **short leases** — a leaked token dies in ≤ `LEASE_DAYS` + grace and
  can't renew without the account; abuse (one device, many IPs) is revocable.
- It is **not** Fusion-style constant verification: normal use never blocks on
  the network, and offline sessions keep working through the grace window.

## Deploy (owner steps)

1. `npm i -g wrangler` and `wrangler login`.
2. Create the D1 DB and apply the schema:
   ```
   wrangler d1 create nomadim-accounts
   wrangler d1 execute nomadim-accounts --file=./schema.sql
   ```
3. Generate the license keypair (reuse the M11 issuer keygen) and set the one
   required secret:
   ```
   wrangler secret put NOMADIM_LICENSE_PRIVATE_KEY   # Ed25519 PKCS8 base64
   # optional:
   wrangler secret put SESSION_TTL_DAYS              # default 60
   ```
   Bake the matching **public** key into the app (`src/app/features/licensing/license.ts`,
   `LICENSE_PUBLIC_KEY_B64`).
4. `wrangler deploy` (bind the D1 database as `DB` and set an
   `access-control-allow-origin` pinned to the app origin).
5. Build the app with the service URL so the accounts UI turns on:
   ```
   VITE_ACCOUNT_SERVICE_URL="https://accounts.your-domain.workers.dev" npm run build
   ```
   With it unset, the app shows the classic paste-a-key dialog only (current behaviour).

No OAuth apps, client IDs, or external identity providers are needed — the login
system is fully self-contained. Cloudflare is the only external dependency.

## What's a stub vs done

- **Done:** register + log in (PBKDF2 hashing, opaque sessions), routing, lease
  signing (matches the app's payload), device cap + revoke, session lookup,
  sign-out, and the D1 schema.
- **TODO(owner):** the MoR webhook **signature verification** (the handler marks
  an account paid but does not yet verify the provider signature) and pinning
  CORS `access-control-allow-origin` to the app origin. A password-reset flow
  needs an email provider and is intentionally not included yet.

## Security notes

- The **private key never leaves the Worker** (a secret). The repo/app hold only
  the public key. CI greps `dist/` for private-key material and fails the build
  if any is found (`.github/workflows/ci.yml`).
- **Passwords** are stored only as PBKDF2-SHA256 hashes with a per-account random
  salt; the raw password is never persisted or logged. Login uses a constant-time
  digest compare.
- Sessions are opaque bearer tokens; only their SHA-256 hash is stored.
- `GYP$Y` remains a universal offline evaluation key in the app, independent of
  this service.
