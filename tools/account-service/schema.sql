-- NomaDim account + license service — Cloudflare D1 schema (M13, ADR-0124).
-- Apply with: wrangler d1 execute nomadim-accounts --file=./schema.sql
--
-- No secrets live here. The Ed25519 PRIVATE key that signs leases is a Worker
-- secret (NOMADIM_LICENSE_PRIVATE_KEY), never in the DB or the repo. Passwords
-- are stored only as PBKDF2-SHA256 hashes with a per-account random salt.

-- One row per registered person, keyed by a random UUID. Auth is internal email
-- + password (no third-party providers). `paid` is the entitlement flag set by
-- the Merchant-of-Record purchase webhook.
CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,           -- random UUID
  email          TEXT NOT NULL UNIQUE,       -- normalized (trimmed, lowercased)
  password_hash  TEXT NOT NULL,              -- base64(PBKDF2-SHA256(password, salt))
  password_salt  TEXT NOT NULL,              -- base64 per-account random salt
  iterations     INTEGER NOT NULL,           -- PBKDF2 iteration count used
  paid           INTEGER NOT NULL DEFAULT 0, -- 0 free, 1 has a Pro entitlement
  order_id       TEXT,                       -- MoR order backing `paid` (audit)
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Opaque session tokens (bearer). Rotate/expire server-side; the app treats the
-- string as opaque. Store only a hash of the token, never the token itself.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,          -- sha256(bearer token)
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

-- Devices that currently hold a lease for an account. The per-account count is
-- the device cap (see MAX_DEVICES in worker.js); revoking a row frees a slot
-- and the device drops to free at its next launch / lease lapse.
CREATE TABLE IF NOT EXISTS devices (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  device_id   TEXT NOT NULL,             -- the app's local deviceId
  label       TEXT,
  last_seen   TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_devices_account ON devices(account_id);
