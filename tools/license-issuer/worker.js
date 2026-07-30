// Cloudflare Worker: Merchant-of-Record webhook → sign + email a Pro license
// (M11, ADR-0081). Lives OUTSIDE the app bundle; deployed separately. The
// private key is a Worker secret (NOMADIM_LICENSE_PRIVATE_KEY, PKCS8 base64),
// never in the repo or the client. VAT/refunds are handled by the MoR (Paddle
// or Lemon Squeezy), so there is no tax logic here.
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    // TODO(owner): verify the MoR webhook signature (Paddle/Lemon Squeezy) here
    // before issuing — reject unsigned/replayed events.
    const event = await request.json();
    const email = event.email ?? event.data?.customer?.email;
    const orderId = event.orderId ?? event.data?.id;
    if (!email || !orderId) return new Response('Bad Request', { status: 400 });

    const payload = {
      email,
      orderId: String(orderId),
      product: 'nomadim',
      tier: 'pro',
      issuedAt: new Date().toISOString(),
    };
    const seg = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey(
      'pkcs8',
      Uint8Array.from(atob(env.NOMADIM_LICENSE_PRIVATE_KEY), (c) => c.charCodeAt(0)),
      { name: 'Ed25519' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(seg));
    const token = `${seg}.${b64url(sig)}`;
    // TODO(owner): email `token` to `email` via your provider (Resend/SES/…).
    return new Response(JSON.stringify({ token }), {
      headers: { 'content-type': 'application/json' },
    });
  },
};
