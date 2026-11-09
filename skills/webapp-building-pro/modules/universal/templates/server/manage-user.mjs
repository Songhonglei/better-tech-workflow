import 'dotenv/config';
import path from 'node:path';
import { createStore } from './store.mjs';
const [action, identity, role] = process.argv.slice(2);
if (action !== 'list' && (action !== 'role' || !identity || !['member', 'admin'].includes(role))) {
  console.error('Usage: node server/manage-user.mjs list | role <username|id:USER_ID> <member|admin>');
  process.exit(2);
}
const { db } = createStore(path.resolve(process.env.WEBAPP_DATA_DIR || '.webapp-data'));
if (action === 'list') console.log(JSON.stringify(db.prepare('SELECT id,username,name,role FROM users').all(), null, 2));
else {
  const byId = identity.startsWith('id:');
  const result = db.prepare(byId ? 'UPDATE users SET role=? WHERE id=?' : 'UPDATE users SET role=? WHERE username=?')
    .run(role, byId ? identity.slice(3) : identity.toLowerCase());
  if (result.changes !== 1) { console.error('Account not found'); process.exitCode = 1; }
  else console.log('Role updated');
}
db.close();
