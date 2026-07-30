// One-off keypair generator for NomaDim Pro licenses (M11, ADR-0081).
// Run OFFLINE: `node tools/license-issuer/keygen.mjs`
// - Prints the PUBLIC key (base64) → paste into LICENSE_PUBLIC_KEY_B64
//   (src/app/features/licensing/license.ts).
// - Prints the PRIVATE key (base64 PKCS8) → store as the issuer's
//   NOMADIM_LICENSE_PRIVATE_KEY secret. NEVER commit it.
import { webcrypto as crypto } from 'node:crypto';

const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
const priv = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
console.log('PUBLIC  (bake into the app):', pub);
console.log('PRIVATE (issuer secret, keep offline):', priv);
