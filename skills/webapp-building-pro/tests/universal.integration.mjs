// Run after copying this file to a generated project's root: node --test universal.integration.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from './server/storage.mjs';
import { createOIDC } from './server/oidc.mjs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
let proc, origin, directory;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function launch() {
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server/app.mjs'], { env: { ...process.env, NODE_ENV: 'test', APP_ORIGIN: origin,
    PORT: String(port), WEBAPP_DATA_DIR: directory, ALLOW_REGISTRATION: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; proc.stderr.on('data', data => errors += data);
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(errors);
    try { if ((await fetch(origin + '/api/health')).ok) return; } catch {}
    await sleep(30);
  }
  throw new Error('server startup timeout: ' + errors);
}
async function stop() { if (proc?.exitCode === null) { proc.kill(); await once(proc, 'exit'); } }
before(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'webapp-runtime-')); await launch(); });
after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
async function api(url, { method = 'GET', cookie, body, foreign = false } = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { origin: foreign ? 'https://other.invalid' : origin } : {}) };
  if (body && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
  return fetch(origin + url, { method, headers, body });
}
async function register(username) {
  const response = await api('/api/auth/register', { method: 'POST', body: { username, password: 'correct long password' } });
  assert.equal(response.status, 200, await response.clone().text());
  return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user };
}

test('multi-user sessions, file isolation, logout, persistence and CSRF', async () => {
  const alice = await register('alice-user'), bob = await register('bob-user');
  assert.notEqual(alice.user.id, bob.user.id);
  assert.equal(alice.user.role, 'member');
  assert.equal((await api('/api/admin/users', alice)).status, 403);
  assert.equal((await api('/api/files')).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', foreign: true,
    body: { username: 'alice-user', password: 'correct long password' } })).status, 403);
  const wrong = await api('/api/auth/login', { method: 'POST', body: { username: 'alice-user', password: 'wrong long password' } });
  assert.equal(wrong.status, 401);
  const form = new FormData(); form.append('file', new Blob(['private file content']), 'private.txt');
  const uploaded = await api('/api/files', { method: 'POST', cookie: alice.cookie, body: form });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const file = await uploaded.json();
  assert.equal((await api('/api/files', bob)).status, 200);
  assert.deepEqual((await (await api('/api/files', bob)).json()).files, []);
  assert.equal((await api(`/api/files/${file.id}`, bob)).status, 404);
  assert.equal((await api(`/api/files/${file.id}`, { method: 'DELETE', cookie: bob.cookie })).status, 404);
  const own = await api(`/api/files/${file.id}`, alice);
  assert.equal(await own.text(), 'private file content');
  assert.match(own.headers.get('content-disposition'), /^attachment/);
  // A restart changes the listening port, but neither users/sessions nor object ownership.
  await stop(); await launch();
  assert.equal((await (await api('/api/session', alice)).json()).user.id, alice.user.id);
  assert.equal(await (await api(`/api/files/${file.id}`, alice)).text(), 'private file content');
  assert.equal((await api(`/api/files/${file.id}`, { method: 'DELETE', cookie: alice.cookie })).status, 200);
  assert.equal((await api(`/api/files/${file.id}`, alice)).status, 404);
  assert.equal((await api('/api/auth/logout', { method: 'POST', cookie: alice.cookie })).status, 200);
  assert.equal((await (await api('/api/session', alice)).json()).user, null);
  for (const route of ['/.env', '/webapp-pro.json', '/server/app.mjs', '/.webapp-data/app.sqlite']) {
    assert.equal((await fetch(origin + route)).status, 404, route);
  }
  assert.equal((await fetch(origin + '/account/')).status, 200);
});

test('OSS and CloudBase adapters preserve opaque keys and return real SDK errors', async () => {
  Object.assign(process.env, { OSS_REGION: 'mock', OSS_BUCKET: 'mock', OSS_ACCESS_KEY_ID: 'mock', OSS_ACCESS_KEY_SECRET: 'mock',
    CLOUDBASE_ENV_ID: 'mock', CLOUDBASE_SECRET_ID: 'mock', CLOUDBASE_SECRET_KEY: 'mock' });
  const calls = [];
  class MockOSS {
    async getBucketACL() { return { acl: 'private' }; }
    async getBucketPolicy() { return { policy: { Statement: [] } }; }
    async put(key, data, options) { calls.push(['put', key, data.toString(), options]); }
    async get(key) { calls.push(['get', key]); return { content: Buffer.from('oss') }; }
    async delete(key) { calls.push(['delete', key]); }
  }
  const oss = await createStorage('oss', directory, { OSS: MockOSS });
  assert.equal(await oss.put('owner/id', Buffer.from('content'), 'text/plain'), 'owner/id');
  assert.equal((await oss.read('owner/id')).toString(), 'oss'); await oss.remove('owner/id');
  await assert.rejects(oss.read('../secret'));
  assert.equal(calls.length, 3);
  assert.equal(calls[0][3].headers['x-oss-object-acl'], 'private');
  class PublicBucketOSS extends MockOSS { async getBucketACL() { return { acl: 'public-read' }; } }
  await assert.rejects(createStorage('oss', directory, { OSS: PublicBucketOSS }), /private bucket/);
  class PublicPolicyOSS extends MockOSS {
    async getBucketPolicy() { return { policy: { Statement: [{ Effect: 'Allow', Principal: ['*'], Action: ['oss:*'] }] } }; }
  }
  await assert.rejects(createStorage('oss', directory, { OSS: PublicPolicyOSS }), /anonymous Allow/);
  class UnreadablePolicyOSS extends MockOSS {
    async getBucketPolicy() { const error = new Error('Policy access denied'); error.code = 'AccessDenied'; throw error; }
  }
  await assert.rejects(createStorage('oss', directory, { OSS: UnreadablePolicyOSS }), /Policy access denied/);
  class NoPolicyOSS extends MockOSS {
    async getBucketPolicy() { const error = new Error('No policy'); error.code = 'NoSuchBucketPolicy'; throw error; }
  }
  const privateWithoutPolicy = await createStorage('oss', directory, { OSS: NoPolicyOSS });
  assert.equal(typeof privateWithoutPolicy.put, 'function');
  let fail = false;
  const cloudbase = { init: () => ({
    uploadFile: async () => ({ fileID: 'cloud://mock/file' }),
    downloadFile: async () => ({ fileContent: Buffer.from('cloud') }),
    deleteFile: async () => ({ fileList: [{ code: fail ? 'FORBIDDEN' : 'SUCCESS' }] }),
  }) };
  const cloud = await createStorage('cloudbase', directory, { cloudbase });
  assert.equal(await cloud.put('owner/id', Buffer.from('content')), 'cloud://mock/file');
  assert.equal((await cloud.read('owner/id', 'cloud://mock/file')).toString(), 'cloud');
  await cloud.remove('owner/id', 'cloud://mock/file'); fail = true;
  await assert.rejects(cloud.remove('owner/id', 'cloud://mock/file'));
});

test('administrator roles require the server management path and are reversible', async () => {
  const account = await register('managed-user');
  assert.equal((await api('/api/admin/users', account)).status, 403);
  const env = { ...process.env, WEBAPP_DATA_DIR: directory };
  execFileSync(process.execPath, ['server/manage-user.mjs', 'role', 'id:' + account.user.id, 'admin'], { env });
  const response = await api('/api/admin/users', account);
  assert.equal(response.status, 200);
  const users = (await response.json()).users;
  assert.ok(users.length >= 1);
  assert.equal(users.some(user => 'password' in user), false);
  execFileSync(process.execPath, ['server/manage-user.mjs', 'role', 'id:' + account.user.id, 'member'], { env });
  assert.equal((await api('/api/admin/users', account)).status, 403);
});

test('WebDAV performs upload/read/delete over the configured protocol', async () => {
  const objects = new Map(), methods = [];
  const server = createServer(async (request, response) => {
    methods.push(request.method);
    assert.equal(request.headers.authorization, 'Basic ' + Buffer.from('mock-user:mock-only').toString('base64'));
    if (request.method === 'MKCOL') { response.writeHead(201).end(); return; }
    if (request.method === 'PUT') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      objects.set(request.url, Buffer.concat(chunks)); response.writeHead(201).end();
    } else if (request.method === 'GET') response.writeHead(objects.has(request.url) ? 200 : 404).end(objects.get(request.url));
    else if (request.method === 'DELETE') { objects.delete(request.url); response.writeHead(204).end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  Object.assign(process.env, { NODE_ENV: 'test', WEBDAV_URL: `http://127.0.0.1:${server.address().port}/files/`, WEBDAV_USERNAME: 'mock-user', WEBDAV_PASSWORD: 'mock-only' });
  try {
    const dav = await createStorage('webdav', directory);
    await dav.put('owner/id', Buffer.from('dav-content'), 'text/plain');
    assert.equal((await dav.read('owner/id')).toString(), 'dav-content');
    await dav.remove('owner/id'); assert.deepEqual(methods, ['MKCOL', 'PUT', 'GET', 'DELETE']);
    await assert.rejects(dav.read('owner/id'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('OIDC signed identity verifies nonce, issuer, audience, expiry and state', async () => {
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey); jwk.kid = 'test-key'; jwk.alg = 'RS256';
  let issuer, nonce, variant = 'valid';
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/.well-known/openid-configuration') return response.end(JSON.stringify({ issuer,
      authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/keys', token_endpoint_auth_methods_supported: ['none'] }));
    if (request.url === '/keys') return response.end(JSON.stringify({ keys: [jwk] }));
    if (request.url === '/token') {
      const token = await new SignJWT({ nonce: variant === 'nonce' ? 'wrong' : nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(variant === 'issuer' ? 'https://other.invalid' : issuer)
        .setAudience(variant === 'audience' ? 'other-client' : 'test-client').setSubject('verified-subject')
        .setIssuedAt().setExpirationTime(variant === 'expired' ? Math.floor(Date.now() / 1000) - 60 : '5m').sign(pair.privateKey);
      return response.end(JSON.stringify({ id_token: token })); // identity-only: no access_token
    }
    response.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); issuer = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, { NODE_ENV: 'test', OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'test-client', OIDC_TOKEN_AUTH_METHOD: 'none' });
  try {
    const client = createOIDC('oidc', origin);
    const start = await client.start(); nonce = start.payload.nonce;
    assert.equal(new URL(start.url).searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(origin + '/api/auth/callback?code=mock&state=' + start.payload.state);
    assert.equal((await client.finish(callback, start.payload)).subject, 'verified-subject');
    await assert.rejects(client.finish(new URL(origin + '/api/auth/callback?code=mock&state=wrong'), start.payload));
    for (variant of ['nonce', 'issuer', 'audience', 'expired']) await assert.rejects(client.finish(callback, start.payload));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
