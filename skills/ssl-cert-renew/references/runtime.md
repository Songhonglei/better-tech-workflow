# 统一运行工具

真实写入前读取。`scripts/runtime.py` 管理本地锁、提交意图、结果和历史；不调用阿里云，不授予用户授权。浏览器写操作经 `transactions.mjs guardedSubmit` 调用它。模拟不取得锁，不修改生产运行目录。

## 生命周期

1. 完成真实只读预检，得到 fresh preflight.json。首次执行须 eligible；恢复未完成运行允许有效的 skip 快照，只允许查询和验收，写入仍须 eligible。
2. `begin` 原子取得本次 owner，输出稳定 run_id 和已有 operations。已有锁就停止；同账号/规范域名始终使用默认路径，不能换目录避锁。
3. 每次云端写入使用 guardedSubmit：本地 `intent` 先落盘 submitting，再点击一次。购买、支付、申请、预览、最终部署分别记录为 order/payment/application/preview/deployment。预览也可能创建任务，不能省略意图。
4. 收到当前页面结果后 `record`。预览和签发结果用 `toReceipt` 从固定采集结果生成；订单、支付结果从当前已观察到的成功页面记录业务 ID，不按按钮回执推断成功。跨步骤 ID 不匹配即停止。
5. 部署提交后，只查询原任务，用 readDeploymentStatus 刷新，再 `reconcile`。pending/unknown → query_existing；success → verify；failed → stopped；全部 can_submit=false。成功/失败终态不可退回旧状态。
6. 通过 `verify` 验收后 phase=verified。常规结束、失败、观察超时或用户接管：先停止派发动作，再在 finally 使用本次 owner 调用 release；释放不清空操作记录。

## CLI

命令相对 Skill 根目录执行；所有证据文件用 Skill 外绝对路径。全局参数放在子命令之前。

```bash
python3 -B scripts/runtime.py --account UID --domain example.com begin --snapshot /private/preflight.json
python3 -B scripts/runtime.py --account UID --domain example.com status
python3 -B scripts/runtime.py --account UID --domain example.com intent --owner OWNER --action order --snapshot /private/order.json
python3 -B scripts/runtime.py --account UID --domain example.com record --owner OWNER --action order --evidence /private/order-result.json
python3 -B scripts/runtime.py --account UID --domain example.com adopt --owner OWNER --snapshot /private/ready.json
python3 -B scripts/runtime.py --account UID --domain example.com reconcile --owner OWNER --evidence /private/task.json
python3 -B scripts/runtime.py --account UID --domain example.com verify --owner OWNER --binding /private/binding-after.json --public /private/public-after.json --tls /private/tls-after.json --https-before /private/https-before.json --https-after /private/https-after.json
python3 -B scripts/runtime.py --account UID --domain example.com release --owner OWNER
```

- `intent` 只供 guardedSubmit 内部使用；输出 allowed_once 表示本次本地意图已保存，随后立即点击一次。不要手工执行 intent 后又调用 guardedSubmit（会被判重）；不可将 allowed_once 保存供以后重复使用。
- `--action`：order/payment/application/preview/deployment。order/payment 要 `build_stage.py order` 输出；preview 要 ready 输出；deployment 要 deploy 输出。每个动作只允许一次意图，没有自动重试接口。
- `--ids-file`：payment 须含当前 order_id；application 须含已支付订单对应的 instance_id。preview/deployment 的 ID 从已验证候选和预览自动取得。
- payment 另需 `--payment-evidence /private/cashier.json`：当前收银台 account_id、domain、order_id、observed_at、currency=CNY、payable。只读核对收银台字段后保存；未知、非零或不同订单就阻断，不能沿用购买页报价。当前没有收银台 DOM 自动采集器，字段须按当前页面确认。
- `record --evidence`：account_id、domain、observed_at、status 和 ids。status 只能 pending/success/failed/unknown；ids 只允许 order_id、instance_id、certificate_id、task_id、task_name、detail_id、cas_resource_id，不接受凭据、原始响应或任意字段。order 成功需 order_id；payment 成功需 order_id，并在申请前补齐当前对应的 instance_id；application 成功需 instance_id+certificate_id；preview 成功需任务/证书/资源 ID。
- 已有已签发候选：ready 构建通过后 adopt，不要求重买或伪造 order/payment；有未完成操作时先恢复该对象，不能改用另一张候选覆盖记录。已有待申请但未纳入本工具的历史实例，先只读核对订单、支付与实例对应关系，保留历史，不能用 adopt 冒充已签发。
- verify 核对部署成功、签发前指纹、实际绑定公开证书、公网受信任证书、精确目标、HTTPS 前后基线及时序。HTTPS 文件含 observed_at、url、status；before 须早于部署意图，after 须晚于意图且在 10 分钟内。HTTP 状态一致不代表网站全功能验收。
- 返回 JSON；成功/已记录退出码 0，blocked 退出码 2。`writes_performed=false` 指没有云端写入，工具会写本地运行状态。必须读 decision，不能把退出码 0 当作换证已完成。

## 锁与持久化

默认目录 `~/.local/state/ssl-cert-renew/sha256(JSON([UID, domain], separators=(",", ":")))`。短时修改用 fcntl 排他锁；跨 Agent 轮次用 run.lock 的随机 owner；run_id 标识同一次业务运行。文件 0600、目录 0700；state.json 临时写入、flush/fsync 后原子替换，journal 与操作在同一状态文件内保存。只记录业务标识和状态，不保存 Cookie/Token/私钥。

`--state-root` 仅用于隔离测试或用户明确指定的部署目录；常规运行固定默认根目录。macOS/Linux 支持，Windows 停止真实写入。本地工具不拦截用户手工操作或绕过工具的直接浏览器调用，因此 Skill 所有写按钮必须走 guardedSubmit。

## 中断与恢复

- 响应丢失、点击超时、进程崩溃：意图仍为 submitting；不重新点击。查询原对象，结果明确后 record/reconcile。锁已释放则 begin 恢复相同 run_id 和 operations；不会清空历史。
- 本地仍有锁：不按年龄/PID 抢锁，不新建目录。先只读查询。确认原任务及浏览器动作已停止，且已有用户对应恢复授权后，用原 owner release 再 begin；无该确认则停止。工具不自行处理 MFA 或用户接管。
- 后台成功而 UI 旧：刷新同一任务，以精确任务 ID、目标行和新证书 ID 判断，不读页面顶部“部署成功 0”计数，也不因残留“立即部署”按钮重提。
- 记录已进入 verified 后，旧响应不能覆盖；下次真正进入阈值且当前绑定仍是上次新证书时，begin 将完整旧状态归档到 history，再建立新 run_id。
- 旧版 state：只有 phase=verified、账号/域名及当前绑定均匹配时允许归档后开始新运行；旧版未完成、损坏或身份不符就停止，不把它当作没有历史。未完成新版本若当前绑定已是本次新证书，允许恢复查询及验收，禁止重买。
- 状态写入失败即阻断，不派发浏览器点击；拿不到 owner 或无法确认动作是否在途时保留锁。不要删除 state/journal 或改写终态来绕过保护。

v0.1.3 已有离线并发、响应丢失、恢复、磁盘错误、终态和三方验收回归。真实换证记录来自 v0.1.2；本版未为测试再次购买或替换线上证书。
