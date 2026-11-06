# 交易采集与提交

购买、申请和部署前读取。固定采集器在 ego-browser Node.js 中导入，无 npm 依赖；不下载私钥。当前适配的是本次实际观察过的阿里云中国站 V2 布局，未知布局/费用/ID 不猜值、不自动绕过。

## 固定采集

```javascript
const tx = await import('/实际Skill路径/scripts/transactions.mjs');
const live = await import('/实际Skill路径/scripts/live_browser.mjs');
// account 是本次 build_snapshot 使用的独立账号/域名观测，须在10分钟内。
const quote = await tx.readTransaction(page, 'quote', account);
await live.saveEvidence('/private/quote.json', quote);
```

account 至少含 account_id、domain、observed_at；从已核对的当前账号/绑定证据取得，不以目标账号常量冒充观测。采集器继承该账号上下文，**不会自动打开头像菜单重新登录或证明当前账号未切换**；写前仍须核对当前登录账号。

| kind/API | 采集与核对 | 输出 |
| --- | --- | --- |
| quote | 购买页“订单详情”中的个人免费版、基础版、数量1、90天、无附加服务、各费用和最终应付均0；非免费产品券后0仍阻断 | policy order 字段及来源/观测时间 |
| instance | 实例详情 URL 与订阅实例 ID 一致、个人测试、已签发、唯一 CertIdentifier | account/domain、实例/证书 ID、product/status |
| preview | 可见“任务预览”内一行，精确域名/Bucket/地域、个人证书、立即部署、一个资源/证书、0次额度，当前 route 只有一个数字 OSS 资源 ID | 目标资源、精确实例/证书/任务/资源 ID、零元依据 |
| readDeploymentStatus | 刷新当前原任务详情，按目标数据行取状态，不从残留按钮或顶部计数判断 | pending/success/failed/unknown、can_submit=false、任务身份 |

`readTransaction(page, kind, account)` 等待实际订单/证书/预览内容后解析；未完成、重复字段、多个资源、不支持的地域文本或未知币种就报错。当前地域显示映射已观察“华东1（杭州）”；直接 region code 也可解析，其他中文名称须先只读确认映射，不根据 Bucket 猜地域。购买页 CNY 依据为阿里云中国站加明确人民币符号；预览零元依据为个人免费证书与 0 次部署额度，不能推广到上传证书。

`parseQuote/parsePreview/parseInstance/parseTask` 是离线回放用的纯解析函数；输入来自 `collectTransactionDOM`，不能由手填数据取代真实观测。task 的 cas_resource_id 继承已核对预览映射，详情页独立核对 task_id/task_name、新证书、域名、Bucket/地域与 detail_id。

## 生成阶段检查输入

```bash
python3 -B scripts/build_stage.py order --preflight /private/preflight.json --evidence /private/quote.json --work /private/work.json --out /private/order.json
python3 -B scripts/build_stage.py ready --preflight /private/preflight.json --instance /private/instance.json --public /private/public-new.json --out /private/ready.json
python3 -B scripts/build_stage.py deploy --preflight /private/preflight.json --instance /private/instance.json --public /private/public-new.json --evidence /private/preview.json --out /private/deploy.json
```

- preflight 必须是 build_snapshot 的 eligible 输出；保留账号、域名、原证书、资源及最早观测时间。CLI 返回 eligible/blocked，退出码0/2；只写本地输出，不执行云端动作。
- work.json 来自本次已有工作查询：account_id、domain、resource、observed_at、quota_available、existing_work。仅完整查询未完成订单、额度、实例、候选及任务后才能填 none；该模块不自动完成这些跨页面查询，不把缺省值当 none。
- ready 用 instance 与新证书公开 PEM 重新解码，核对 CertIdentifier/序列号/SAN/90天及晚于旧证书；不使用 UI 列表时间。新证书尚未部署，不能把公网旧证书当它的公开证据。
- deploy 自动合并当前预览，核对新证书与订阅实例 ID、原目标资源和单目标零费用，再执行 policy deploy；不手填 old/new ID 或匹配布尔值。旧 ID 来自已验证的绑定基线，预览页通常只显示新 ID。
- 全部来源须在10分钟内，输出沿用最早时间。重新采集后重新构建，不只更新时间。

## 唯一提交入口

已取得运行 owner，且本次用户授权覆盖当前动作后：

```javascript
await tx.guardedSubmit(page, currentSubmitSelector, {
  account_id: account.account_id, domain: account.domain,
  owner: runOwner, action: 'deployment', snapshot: '/private/deploy.json'
});
```

- action 是 order/payment/application/preview/deployment；snapshot 分别为 order/order/preflight/ready/deploy 文件。写按钮定位符必须来自当前 snapshot，不缓存旧 ref。
- order 与 deployment 在提交入口再次采集当前报价/预览，和检查文件逐字段比对；页面变化就停止。随后 runtime intent 原子落盘，再点击一次。点击失败也不自动重试，意图保留用于恢复。
- payment 另传 ids_file（当前 order_id）和 payment_evidence（当前收银台零元证据）；application 传 ids_file（已支付订单对应 instance_id）。收银台仍按当前页面只读核对，不能沿用购买报价。
- 预览生成后：`const receipt = tx.toReceipt(preview);`，保存到 Skill 外，执行 runtime record --action preview；签发实例也可转换为 application 结果。首次复用已签发候选用 runtime adopt。
- guardedSubmit 不授予权限，不保证页面一定成功，也不全局拦截所有浏览器调用；不得绕过它直接点击写按钮。外部工具、人工操作及阿里云服务端状态仍须只读回读。

## 部署后

进入实际观察到的原任务详情 URL，expected 取已记录预览 ids（不要猜 detail_id）：

```javascript
const status = await tx.readDeploymentStatus(page, account, expected);
await live.saveEvidence('/private/task.json', status);
```

将 task.json 交 `runtime.py reconcile`。每次继续观察都刷新相同任务，观察总时长不超过10分钟、单次不超过30秒；超时保存状态并停止，不新建任务。success 后仍需 OSS 绑定、公开证书、公网 TLS 和 HTTPS 基线验收，使用 runtime verify；具体生命周期和 CLI 见 [统一运行工具](runtime.md)。

当前验证包含脱敏实操形状回放、临时签名证书、并发进程和假页面点击入口测试；不将它们称为 v0.1.3 新一轮线上换证验收。
