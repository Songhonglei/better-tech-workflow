# HN 评论 Flag / Kill 检测技术手册

> 依赖 ego-browser skill。所有操作通过 `ego-browser nodejs <<'EOF' ... EOF` heredoc 执行。

## 一、三种状态的判定标准

| 状态 | 作者视角 | threads 页 | 匿名 item 页 | newcomments |
|------|---------|-----------|-------------|-------------|
| 正常 | 可见 | 出现，无标记 | 正文可搜到 | 出现 |
| **flagged** | 可见 | 出现，带 `[flagged]` | 行还在，正文被替换为 `<div class="comment noshow">[flagged]</div>` | 不出现 |
| **dead（silent kill）** | 可见 | **不出现** | **整行从 HTML 消失** | 不出现 |

**silent kill 比 flagged 更严重** —— 评论对作者可见、对所有人不可见，且无任何标记，是隐形 shadow-ban。

## 二、检测方法（三层，缺一不可）

### 层 1：threads 页（登录态）

```bash
ego-browser nodejs <<'EOF'
const task = await useOrCreateTaskSpace('HN flag check')
await openOrReuseTab('https://news.ycombinator.com/threads?id=<USERNAME>', { wait: true, timeout: 25 })
await wait(2)
const t = await snapshotText()
cliLog('flagged count: ' + ((t.match(/\[flagged\]/g) || []).length))
cliLog('new comment on threads: ' + t.includes('<COMMENT_ID>'))
EOF
```

- `[flagged]` 计数：访问 `/threads?id=<用户名>`，统计页面文本中 `[flagged]` 出现次数
- **唯一的 flag 权威判据**

❌ 不要用 item 页的 DOM 检查（`hasFlagClass` / `flagEl` / `collSpan`）—— **假阴性**，HN 对作者在 item 页隐藏 flag 标记
❌ 不要用 snapshotText 的 `/flagged/i` 正则裸匹配 —— 会匹配到其它文本造成误报

### 层 2：item 页匿名可见性（决定性）

```bash
ego-browser nodejs <<'EOF'
const html = await serverFetch('https://news.ycombinator.com/item?id=<POST_ID>')
cliLog('text visible: ' + html.includes('<评论正文的独特短语>'))
EOF
```

**必须用评论正文的独特短语搜索，不要用评论 ID。**

- ❌ 用评论 ID 判断会误判：ID 会以 `prev`/`next` 导航链接形式残留在 HTML 里
- ❌ 正则 `class="comtr"` 会漏匹配：HN 实际写作 `class="athing comtr"`
- ✅ 正确做法：取评论正文里 3-5 个独特词

**每次检查必须带一个已知存活的基线评论做对照**，否则无法区分"评论被杀"和"检测方法挂了"。

### 层 3：newcomments 页（匿名）

```bash
const nc = await serverFetch('https://news.ycombinator.com/newcomments')
cliLog('in newcomments: ' + nc.includes('<评论正文的独特短语>'))
```

## 三、关键工具特性

| 工具 | 特性 |
|------|------|
| `serverFetch(url)` | Node 侧发起，**不带 cookie** = 匿名视角。检测可见性必须用它 |
| `browserFetch(url)` | 浏览器上下文发起，**带 cookie**。偶尔返回空/超时，不可靠 |
| `snapshotText()` | 当前登录态页面的语义树，最可靠但需先导航到目标页 |
| `js(code)` | 页面内执行 JS，`Runtime.evaluate` |

## 四、常用代码片段

### 解析首页帖子列表

```javascript
const html = await serverFetch('https://news.ycombinator.com/news')
const items = [...html.matchAll(/<tr class="athing[^"]*" id="(\d+)"[\s\S]*?<span class="titleline"><a href="[^"]*"[^>]*>([^<]+)<\/a>/g)]
  .map(m => ({ id: m[1], title: m[2].replace(/&#x2F;/g,'/').replace(/&#\d+;/g,'') }))
```

注意 `titlelink` 的 class 名可能变化，若解析失败改用浏览器 snapshotText 读取。

### 提取某帖全部评论

```javascript
const comments = await js(String.raw`(() => {
  const rows = [...document.querySelectorAll('tr.athing.comtr')]
  return rows.map(r => {
    const u = r.querySelector('.hnuser')
    const txt = r.querySelector('.commtext')
    return (u ? u.innerText : '?') + ': ' + (txt ? txt.innerText.replace(/\s+/g,' ').substring(0, 280) : '')
  }).join('\n---\n')
})()`)
```

### 定位自己的评论 ID

```javascript
const id = await js(String.raw`(() => {
  const rows = [...document.querySelectorAll('tr.athing.comtr')]
  const hit = rows.find(r => r.innerText.includes('<自己的独特词组>'))
  return hit ? hit.id : 'NOT_FOUND'
})()`)
```

## 五、踩过的坑

1. **zsh heredoc 与模板字符串**：`<<'EOF'` 内若用 `${...}` 模板字面量会被 shell 解析导致 Bad substitution。改用字符串拼接或 `String.raw`
2. **reply 页空白**：`openOrReuseTab` 复用 tab 时 reply 页偶尔只渲染出浏览器扩展元素、HN 内容为空。用 `gotoAndWait` 强制重新导航，或改从 item 页底部的评论框提交
3. **HN 对老帖关闭回复**：超过约两周的帖子无法回复，reply 页会返回空表单，不要误判为被禁言
4. **threads 页分页**：一周前的评论会被挤到分页后，首页看不到不代表被杀，需点 "More" 或改用 item 页检测
5. **解封后旧评论不会恢复**：管理员解除账号限制时不会逐条捞回历史 dead 评论，只有新发的评论恢复正常
