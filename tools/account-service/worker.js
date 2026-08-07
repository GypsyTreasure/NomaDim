// Cloudflare Worker: NomaDim account + license service (M13, ADR-0124).
//
// Lives OUTSIDE the app bundle; deployed separately (wrangler). Touched only at
// register / log in / lease-renew / device management — never on the app's hot
// path, so the client still runs fully offline (prime directive #7).
//
// Auth is a simple INTERNAL email + password scheme (no third-party providers):
// passwords are hashed with PBKDF2-SHA256 (per-account random salt) and never
// stored in the clear; sign-in returns an opaque bearer session token whose
// SHA-256 hash is the only thing persisted.
//
// Secrets (Worker secrets, NEVER in the repo or the client):
//   NOMADIM_LICENSE_PRIVATE_KEY  Ed25519 PKCS8 base64 — signs leases (same key
//                                whose PUBLIC half is baked into the app).
//   SESSION_TTL_DAYS (optional, default 60)
// Bindings: DB (D1, see schema.sql).
//
// Anti-piracy model: leases are device-bound Ed25519 tokens valid ~LEASE_DAYS,
// renewed silently by the app; a per-account device cap limits sharing; revoke
// kills a leaked device at its next renewal. No constant online check.

const LEASE_DAYS = 30;
const MAX_DEVICES = 3; // owner-tunable device cap per account
const PRODUCT = 'nomadim';
const PBKDF2_ITERATIONS = 210_000; // OWASP-recommended floor for PBKDF2-SHA256
const MIN_PASSWORD_LEN = 8;

const CORS = {
  'access-control-allow-origin': '*', // TODO(owner): pin to the app origin
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Password hashing (PBKDF2-SHA256) --------------------------------------
async function hashPassword(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    keyMaterial,
    256
  );
  return b64(bits);
}

// Constant-time compare (both operands are fixed-length base64 digests).
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normalizeEmail(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sign a device-bound Pro lease with the Worker's private key. The payload
// shape matches the app's LicensePayload (license.ts): the app verifies it
// offline against the baked PUBLIC key.
async function signLease(env, account, deviceId, deviceLabel) {
  const now = new Date();
  const expires = new Date(now.getTime() + LEASE_DAYS * 86400_000);
  const payload = {
    email: account.email,
    orderId: account.order_id || `acct:${account.id}`,
    product: PRODUCT,
    tier: 'pro',
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    accountId: account.id,
    deviceId,
    deviceLabel,
  };
  const seg = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const pkcs8 = fromB64(env.NOMADIM_LICENSE_PRIVATE_KEY);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(seg));
  return `${seg}.${b64url(sig)}`;
}

// Mint an opaque bearer session; store only its SHA-256 hash; return the raw token.
async function mintSession(env, accountId) {
  const raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const ttlDays = Number(env.SESSION_TTL_DAYS ?? 60);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 86400_000);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(await sha256Hex(raw), accountId, now.toISOString(), expires.toISOString())
    .run();
  return raw;
}

function profileOf(account) {
  return { id: account.id, email: account.email, paid: account.paid === 1 };
}

async function accountForSession(env, request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(hash, new Date().toISOString())
    .first();
  return row ?? null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // --- Auth: internal email + password ---------------------------------
    // POST /auth/register {email, password} → { session, account }
    if (path === '/auth/register' && request.method === 'POST') {
      const { email: rawEmail, password } = await request.json().catch(() => ({}));
      const email = normalizeEmail(rawEmail);
      if (
        !EMAIL_RE.test(email) ||
        typeof password !== 'string' ||
        password.length < MIN_PASSWORD_LEN
      ) {
        return json({ error: 'invalidInput' }, 400);
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const passwordHash = await hashPassword(password, salt);
      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      try {
        await env.DB.prepare(
          `INSERT INTO accounts
             (id, email, password_hash, password_salt, iterations, paid, order_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`
        )
          .bind(id, email, passwordHash, b64(salt), PBKDF2_ITERATIONS, nowIso, nowIso)
          .run();
      } catch (e) {
        // UNIQUE(email) violation → already registered.
        if (String(e).includes('UNIQUE')) return json({ error: 'emailTaken' }, 409);
        return json({ error: 'server' }, 500);
      }
      const account = { id, email, paid: 0, order_id: null };
      const session = await mintSession(env, id);
      return json({ session, account: profileOf(account) });
    }

    // POST /auth/login {email, password} → { session, account }
    if (path === '/auth/login' && request.method === 'POST') {
      const { email: rawEmail, password } = await request.json().catch(() => ({}));
      const email = normalizeEmail(rawEmail);
      if (!email || typeof password !== 'string' || !password) {
        return json({ error: 'invalidInput' }, 400);
      }
      const account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?')
        .bind(email)
        .first();
      if (!account) return json({ error: 'badCredentials' }, 401);
      const candidate = await hashPassword(
        password,
        fromB64(account.password_salt),
        account.iterations || PBKDF2_ITERATIONS
      );
      if (!timingSafeEqual(candidate, account.password_hash)) {
        return json({ error: 'badCredentials' }, 401);
      }
      const session = await mintSession(env, account.id);
      return json({ session, account: profileOf(account) });
    }

    if (path === '/auth/signout' && request.method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token)
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
          .bind(await sha256Hex(token))
          .run();
      return json({ ok: true });
    }

    // --- Authenticated endpoints -----------------------------------------
    const account = await accountForSession(env, request);
    if (!account) return json({ error: 'unauthorized' }, 401);

    // GET /account → profile
    if (path === '/account' && request.method === 'GET') {
      return json(profileOf(account));
    }

    // POST /license/lease {deviceId, deviceLabel} → { token }
    if (path === '/license/lease' && request.method === 'POST') {
      if (account.paid !== 1) return json({ error: 'notPaid' }, 402);
      const { deviceId, deviceLabel } = await request.json();
      if (!deviceId) return json({ error: 'deviceId required' }, 400);
      const nowIso = new Date().toISOString();
      // Enforce the device cap: allow if this device already has a slot, else
      // require room under MAX_DEVICES.
      const existing = await env.DB.prepare(
        'SELECT device_id FROM devices WHERE account_id = ? AND revoked = 0'
      )
        .bind(account.id)
        .all();
      const ids = (existing.results ?? []).map((r) => r.device_id);
      if (!ids.includes(deviceId) && ids.length >= MAX_DEVICES) {
        return json({ error: 'deviceLimit', max: MAX_DEVICES }, 409);
      }
      await env.DB.prepare(
        `INSERT INTO devices (account_id, device_id, label, last_seen, revoked)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(account_id, device_id)
         DO UPDATE SET label = excluded.label, last_seen = excluded.last_seen, revoked = 0`
      )
        .bind(account.id, deviceId, deviceLabel ?? '', nowIso)
        .run();
      const token = await signLease(env, account, deviceId, deviceLabel ?? '');
      return json({ token });
    }

    // GET /devices → list
    if (path === '/devices' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT device_id, label, last_seen FROM devices WHERE account_id = ? AND revoked = 0'
      )
        .bind(account.id)
        .all();
      return json(
        (rows.results ?? []).map((r) => ({
          deviceId: r.device_id,
          label: r.label,
          lastSeen: r.last_seen,
        }))
      );
    }

    // DELETE /devices/:id → revoke
    if (path.startsWith('/devices/') && request.method === 'DELETE') {
      const deviceId = decodeURIComponent(path.slice('/devices/'.length));
      await env.DB.prepare('UPDATE devices SET revoked = 1 WHERE account_id = ? AND device_id = ?')
        .bind(account.id, deviceId)
        .run();
      return json({ ok: true });
    }

    return json({ error: 'not found', path }, 404);
  },

  // Separate route on a DIFFERENT hostname/binding in production: the MoR
  // purchase webhook. Marks an account (by email) paid. TODO(owner): verify the
  // MoR signature before trusting. Kept here for reference.
  async purchaseWebhook(request, env) {
    const event = await request.json();
    const email = normalizeEmail(event.email ?? event.data?.customer?.email);
    const orderId = String(event.orderId ?? event.data?.id ?? '');
    if (!email) return new Response('bad request', { status: 400 });
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE accounts SET paid = 1, order_id = ?, updated_at = ? WHERE email = ?`
    )
      .bind(orderId, nowIso, email)
      .run();
    return new Response('ok');
  },
};
