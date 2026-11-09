import 'dotenv/config';
import { randomUUID, createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStorage } from './storage.mjs';

const fields = {
  local: [],
  oss: ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'],
  cloudbase: ['CLOUDBASE_ENV_ID', 'CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRET_KEY'],
  webdav: ['WEBDAV_URL', 'WEBDAV_USERNAME', 'WEBDAV_PASSWORD'],
};
const errorSummary = error => ({
  // SDK error messages and request objects can contain credentials or signed URLs.
  code: /^[A-Za-z0-9_-]{1,64}$/.test(error?.code || '') ? error.code : 'CHECK_FAILED',
  status: Number.isInteger(error?.status) ? error.status : null,
});

export function checkConfiguration(provider, env = process.env) {
  const result = { format_version: 1, provider, mode: 'configuration', status: 'configuration-ready',
    checks: {}, live_operations_verified: false, cleanup: { status: 'not-started' } };
  if (!Object.hasOwn(fields, provider)) return { ...result, status: 'blocked', reason: 'unsupported-provider' };
  const missing = fields[provider].filter(name => !env[name]?.trim());
  result.checks.required_fields_present = !missing.length;
  if (missing.length) return { ...result, status: 'blocked', reason: 'missing-server-configuration', missing_fields: missing };
  if (provider === 'webdav') {
    try {
      const url = new URL(env.WEBDAV_URL);
      const loopback = env.NODE_ENV === 'test' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || loopback)) throw new Error();
    } catch { return { ...result, status: 'blocked', reason: 'invalid-webdav-url-use-https-with-separate-credentials' }; }
  }
  return result;
}

export async function runStorageProbe(provider, directory, { dependencies = {}, onProgress = async () => {} } = {}) {
  const result = checkConfiguration(provider);
  result.mode = 'probe'; result.started_at = new Date().toISOString();
  if (result.status === 'blocked') return result;
  result.status = 'running';
  // Write the recovery key before making any external write, including MKCOL.
  const key = `webapp-pro-check-${randomUUID()}/probe-${randomUUID()}`;
  result.object_key = key;
  const data = Buffer.from('webapp-building-pro-storage-check\n' + randomUUID());
  result.bytes = data.length;
  result.expected_sha256 = createHash('sha256').update(data).digest('hex');
  let storage, storageKey, uploadAttempted = false, deleteAttempted = false, prepared = false;
  const save = () => onProgress(structuredClone(result));
  async function removeOnce() {
    deleteAttempted = true; result.phase = 'delete'; await save();
    try { await storage.remove(key, storageKey); }
    catch (error) { result.cleanup.status = 'delete-outcome-unknown-do-not-retry'; throw error; }
    result.checks.delete = 'accepted'; result.cleanup.status = 'delete-accepted'; await save();
    result.cleanup.object = await storage.verifyRemoved(key, storageKey);
    result.cleanup.status = result.cleanup.object.status;
  }
  try {
    await save();
    storage = await createStorage(provider, directory, dependencies);
    result.checks.adapter_preflight = 'passed';
    if (storage.prepareProbe) {
      result.phase = 'prepare-probe-directory'; result.cleanup.status = 'directory-creation-not-confirmed-check-object-key'; await save();
      await storage.prepareProbe(key); prepared = true;
    }
    result.phase = 'upload'; uploadAttempted = true; await save();
    storageKey = await storage.put(key, data, 'text/plain');
    if (provider !== 'cloudbase' || storageKey.startsWith('cloud://')) result.storage_key = storageKey;
    result.checks.upload = 'passed'; await save();
    result.phase = 'download';
    const received = await storage.read(key, storageKey);
    if (!Buffer.from(received).equals(data)) throw Object.assign(new Error(), { code: 'CONTENT_MISMATCH' });
    result.checks.download_byte_compare = 'passed'; await save();
    if (storage.verifyPrivate) { result.checks.privacy = await storage.verifyPrivate(key); await save(); }
    await removeOnce();
    result.status = result.cleanup.status === 'confirmed-absent' ? 'passed' : 'cleanup-needs-confirmation';
    result.live_operations_verified = result.status === 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = errorSummary(error);
  } finally {
    // Only clean a confirmed upload once. A thrown upload/delete has an unknown
    // outcome; the recorded key must be checked before another mutation.
    if (storageKey && !deleteAttempted) {
      try { await removeOnce(); }
      catch (error) { result.cleanup.error = errorSummary(error); }
    } else if (uploadAttempted && !storageKey) result.cleanup.status = 'upload-outcome-unknown-check-object-key';
    if (prepared && result.cleanup.status === 'confirmed-absent') {
      try {
        result.cleanup.directory = await storage.cleanupProbe(key);
        if (result.cleanup.directory.status !== 'confirmed-absent' && result.status === 'passed') result.status = 'cleanup-needs-confirmation';
      } catch (error) {
        result.cleanup.directory = { status: 'outcome-unknown-do-not-retry', error: errorSummary(error) };
        if (result.status === 'passed') result.status = 'cleanup-needs-confirmation';
      }
    }
    result.finished_at = new Date().toISOString(); result.phase = 'finished'; await save();
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run webapp:storage-check — checks server configuration only; no cloud requests or writes.');
    console.log('npm run webapp:storage-check -- --probe --report /absolute/new-report.json — uploads one tiny unique test file, verifies and removes only it. Requires authorization for the selected storage.');
    console.log('Report paths must not exist. Reports retain recovery keys but never credentials or signed URLs.');
    return;
  }
  let probe = false, reportPath;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--probe' && !probe) probe = true;
    else if (args[i] === '--report' && !reportPath && args[i + 1] && !args[i + 1].startsWith('--')) reportPath = args[++i];
    else throw Object.assign(new Error(), { code: 'INVALID_ARGUMENT' });
  }
  if (probe && !reportPath) throw Object.assign(new Error(), { code: 'PROBE_REQUIRES_REPORT_PATH' });
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(await readFile(path.join(project, 'webapp-pro.json'), 'utf8'));
  // Refuse an existing report before a probe can write anything to storage.
  const handle = reportPath ? await open(path.resolve(reportPath), 'wx', 0o600) : null;
  const save = async value => {
    if (!handle) return;
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    await handle.write(bytes, 0, bytes.length, 0); await handle.truncate(bytes.length); await handle.sync();
  };
  try {
    const result = probe ? await runStorageProbe(config.storage,
      path.resolve(project, process.env.WEBAPP_DATA_DIR || '.webapp-data'), { onProgress: save }) : checkConfiguration(config.storage);
    await save(result); console.log(JSON.stringify(result, null, 2));
    process.exitCode = ['passed', 'configuration-ready'].includes(result.status) ? 0 : result.status === 'blocked' ? 2 : 1;
  } finally { await handle?.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ status: 'failed', error: errorSummary(error) })); process.exitCode = 1; });
}
