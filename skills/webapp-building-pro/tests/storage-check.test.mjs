// Copy to a generated project's root and run: node --test storage-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { checkConfiguration, runStorageProbe } from './server/storage-check.mjs';

test('configuration checks do not connect or expose credential values', () => {
  const result = checkConfiguration('cloudbase', {});
  assert.equal(result.status, 'blocked');
  assert.equal(result.live_operations_verified, false);
  assert.equal(result.missing_fields.length, 3);
  const ready = checkConfiguration('cloudbase', { CLOUDBASE_ENV_ID: 'env', CLOUDBASE_SECRET_ID: 'sensitive-id', CLOUDBASE_SECRET_KEY: 'sensitive-key' });
  assert.equal(ready.status, 'configuration-ready');
  assert.equal(JSON.stringify(ready).includes('sensitive'), false);
  assert.equal(checkConfiguration('webdav', { WEBDAV_URL: 'https://user:secret@invalid/', WEBDAV_USERNAME: 'u', WEBDAV_PASSWORD: 'p' }).status, 'blocked');
});

function cloudMock({ uploadError = false, deleteError = false, verificationError = false } = {}) {
  Object.assign(process.env, { CLOUDBASE_ENV_ID: 'env', CLOUDBASE_SECRET_ID: 'private-id', CLOUDBASE_SECRET_KEY: 'private-key' });
  let bytes, present = false, deletes = 0, uploads = 0, key;
  const absent = () => Object.assign(new Error('secret=https://invalid/?token=private-key'), { code: 'STORAGE_FILE_NONEXIST' });
  return { get counts() { return { deletes, uploads }; }, cloudbase: { init: () => ({
    async uploadFile(input) { key = input.cloudPath; bytes = input.fileContent; present = true; uploads++;
      if (uploadError) throw Object.assign(new Error('private-key'), { code: 'ETIMEDOUT' });
      return { fileID: 'cloud://mock/' + key }; },
    async downloadFile() { if (present) return { fileContent: bytes }; if (verificationError) throw Object.assign(new Error('private-key'), { code: 'AccessDenied' }); throw absent(); },
    async getTempFileURL() { if (present) return { fileList: [{ code: 'SUCCESS', tempFileURL: 'https://cached.invalid/?secret=private-key' }] };
      return { fileList: [{ code: 'STORAGE_FILE_NONEXIST' }] }; },
    async deleteFile() { deletes++; if (deleteError) throw Object.assign(new Error('private-key'), { code: 'ETIMEDOUT' }); present = false; return { fileList: [{ code: 'SUCCESS' }] }; },
  }) } };
}

test('CloudBase confirms cleanup through fresh API results and saves recovery key before upload', async () => {
  const mock = cloudMock(), events = [];
  const result = await runStorageProbe('cloudbase', '/tmp', { dependencies: mock, onProgress: async value => events.push(value) });
  assert.equal(result.status, 'passed');
  assert.equal(result.cleanup.object.fresh_url_absent, true);
  assert.equal(events[0].object_key, result.object_key);
  assert.deepEqual(mock.counts, { deletes: 1, uploads: 1 });
  assert.equal(/private-key|private-id|https:/.test(JSON.stringify(result)), false);
});

test('permission errors cannot prove CloudBase deletion, and delete is never repeated', async () => {
  for (const options of [{ verificationError: true }, { deleteError: true }]) {
    const mock = cloudMock(options);
    const result = await runStorageProbe('cloudbase', '/tmp', { dependencies: mock });
    assert.equal(result.status, 'failed');
    assert.notEqual(result.cleanup.status, 'confirmed-absent');
    assert.equal(mock.counts.deletes, 1);
    assert.equal(JSON.stringify(result).includes('private-key'), false);
  }
});

test('unknown upload is recorded without destructive cleanup or re-upload', async () => {
  const mock = cloudMock({ uploadError: true });
  const result = await runStorageProbe('cloudbase', '/tmp', { dependencies: mock });
  assert.equal(result.cleanup.status, 'upload-outcome-unknown-check-object-key');
  assert.match(result.object_key, /^webapp-pro-check-/);
  assert.deepEqual(mock.counts, { deletes: 0, uploads: 1 });
});

test('unsafe OSS fails before any object is uploaded', async () => {
  Object.assign(process.env, { OSS_REGION: 'mock', OSS_BUCKET: 'mock', OSS_ACCESS_KEY_ID: 'id', OSS_ACCESS_KEY_SECRET: 'key' });
  let writes = 0;
  class OSS { async getBucketACL() { return { acl: 'public-read' }; } async put() { writes++; } }
  const result = await runStorageProbe('oss', '/tmp', { dependencies: { OSS } });
  assert.equal(result.status, 'failed'); assert.equal(writes, 0);
});

test('OSS privacy probe rejects anonymous success and still cleans its own object', async () => {
  Object.assign(process.env, { OSS_REGION: 'mock', OSS_BUCKET: 'mock', OSS_ACCESS_KEY_ID: 'id', OSS_ACCESS_KEY_SECRET: 'key' });
  let bytes, removed = 0;
  class OSS {
    async getBucketACL() { return { acl: 'private' }; }
    async getBucketPolicy() { return { policy: null }; }
    async put(key, content) { bytes = content; }
    async get() { if (bytes) return { content: bytes }; throw Object.assign(new Error(), { code: 'NoSuchKey', status: 404 }); }
    async delete() { bytes = null; removed++; }
    generateObjectUrl(key) { return 'https://example.invalid/' + key; }
  }
  for (const status of [200, 403]) {
    const result = await runStorageProbe('oss', '/tmp', { dependencies: { OSS, fetch: async () => new Response('', { status }) } });
    assert.equal(result.status, status === 403 ? 'passed' : 'failed');
    assert.equal(result.cleanup.status, 'confirmed-absent');
  }
  assert.equal(removed, 2);
});

async function webdavFixture(t, { conflict = false, foreignChild = false } = {}) {
  let folder, content, puts = 0, directoryDeletes = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Basic ' + Buffer.from('tester:test-password').toString('base64'));
    if (request.method === 'MKCOL') {
      if (conflict || folder) { response.writeHead(405).end(); return; }
      folder = request.url; response.writeHead(201).end(); return;
    }
    if (request.method === 'PUT') { const chunks = []; for await (const b of request) chunks.push(b); content = Buffer.concat(chunks); puts++; response.writeHead(201).end(); }
    else if (request.method === 'GET') response.writeHead(content ? 200 : 404).end(content);
    else if (request.method === 'DELETE') {
      if (request.url === folder) { directoryDeletes++; folder = null; } else content = null;
      response.writeHead(204).end();
    } else if (request.method === 'PROPFIND') {
      if (!folder) return response.writeHead(404).end();
      response.writeHead(207, { 'content-type': 'application/xml' }).end('<d:multistatus xmlns:d="DAV:"><d:response><d:href>' + folder + '/</d:href></d:response>' +
        (foreignChild ? '<d:response><d:href>' + folder + '/foreign</d:href></d:response>' : '') + '</d:multistatus>');
    } else response.writeHead(405).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  Object.assign(process.env, { NODE_ENV: 'test', WEBDAV_URL: `http://127.0.0.1:${server.address().port}/dav/`, WEBDAV_USERNAME: 'tester', WEBDAV_PASSWORD: 'test-password' });
  return { get counts() { return { puts, directoryDeletes }; } };
}

test('WebDAV probe removes its own file and newly created empty directory', async t => {
  const fixture = await webdavFixture(t);
  const result = await runStorageProbe('webdav', '/tmp');
  assert.equal(result.status, 'passed');
  assert.equal(result.cleanup.directory.status, 'confirmed-absent');
  assert.deepEqual(fixture.counts, { puts: 1, directoryDeletes: 1 });
});

test('WebDAV probe never writes into a pre-existing test directory', async t => {
  const fixture = await webdavFixture(t, { conflict: true });
  const result = await runStorageProbe('webdav', '/tmp');
  assert.equal(result.status, 'failed');
  assert.deepEqual(fixture.counts, { puts: 0, directoryDeletes: 0 });
});

test('WebDAV probe retains a directory containing unexpected files', async t => {
  const fixture = await webdavFixture(t, { foreignChild: true });
  const result = await runStorageProbe('webdav', '/tmp');
  assert.equal(result.status, 'cleanup-needs-confirmation');
  assert.deepEqual(fixture.counts, { puts: 1, directoryDeletes: 0 });
});
