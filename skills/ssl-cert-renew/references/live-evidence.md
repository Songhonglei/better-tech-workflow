# 真实采集与预检

在真实域名检查时读取。离线模拟可使用合成输入；真实执行不得把猜测的时区、资源 ID 或匹配布尔值当作观测。

## 清单

在同一个 ego TaskSpace 中导入 `scripts/live_browser.mjs`：

```javascript
const live = await import('/实际Skill路径/scripts/live_browser.mjs');
const buckets = await live.readInventory(page, 'buckets');
await live.saveEvidence('/私有目录/buckets.json', buckets);
```

`readInventory` 在真实表格出现数据行或明确空状态后才返回；等待分页按钮出现不足以证明数据已加载。Bucket 链接按 URL pathname 解析，忽略追踪查询参数并合并固定列重复链接。`domains` 从数据行读绑定，不从侧栏或搜索框提取域名；全量采集前清空筛选。

- `complete=true` 才可用作全量判断；多页返回 `complete=false`，须按当前 snapshot 的下一页按钮读取每页，记录页码、总页数并核对覆盖后合并；不得凭第一页声称全部站点为空。
- DOM 结构改变、只有表头、找不到数据且没有明确空状态：采集失败，保留证据并中断，不能报告零目标。
- `domains` 对已验证的 OSS 域名管理无分页表返回 complete；若页面出现分页则按上述逐页处理。未覆盖的地域、账号或平台单独报告范围不完整。

## 当前绑定的公开证书

1. 从 OSS 证书详情读取当前证书 ID；从头像菜单读取稳定账号 UID，从实际地址/表格核对地域、Bucket、域名、绑定与 CDN 情况，存为 binding.json。
2. `capturePublicCertificate(page, openSelector, certificateId)` 只观察本次点击“证书详情”产生的 `get_cert_public_key.json` 响应，在同一轮调用内取得响应正文。它验证证书 ID，解开控制台的嵌套 JSON 字符串，只输出公开 X509Certificate 和白名单元信息，不导出原始响应头、Cookie、Token 或私钥。打开定位符来自当前 snapshot；先关闭旧弹窗，悬浮账号菜单离开后再操作，避免遮挡。
3. 网络请求 ID 只在当前轮使用，不持久化后重用。接口/布局变化导致无法唯一捕获时停止，只读重查；不要猜测并调用写接口。
4. `parsePublicResponse` 保留 `provider_not_before/after`。唯一期限权威是公开证书本身的 notBefore/notAfter。当前实测接口元信息与 X.509 相差 8 小时；保留差异供复核，不据此改写 X.509 时间，也不拿供应商命名的 Sha2 字段代替本地 DER SHA-256 指纹。

捕获的 public.json 包含 `certificate_id`、`serial_number`、`public_certificate`（公开 PEM）、provider 时间、`observed_at`。PEM 链只取第一张叶证书；它必须与响应序列号、当前绑定 ID 和公网指纹对应。公开文件可用 `inspect_tls.py --certificate-file /private/public.pem --out /private/decoded.json` 解码；该命令只解码，不授予信任。

## 标准输入与规则

binding.json 由当前真实页面生成：account_id、domain、region、bucket、bound、cdn_configured、certificate_id、observed_at。expected.json 独立保存用户指定的目标账号/domain/Bucket/地域，不从观测结果反向改成“匹配”。

```bash
# 先按当前绑定公开证书判断是否超过阈值；超过时直接 skip，不要求公网探测。
python3 scripts/build_snapshot.py --binding /private/binding.json --controlplane /private/public.json --expected /private/expected.json --threshold-days 15 --out /private/preflight.json
# 进入阈值但缺公网证据时返回 blocked；补采后再次执行。
python3 scripts/inspect_tls.py example.com --out /private/tls.json
python3 scripts/build_snapshot.py --binding /private/binding.json --controlplane /private/public.json --tls /private/tls.json --expected /private/expected.json --threshold-days 15 --out /private/preflight.json
python3 scripts/policy.py order /private/order-snapshot.json
python3 scripts/policy.py deploy /private/deploy-snapshot.json
```

适配器核对真实目标、公开 X.509 序列号、有效期、公网指纹和信任状态，保留最早观测时间，证据不得超过 10 分钟。输出 `resource.id` 是实际地域/Bucket/域名派生的稳定 `oss://REGION/BUCKET/DOMAIN` 绑定键，**不是 CAS 数字资源 ID**；部署数字 ID 必须从当前控制台另行观测并与该绑定核对，不能拿绑定键或旧示例编号冒充。

超过阈值的快照保留 `online_matches_current=false`，只表示当前绑定的公开证书已核验、无需续期，不声称公网匹配；该快照不能用于下单或部署。进入阈值后必须提供 `--tls`，缺失、过旧、身份或信任不符就阻断。此处无需续期的 skip 优先于公网检查，避免网络异常让无需执行的任务继续后续流程。

新证书签发后，先从实例详情读取精确 CertIdentifier。仅在当前运行已经观测到公开证书只读接口及参数后，可用浏览器同会话按新 ID 读取该公开证书并调用 `parsePublicResponse`；接口未知就只读定位，不猜接口。用本地解码得到新证书起止时间、SAN、序列号、DER 指纹；新签发证书尚未部署时不能拿公网旧证书当作它的证据。部署后再从 OSS 当前绑定重新采集并与签发前新证书、公网三方比对。

返回 eligible/skip/blocked，含原因；退出码 0 可能是 skip，必须读取 decision。只有 eligible 且本次授权覆盖动作才继续。追加 order/deploy 字段时保留真实预检链，写入前刷新相关证据，不只更新时间。`writes_performed=false` 表示未做云端写入，`--out` 会保存本地证据。

一次真实换证授权可以指定覆盖旧证书剩余期限的单次阈值；将域名、阈值和授权记录在私有运行记录中，默认 15 天不随本次验证改变。不要增加可由 JSON 自行宣称获得授权的开关。
