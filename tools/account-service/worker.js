// Cloudflare Worker: NomaDim account + license service (M13, ADR-0123).
//
// Lives OUTSIDE the app bundle; deployed separately (wrangler). Touched only at
// sign-in / lease-renew / device management — never on the app's hot path, so
// the client still runs fully offline (prime directive #7).
//
// Secrets (Worker secrets, NEVER in the repo or the client):
//   NOMADIM_LICENSE_PRIVATE_KEY  Ed25519 PKCS8 base64 — signs leases (same key
//                                whose PUBLIC half is baked into the app).
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
//   APPLE_CLIENT_ID (services id) / APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY
//     Sign in with Apple has no static client secret: build a short-lived ES256
//     JWT (header kid=APPLE_KEY_ID, iss=APPLE_TEAM_ID, sub=APPLE_CLIENT_ID)
//     signed with APPLE_PRIVATE_KEY as the client_secret in the token exchange.
//     Apple returns the user's name/email ONLY on the first authorization, so
//     upsert on that first callback and rely on the account id (sub) after.
//   ACCOUNT_ID_SALT              salt for hashing provider ids
//   SESSION_TTL_DAYS (optional, default 60)
// Bindings: DB (D1, see schema.sql).
//
// Anti-piracy model: leases are device-bound Ed25519 tokens valid ~LEASE_DAYS,
// renewed silently by the app; a per-account device cap limits sharing; revoke
// kills a leaked device at its next renewal. No constant online check.

const LEASE_DAYS = 30;
const MAX_DEVICES = 3; // owner-tunable device cap per account
const PRODUCT = 'nomadim';

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

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
  const pkcs8 = Uint8Array.from(atob(env.NOMADIM_LICENSE_PRIVATE_KEY), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(seg));
  return `${seg}.${b64url(sig)}`;
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

    // --- OAuth ------------------------------------------------------------
    // GET /auth/:provider/start?return=<app>&device=<id>
    //   Redirect to Google/GitHub with state = {return, device}. TODO(owner):
    //   build the provider authorize URL from GOOGLE_/GITHUB_CLIENT_ID.
    // GET /auth/:provider/callback?code=...&state=...
    //   Exchange code → profile, upsert account, mint a session, then redirect
    //   to `${return}#session=<token>` (fragment, not query).
    if (path.startsWith('/auth/') && path.endsWith('/start')) {
      return json({ todo: 'build provider authorize redirect', path }, 501);
    }
    if (path.startsWith('/auth/') && path.endsWith('/callback')) {
      return json({ todo: 'exchange code, upsert account, redirect with #session' }, 501);
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
      return json({
        id: account.id,
        email: account.email,
        name: account.name ?? '',
        avatarUrl: account.avatar_url ?? undefined,
        provider: account.provider,
        paid: account.paid === 1,
      });
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
    const email = event.email ?? event.data?.customer?.email;
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
