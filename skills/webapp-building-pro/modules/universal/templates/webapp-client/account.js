const element = id => document.getElementById(id);
const notice = message => { element('notice').textContent = message; };
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作未完成，请稍后重试。');
  return data;
}
async function refresh() {
  const { user, auth, registration } = await api('/api/session');
  element('auth').hidden = !!user;
  element('profile').hidden = !user;
  element('files').hidden = !user;
  element('form').hidden = auth !== 'local';
  element('external').hidden = auth === 'local';
  element('external').textContent = auth === 'openai' ? 'Continue with ChatGPT' : '继续登录';
  if (auth === 'openai') element('external').setAttribute('data-oai-siwc-button', '');
  element('register').hidden = !registration;
  if (!user) return;
  element('identity').textContent = `${user.name} · ${user.role === 'admin' ? '管理员' : '普通用户'}`;
  const { files } = await api('/api/files');
  element('file-list').replaceChildren();
  if (!files.length) element('file-list').textContent = '尚无文件';
  for (const file of files) {
    const li = document.createElement('li'), link = document.createElement('a'), button = document.createElement('button');
    link.textContent = `${file.name}（${file.size} 字节）`; link.href = `/api/files/${encodeURIComponent(file.id)}`;
    button.textContent = '删除';
    button.onclick = () => action(button, async () => {
      if (!confirm(`删除“${file.name}”？此操作无法撤销。`)) return;
      await api(link.href, { method: 'DELETE' }); notice('已删除'); await refresh();
    });
    li.append(link, ' ', button); element('file-list').append(li);
  }
}
async function action(button, callback) {
  button.disabled = true;
  try { await callback(); } catch (error) { notice(error.message); } finally { button.disabled = false; }
}
async function authenticate(kind, button) {
  await action(button, async () => {
    if (!element('form').reportValidity()) return;
    const form = new FormData(element('form'));
    await api(`/api/auth/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
    element('form').reset(); notice(kind === 'register' ? '已注册并登录' : '已登录'); await refresh();
  });
}
element('form').onsubmit = e => { e.preventDefault(); authenticate('login', e.submitter); };
element('register').onclick = e => authenticate('register', e.currentTarget);
element('logout').onclick = e => action(e.currentTarget, async () => { await api('/api/auth/logout', { method: 'POST' }); notice('已退出登录'); await refresh(); });
element('upload').onsubmit = e => {
  e.preventDefault(); const form = new FormData(e.currentTarget);
  action(e.submitter, async () => {
    if (form.get('file').size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，请选择较小的文件。');
    await api('/api/files', { method: 'POST', body: form }); element('upload').reset(); notice('已上传'); await refresh();
  });
};
refresh().catch(error => notice(error.message));
