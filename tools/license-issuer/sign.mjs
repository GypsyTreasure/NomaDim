// Signs a NomaDim Pro license token (M11, ADR-0081). Out of the app bundle.
// Usage: NOMADIM_LICENSE_PRIVATE_KEY=<pkcs8-b64> \
//   node tools/license-issuer/sign.mjs <email> <orderId>
// Prints the token to paste into the app's License dialog.
import { webcrypto as crypto } from 'node:crypto';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const [, , email, orderId] = process.argv;
const privB64 = process.env.NOMADIM_LICENSE_PRIVATE_KEY;
if (!email || !orderId || !privB64) {
  console.error('Usage: NOMADIM_LICENSE_PRIVATE_KEY=… node sign.mjs <email> <orderId>');
  process.exit(1);
}
const payload = {
  email,
  orderId,
  product: 'nomadim',
  tier: 'pro',
  issuedAt: new Date().toISOString(),
};
const seg = b64url(new TextEncoder().encode(JSON.stringify(payload)));
const key = await crypto.subtle.importKey(
  'pkcs8',
  Buffer.from(privB64, 'base64'),
  { name: 'Ed25519' },
  false,
  ['sign']
);
const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(seg));
console.log(`${seg}.${b64url(new Uint8Array(sig))}`);
