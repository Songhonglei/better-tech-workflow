import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { randomToken } from './store.mjs';

function secureUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' &&
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('OIDC endpoints require HTTPS');
  }
  return url;
}

export function createOIDC(provider, origin) {
  const prefix = provider === 'openai' ? 'OPENAI' : 'OIDC';
  const issuer = process.env[`${prefix}_ISSUER`] || (provider === 'openai' ? 'https://auth.openai.com' : '');
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const secret = process.env[`${prefix}_CLIENT_SECRET`];
  const method = process.env[`${prefix}_TOKEN_AUTH_METHOD`] || (secret ? 'client_secret_basic' : 'none');
  if (!issuer || !clientId) throw new Error(`${prefix}_ISSUER / ${prefix}_CLIENT_ID not configured`);
  if (!['none', 'client_secret_basic'].includes(method) || method === 'client_secret_basic' && !secret) {
    throw new Error('Unsupported or incomplete token authentication method');
  }
  const redirectUri = new URL('/api/auth/callback', origin).href;
  let cached;
  async function metadata() {
    if (cached && cached.expires > Date.now()) return cached;
    const response = await fetch(secureUrl(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration'),
      { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error('OIDC discovery failed');
    const doc = await response.json();
    if (doc.issuer !== issuer) throw new Error('OIDC issuer mismatch');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) secureUrl(doc[key]);
    if (doc.token_endpoint_auth_methods_supported && !doc.token_endpoint_auth_methods_supported.includes(method)) {
      throw new Error('OIDC token authentication method not supported');
    }
    const options = { timeoutDuration: 10_000 };
    cached = { doc, keys: createRemoteJWKSet(new URL(doc.jwks_uri), options), expires: Date.now() + 3600_000 };
    return cached;
  }
  return {
    async start() {
      const { doc } = await metadata();
      const payload = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
      const target = new URL(doc.authorization_endpoint);
      target.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
        response_type: 'code', scope: 'openid profile email', state: payload.state, nonce: payload.nonce,
        code_challenge: createHash('sha256').update(payload.verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      return { payload, url: target.href };
    },
    async finish(callback, tx) {
      if (!tx || callback.searchParams.get('state') !== tx.state || callback.searchParams.has('error')) throw new Error('Invalid OIDC transaction');
      const code = callback.searchParams.get('code');
      if (!code) throw new Error('Missing authorization code');
      const { doc, keys } = await metadata();
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        code_verifier: tx.verifier, client_id: clientId });
      const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
      if (method === 'client_secret_basic') {
        const form = value => new URLSearchParams({ v: value }).toString().slice(2);
        headers.authorization = 'Basic ' + Buffer.from(`${form(clientId)}:${form(secret)}`).toString('base64');
      }
      const response = await fetch(doc.token_endpoint, { method: 'POST', headers, body,
        signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!response.ok) throw new Error('OIDC token exchange failed');
      const tokens = await response.json();
      if (typeof tokens.id_token !== 'string') throw new Error('Missing ID token');
      const { payload } = await jwtVerify(tokens.id_token, keys, { issuer, audience: clientId,
        algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
      if (payload.nonce !== tx.nonce || typeof payload.sub !== 'string' || !payload.sub ||
          Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) throw new Error('Invalid identity claims');
      return { provider, issuer, clientId, subject: payload.sub,
        name: typeof payload.name === 'string' ? payload.name.slice(0, 100) : '用户' };
    },
  };
}
