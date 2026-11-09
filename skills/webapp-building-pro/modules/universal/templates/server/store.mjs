import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');

export function createStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'app.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE, password TEXT, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
    CREATE TABLE IF NOT EXISTS identities(provider TEXT, issuer TEXT, client TEXT, subject TEXT, user_id TEXT REFERENCES users(id), UNIQUE(provider,issuer,client,subject));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER);
    CREATE TABLE IF NOT EXISTS transactions(token TEXT PRIMARY KEY, payload TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), name TEXT, content_type TEXT, size INTEGER, provider TEXT, storage_key TEXT);
    CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, count INTEGER, expires INTEGER);`);
  const userFields = 'u.id,u.username,u.name,u.role';
  return {
    db,
    limit(key, maximum, window = 600_000) {
      const now = Date.now();
      db.prepare('DELETE FROM limits WHERE expires < ?').run(now);
      db.prepare('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + window);
      return db.prepare('SELECT count FROM limits WHERE key=?').get(key).count <= maximum;
    },
    async register(username, password) {
      const salt = randomBytes(16).toString('hex');
      const encoded = salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
      const id = randomToken();
      db.prepare('INSERT INTO users(id,username,password,name) VALUES(?,?,?,?)').run(id, username, encoded, username);
      return { id, username, name: username, role: 'member' };
    },
    async login(username, password) {
      const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
      const [salt, stored] = (row?.password || 'fixed-missing-user-salt:' + '0'.repeat(128)).split(':');
      const candidate = await scrypt(password, salt, 64);
      if (!row || !stored || !timingSafeEqual(candidate, Buffer.from(stored, 'hex'))) return null;
      return { id: row.id, username: row.username, name: row.name, role: row.role };
    },
    external(provider, issuer, client, subject, name) {
      db.exec('BEGIN IMMEDIATE');
      try {
        let row = db.prepare(`SELECT ${userFields} FROM users u JOIN identities i ON i.user_id=u.id WHERE provider=? AND issuer=? AND client=? AND subject=?`).get(provider, issuer, client, subject);
        if (!row) {
          const id = randomToken();
          db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run(id, name || '用户');
          db.prepare('INSERT INTO identities VALUES(?,?,?,?,?)').run(provider, issuer, client, subject, id);
          row = { id, name: name || '用户', role: 'member' };
        }
        db.exec('COMMIT');
        return row;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    session(user) {
      const token = randomToken();
      db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.id, Date.now() + 8 * 3600_000);
      return token;
    },
    user(token) {
      return token && db.prepare(`SELECT ${userFields} FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?`).get(hash(token), Date.now());
    },
    logout(token) { if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token)); },
    transaction(payload) {
      const token = randomToken();
      db.prepare('DELETE FROM transactions WHERE expires < ?').run(Date.now());
      db.prepare('INSERT INTO transactions VALUES(?,?,?)').run(hash(token), JSON.stringify(payload), Date.now() + 600_000);
      return token;
    },
    consume(token) {
      if (!token) return null;
      const row = db.prepare('DELETE FROM transactions WHERE token=? RETURNING payload,expires').get(hash(token));
      return row && row.expires > Date.now() ? JSON.parse(row.payload) : null;
    },
  };
}
