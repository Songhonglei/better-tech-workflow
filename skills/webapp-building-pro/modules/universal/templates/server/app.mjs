import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore, randomToken } from './store.mjs';
import { createStorage } from './storage.mjs';
import { createOIDC } from './oidc.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(project, 'webapp-pro.json'), 'utf8'));
const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS');
const secure = origin.startsWith('https://');
const cookie = secure ? '__Host-webapp-session' : 'webapp-session';
const transactionCookie = secure ? '__Host-webapp-login' : 'webapp-login';
const cookieOptions = { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAge: 8 * 3600 };
const store = createStore(path.resolve(project, process.env.WEBAPP_DATA_DIR || '.webapp-data'));
const storage = await createStorage(config.storage, path.resolve(project, process.env.WEBAPP_DATA_DIR || '.webapp-data'));
const oidc = ['oidc', 'openai'].includes(config.auth) ? createOIDC(config.auth, origin) : null;
if (!['local', 'oidc', 'openai'].includes(config.auth)) throw new Error('Use the hosted platform authentication module for this provider');
const app = new Hono();
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== origin) {
    return c.json({ error: '请求来源不匹配，请从本站重新操作。' }, 403);
  }
  await next();
});
app.use('/api/*', bodyLimit({ maxSize: 6 * 1024 * 1024,
  onError: c => c.json({ error: '文件过大，最多上传 5 MB。' }, 413) }));
app.get('/api/health', c => c.json({ ok: true }));
app.get('/api/session', c => c.json({ user: store.user(getCookie(c, cookie)) || null,
  auth: config.auth, registration: config.auth === 'local' && process.env.ALLOW_REGISTRATION === 'true' }));
function signedIn(c) { return store.user(getCookie(c, cookie)); }
function beginSession(c, user) {
  store.logout(getCookie(c, cookie));
  setCookie(c, cookie, store.session(user), cookieOptions);
}
const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
app.post('/api/auth/:action', async c => {
  const action = c.req.param('action');
  if (action === 'logout') {
    store.logout(getCookie(c, cookie)); deleteCookie(c, cookie, { path: '/', secure });
    return c.json({ ok: true });
  }
  if (config.auth !== 'local' || !['register', 'login'].includes(action)) return c.json({ error: '当前登录方式不支持此操作。' }, 400);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') return c.json({ error: '请输入账号和密码。' }, 400);
  const username = body.username.trim().toLowerCase(), password = body.password;
  if (!usernamePattern.test(username) || password.length < 12 || password.length > 128) return c.json({ error: '账号使用 3–64 位字母、数字或 _.-；密码使用 12–128 位。' }, 400);
  if (!store.limit(`auth:${username}`, 10) || !store.limit(`auth:global`, 300) || action === 'register' && !store.limit('registration:global', 20)) return c.json({ error: '尝试过于频繁，请稍后重试。' }, 429);
  if (action === 'register' && process.env.ALLOW_REGISTRATION !== 'true') return c.json({ error: '本站暂未开放注册，请联系管理员。' }, 403);
  let user;
  if (action === 'register') {
    try { user = await store.register(username, password); }
    catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && String(error.message).includes('UNIQUE')) return c.json({ error: '无法注册此账号，请更换账号或登录。' }, 409);
      throw error;
    }
  } else user = await store.login(username, password);
  if (!user) return c.json({ error: '账号或密码不正确。' }, 401);
  beginSession(c, user);
  return c.json({ user });
});
app.get('/api/auth/start', async c => {
  if (!oidc) return c.redirect('/account/');
  if (!store.limit('oidc:start', 100)) return c.json({ error: '尝试过于频繁。' }, 429);
  const { payload, url } = await oidc.start();
  store.consume(getCookie(c, transactionCookie));
  setCookie(c, transactionCookie, store.transaction(payload), { ...cookieOptions, maxAge: 600 });
  return c.redirect(url);
});
app.get('/api/auth/callback', async c => {
  const tx = store.consume(getCookie(c, transactionCookie));
  deleteCookie(c, transactionCookie, { path: '/', secure });
  try {
    if (!oidc) throw new Error('OIDC not configured');
    const identity = await oidc.finish(new URL(c.req.url), tx);
    const user = store.external(identity.provider, identity.issuer, identity.clientId, identity.subject, identity.name);
    beginSession(c, user);
    return c.redirect('/account/');
  } catch { return c.json({ error: '登录未完成，请返回账号页重新登录。' }, 400); }
});
app.get('/api/admin/users', c => {
  if (signedIn(c)?.role !== 'admin') return c.json({ error: '需要管理员权限。' }, 403);
  return c.json({ users: store.db.prepare('SELECT id,username,name,role FROM users').all() });
});
app.use('/api/files*', async (c, next) => {
  const user = signedIn(c);
  if (!user) return c.json({ error: '请先登录。' }, 401);
  c.set('user', user);
  await next();
});
app.get('/api/files', c => c.json({ files: store.db.prepare('SELECT id,name,size,content_type FROM files WHERE owner=?').all(c.get('user').id) }));
app.post('/api/files', async c => {
  const user = c.get('user');
  if (!store.limit(`upload:${user.id}`, 30)) return c.json({ error: '上传过于频繁，请稍后重试。' }, 429);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || !file.name) return c.json({ error: '请选择不超过 5 MB 的文件。' }, 400);
  const id = randomToken(), key = `${user.id}/${id}`;
  const storageKey = await storage.put(key, Buffer.from(await file.arrayBuffer()), file.type || 'application/octet-stream');
  store.db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)').run(id, user.id, file.name.slice(0, 250), file.type || 'application/octet-stream', file.size, config.storage, storageKey);
  return c.json({ id, name: file.name, size: file.size }, 201);
});
app.on(['GET', 'DELETE'], '/api/files/:id', async c => {
  const row = store.db.prepare('SELECT * FROM files WHERE id=? AND owner=?').get(c.req.param('id'), c.get('user').id);
  if (!row) return c.json({ error: '文件不存在或无权访问。' }, 404);
  if (row.provider !== config.storage) return c.json({ error: '文件使用原存储配置，请恢复该配置或先迁移文件。' }, 409);
  const key = `${row.owner}/${row.id}`;
  if (c.req.method === 'DELETE') {
    await storage.remove(key, row.storage_key);
    store.db.prepare('DELETE FROM files WHERE id=? AND owner=?').run(row.id, row.owner);
    return c.json({ ok: true });
  }
  const data = await storage.read(key, row.storage_key);
  c.header('Content-Type', 'application/octet-stream');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g, x => '%' + x.charCodeAt(0).toString(16))}`);
  return c.body(new Uint8Array(data));
});
app.all('/api/*', c => c.json({ error: '接口不存在。' }, 404));
app.use('/account/*', serveStatic({ root: './webapp-client', rewriteRequestPath: p => p.replace(/^\/account/, '') || '/index.html' }));
app.get('/account', c => c.redirect('/account/'));
app.use('*', serveStatic({ root: './dist' }));
app.get('*', async c => {
  // SPA fallback only for document navigations; missing assets remain 404.
  if (!c.req.header('accept')?.includes('text/html') || path.extname(new URL(c.req.url).pathname)) return c.notFound();
  try { return c.html(await readFile(path.join(project, 'dist/index.html'), 'utf8')); }
  catch { return c.text('尚未构建页面，请先运行 npm run webapp:build。', 503); }
});
app.onError((error, c) => {
  console.error('Webapp request failed', { name: error.name });
  return c.json({ error: '操作未完成。请检查服务配置；写入结果未知时先刷新核对，勿重复提交。' }, 500);
});
serve({ fetch: app.fetch, hostname: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3000) });
