import { mkdir, writeFile, readFile, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';

export function validateKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(key)) throw new Error('Invalid storage key');
  return key;
}

export async function createStorage(provider, directory, dependencies = {}) {
  const required = name => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  if (provider === 'local') {
    const root = path.join(directory, 'files');
    await mkdir(root, { recursive: true, mode: 0o700 });
    return {
      async put(key, data) {
        validateKey(key);
        const dest = path.join(root, key);
        await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
        await writeFile(dest, data, { flag: 'wx', mode: 0o600 });
        return key;
      },
      async read(key) {
        validateKey(key);
        const filename = await realpath(path.join(root, key));
        if (!filename.startsWith(await realpath(root) + path.sep)) throw new Error('Invalid file path');
        return readFile(filename);
      },
      async remove(key) {
        validateKey(key);
        const filename = await realpath(path.join(root, key));
        if (!filename.startsWith(await realpath(root) + path.sep)) throw new Error('Invalid file path');
        return unlink(filename);
      },
      async verifyRemoved(key) {
        validateKey(key);
        try { await readFile(path.join(root, key)); return { status: 'still-present' }; }
        catch (error) { if (error.code === 'ENOENT') return { status: 'confirmed-absent' }; throw error; }
      },
    };
  }
  if (provider === 'oss') {
    const OSS = dependencies.OSS || (await import('ali-oss')).default;
    const client = new OSS({ region: required('OSS_REGION'), bucket: required('OSS_BUCKET'),
      accessKeyId: required('OSS_ACCESS_KEY_ID'), accessKeySecret: required('OSS_ACCESS_KEY_SECRET'),
      stsToken: process.env.OSS_STS_TOKEN || undefined, secure: true, timeout: 30_000 });
    // Fail closed before uploading user content. An explicit bucket policy can
    // grant anonymous access even when an individual object has a private ACL.
    const bucket = required('OSS_BUCKET');
    if ((await client.getBucketACL(bucket)).acl !== 'private') {
      throw Object.assign(new Error('OSS private-file storage requires a private bucket; use a separate bucket for public website assets'), { code: 'OSS_PRIVATE_BUCKET_REQUIRED' });
    }
    let policy;
    try { policy = (await client.getBucketPolicy(bucket)).policy; }
    catch (error) { if (error.code !== 'NoSuchBucketPolicy') throw error; }
    const statements = policy?.Statement || [];
    const anonymous = value => value === '*' || Array.isArray(value) && value.some(anonymous) ||
      value && typeof value === 'object' && Object.values(value).some(anonymous);
    if (statements.some(statement => statement.Effect === 'Allow' && anonymous(statement.Principal))) {
      throw Object.assign(new Error('OSS private-file storage rejects anonymous Allow policies; configure an isolated private bucket'), { code: 'OSS_ANONYMOUS_POLICY' });
    }
    return {
      async put(key, data, contentType) {
        validateKey(key);
        // Keep each upload explicitly private inside the verified private bucket.
        await client.put(key, data, { headers: { 'Content-Type': contentType, 'x-oss-object-acl': 'private' } });
        return key;
      },
      async read(key) { validateKey(key); return (await client.get(key)).content; },
      async remove(key) { validateKey(key); await client.delete(key); },
      async verifyPrivate(key) {
        validateKey(key);
        const url = new URL(client.generateObjectUrl(key));
        if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) throw new Error('Invalid anonymous probe URL');
        const response = await (dependencies.fetch || fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
        await response.body?.cancel();
        if (response.status !== 403) throw Object.assign(new Error('Anonymous access must be denied'), { code: 'OSS_ANONYMOUS_READ_NOT_DENIED', status: response.status });
        return { status: 'passed', anonymous_status: response.status };
      },
      async verifyRemoved(key) {
        validateKey(key);
        try { await client.get(key); return { status: 'still-present' }; }
        catch (error) {
          if (error.status === 404 && error.code === 'NoSuchKey') return { status: 'confirmed-absent' };
          throw error;
        }
      },
    };
  }
  if (provider === 'cloudbase') {
    const tcb = dependencies.cloudbase || (await import('@cloudbase/node-sdk')).default;
    const client = tcb.init({ env: required('CLOUDBASE_ENV_ID'),
      secretId: required('CLOUDBASE_SECRET_ID'), secretKey: required('CLOUDBASE_SECRET_KEY'),
      sessionToken: process.env.CLOUDBASE_SESSION_TOKEN || undefined, timeout: 30_000 });
    return {
      async put(key, data) {
        validateKey(key);
        const result = await client.uploadFile({ cloudPath: key, fileContent: data });
        if (typeof result.fileID !== 'string' || !result.fileID) throw new Error('CloudBase did not return a file ID');
        return result.fileID;
      },
      async read(key, storageKey) {
        validateKey(key);
        const result = await client.downloadFile({ fileID: storageKey });
        if (!result.fileContent) throw new Error('CloudBase file download failed');
        return Buffer.from(result.fileContent);
      },
      async remove(key, storageKey) {
        validateKey(key);
        const result = await client.deleteFile({ fileList: [storageKey] });
        const file = result.fileList?.[0];
        if (!file || file.code !== 'SUCCESS' && file.status !== 0) throw new Error('CloudBase file deletion failed');
      },
      async verifyRemoved(key, storageKey) {
        validateKey(key);
        const absent = async operation => {
          try { return await operation(); }
          catch (error) { if (error.code === 'STORAGE_FILE_NONEXIST') return true; throw error; }
        };
        // Re-resolve the file ID through the API; an old CDN URL may stay cached.
        const download = await absent(async () => {
          const result = await client.downloadFile({ fileID: storageKey });
          return result.code === 'STORAGE_FILE_NONEXIST';
        });
        const address = await absent(async () => {
          const result = await client.getTempFileURL({ fileList: [storageKey] });
          if (result.code === 'STORAGE_FILE_NONEXIST') return true;
          const file = result.fileList?.[0];
          if (!file) throw new Error('CloudBase verification returned no file result');
          if (file.code && !['SUCCESS', 'STORAGE_FILE_NONEXIST'].includes(file.code)) {
            const error = new Error('CloudBase verification failed'); error.code = file.code; throw error;
          }
          return file.code === 'STORAGE_FILE_NONEXIST';
        });
        return { status: download === true && address === true ? 'confirmed-absent' : 'not-confirmed',
          sdk_download_absent: download === true, fresh_url_absent: address === true };
      },
    };
  }
  if (provider === 'webdav') {
    const base = new URL(required('WEBDAV_URL'));
    if (base.username || base.password || base.search || base.hash) throw new Error('WebDAV URL must not contain credentials, query or fragment');
    if (base.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('WebDAV requires HTTPS');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const authorization = 'Basic ' + Buffer.from(required('WEBDAV_USERNAME') + ':' + required('WEBDAV_PASSWORD')).toString('base64');
    const request = async (relative, method, body, contentType, accepted = [], headers = {}) => {
      const response = await fetch(new URL(relative.split('/').map(encodeURIComponent).join('/'), base), {
        method, headers: { authorization, ...(contentType ? { 'Content-Type': contentType } : {}), ...headers },
        body, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!response.ok && !(method === 'MKCOL' && response.status === 405) && !accepted.includes(response.status)) {
        await response.body?.cancel();
        const error = new Error(`WebDAV ${method} failed (${response.status})`); error.status = response.status; throw error;
      }
      return response;
    };
    const probeDirectories = new Set();
    return {
      async put(key, data, contentType) { validateKey(key); await request(key.split('/')[0], 'MKCOL'); await request(key, 'PUT', data, contentType); return key; },
      async read(key) { validateKey(key); return Buffer.from(await (await request(key, 'GET')).arrayBuffer()); },
      async remove(key) { validateKey(key); await request(key, 'DELETE'); },
      async verifyRemoved(key) {
        validateKey(key);
        const response = await request(key, 'GET', undefined, undefined, [404]);
        await response.body?.cancel();
        return { status: response.status === 404 ? 'confirmed-absent' : 'still-present' };
      },
      async prepareProbe(key) {
        validateKey(key);
        const folder = key.split('/')[0];
        if (!/^webapp-pro-check-[a-f0-9-]+$/.test(folder)) throw new Error('Invalid probe directory');
        const response = await request(folder, 'MKCOL'); await response.body?.cancel();
        if (response.status !== 201) throw Object.assign(new Error('Probe directory must be newly created; no writes attempted'), { code: 'PROBE_DIRECTORY_NOT_CREATED' });
        probeDirectories.add(folder);
      },
      async cleanupProbe(key) {
        validateKey(key);
        const folder = key.split('/')[0];
        if (!probeDirectories.has(folder)) throw new Error('Probe directory ownership not confirmed');
        // Only remove the exclusively created probe folder after an empty listing.
        const listing = await request(folder, 'PROPFIND', undefined, undefined, [], { Depth: '1' });
        const xml = await listing.text();
        const entries = xml.match(/<(?:[\w-]+:)?response\b[^>]*>/g) || [];
        const hrefs = [...xml.matchAll(/<(?:[\w-]+:)?href\b[^>]*>([^<]*)<\/(?:[\w-]+:)?href>/g)];
        const expected = decodeURIComponent(new URL(folder + '/', base).pathname).replace(/\/$/, '');
        const self = hrefs.length === 1 && decodeURIComponent(new URL(hrefs[0][1], base).pathname).replace(/\/$/, '') === expected;
        if (listing.status !== 207 || entries.length !== 1 || !self) return { status: 'directory-retained-not-empty-or-unrecognized' };
        const removed = await request(folder, 'DELETE'); await removed.body?.cancel();
        const check = await request(folder, 'PROPFIND', undefined, undefined, [404], { Depth: '0' });
        await check.body?.cancel();
        if (check.status === 404) { probeDirectories.delete(folder); return { status: 'confirmed-absent' }; }
        return { status: 'directory-removal-not-confirmed' };
      },
    };
  }
  throw new Error('Unsupported storage provider; hosted Kimi/Sites storage uses its platform module');
}
