---
name: ssl-cert-renew
description: >
  检查指定域名的 SSL 证书有效期，通过 ego-browser 重新申请阿里云个人免费证书并部署到指定 OSS 资源。
  用于免费证书续期、换证或模拟检查；默认只读模拟、阈值 15 天，真实下单和替换须有对应授权。
---

- **Version**: 0.1.3
- **License**: MIT
- **Author**: Evan Song · [github.com/Songhonglei](https://github.com/Songhonglei)
- **Repository**: https://github.com/Songhonglei/better-tech-workflow/tree/main/skills/ssl-cert-renew

# SSL 证书续期

一期支持阿里云个人测试证书（免费版）及已有 OSS 自定义域名换证。续期是申请新证书后重新部署，旧证书有效期不会延长。其他厂商、CDN、ECS 和首次启用 HTTPS 暂不执行。

## 输入

| 参数 | 规则 |
| --- | --- |
| `domain` | 必填，一次一个完整域名；根域与 www 分别处理；不接受 URL、IP、通配符或列表 |
| `threshold_days` | 默认 15，用户可指定 0–89 的整数；须小于证书 90 天期限，避免每次都续期；按精确剩余秒数比较，不先取整 |
| `mode` | 默认 `simulate`；`prepare` 在授权范围内申请新证书但不部署；`execute` 才可在授权范围内提交部署 |
| 账号与 OSS 资源 | 读取当前账号和域名绑定关系；唯一且符合用户目标时自动选定；歧义时集中询问账号、Bucket、地域或资源 ID |

没有默认域名或 OSS 资源 ID。未提供真实域名时用 `example.com` 离线模拟，真实操作前再收集目标。

## 依赖

- Python 3.9+（`python3`），脚本只使用标准库，无需 pip 安装。TLS 解码和证书解码测试需 OpenSSL 3+（`openssl`）；先检查版本，缺失或版本不符时报告并停止相应脚本，不自动安装。
- 浏览器流程需 ego-browser CLI、可控制的 Ego Lite，以及用户已登录的阿里云会话。缺失时请用户安装或登录；离线模拟不需要浏览器或云端凭据。
- 只读阶段需查看 CAS 证书和目标 OSS 域名绑定的权限；真实执行还需免费证书购买/申请、CAS 云产品部署和目标 OSS 证书更新权限。权限不足就说明缺少哪一步，不擅自授权 RAM 角色。DNS 验证授权按后文单独限定。
- 下方脚本命令均在本 Skill 目录执行；其他工作目录使用实际 Skill 路径，不假定调用者当前目录。
- `scripts/live_browser.mjs` 在 ego-browser 的 Node.js 环境中导入，无额外 npm 包；只做 DOM 和公开证书响应采集，不提交云端操作。运行证据由 `scripts/evidence_io.py` 在 Skill 外私密、原子保存。
- `scripts/runtime.py` 的跨进程锁使用 Unix `fcntl`（macOS/Linux）；Windows 不支持此执行工具，停止真实写入。`scripts/transactions.mjs` 使用 ego 自带 Node.js 和本机 `python3`，无需 npm 安装；其 `guardedSubmit` 是云端点击入口，其他采集函数只读。

## 必守边界

- 模拟通过不代表线上验收通过。默认模拟不点击购买、下单、申请、提交审核、授权、DNS 保存、预览并提交、最终提交，不发送可能写入的请求。“下一步”也可能创建任务，未核实副作用前不点击。
- **先检查原证书。** 原证书是目标 OSS 域名当前绑定的证书，不是列表里同域名的任意证书。剩余时间 **大于** 阈值，提示到期时间、剩余天数和阈值并停止整个续期；**等于** 阈值可继续检查。时间或绑定未知就停止，不能按已过期处理。
- **仅个人免费版与零元。** 下单前核对免费版、90 天、单张、无付费附加项、币种 CNY、最终应付 **0.00 元**。非零、价格或币种未知、优惠抵扣后的付费产品均中断，不改买 pro、正式证书或付费部署次数。部署预览也须确认无费用、无付费次数消耗。
- **参数和模拟结果不是授权。** `prepare/execute` 参数本身不等于授权。沿用当前会话明确覆盖目标和操作的授权，缺少时展示具体计划再确认。创建 Skill 不授权真实下单或替换；本项目首次真实替换必须等待用户确认。
- 下单、申请、部署分别记录；申请授权不自动覆盖替换。部署前向用户展示账号、域名、资源、旧/新证书 ID 和期限、费用、执行时间；已有匹配的明确确认不重复询问。自动 DNS 验证也可能写记录，须纳入申请授权；额外 RAM 授权或手工 DNS/文件验证需说明范围并取得授权。
- 保留旧证书和绑定基线；不删除、吊销、解绑旧证书，不改变 DNS 流量指向，不下载私钥。失败后先查实际绑定；旧证书仍有效可用才可提出恢复方案，实际恢复须有对应授权。

## 执行

1. 读取 [阿里云操作说明](references/aliyun.md)。需要浏览器时按已安装 `ego-browser` Skill 先执行 `ego-browser skill`，使用其当前 API。没有该 Skill 时查 CLI 帮助；缺 CLI 就报告依赖缺失，不擅自安装。一个任务使用一个 TaskSpace，按当前 snapshot 定位，不保存长期 ref、选择器或凭据。
2. 按 [真实采集与预检](references/live-evidence.md) 读取当前账号 UID、完整 Bucket/域名表和当前绑定证书。先采集当前绑定的公开 X.509 证书，按其 notAfter 判定；不要使用订阅到期时间或猜测页面时区。超过阈值立即停止。确需续期时用 `python3 scripts/inspect_tls.py DOMAIN --out /absolute/private/path/tls.json` 获取公网证书，并与控制台公开证书比较 SHA-256 指纹。
3. 用 `scripts/build_snapshot.py` 从真实绑定、控制台公开证书和独立指定目标生成标准输入；超过阈值可无 TLS 直接 skip，进入阈值须补采公网 TLS 并验证一致后才能 eligible。具体命令见 [真实采集与预检](references/live-evidence.md)。不得手填 `online_matches_current=true` 来跳过身份验证。购买和部署阶段按 [交易采集与提交](references/transactions.md) 使用 `transactions.mjs` 固定采集函数及 `build_stage.py` 生成输入，不再临时手拼规则字段。
4. `simulate`：只读或使用合成数据演练；报告跳过/符合续期条件/阻断、原因、计划及验证缺口后结束。不能为到达预览页而下单或创建任务。
5. `prepare/execute`：预检通过且申请授权明确后，按 [统一运行工具](references/runtime.md) 使用 `runtime.py begin` 取得本次 owner。先查询本账号本域名的未完成订单、已有免费额度、待申请/待验证实例、已签发可用证书及未完成部署任务。优先复用或恢复；候选不唯一就澄清。没有可复用实例才走免费购买及 `order` 检查；已签发候选用 `build_stage.py ready` 和 `runtime.py adopt` 记录。
6. 绑定精确域名，完成允许的所有权验证并等待“已签发”，核对新证书 SAN、起止时间和 ID。`prepare` 到此结束。`execute` 继续选择目标 OSS 域名资源并预览，清除自动勾选的其他资源，运行 `deploy` 检查；真实提交前核对匹配的替换确认。
7. 提交购买、支付、审核、预览及最终部署，均使用 `transactions.mjs` 的 `guardedSubmit` 先落盘本次唯一意图再点击；不要绕过工具直接点击写按钮。提交部署后使用 `readDeploymentStatus` 刷新原任务，再交 `runtime.py reconcile`；默认最多观察 10 分钟，单次等待不超过 30 秒。待部署、结果未知、失败或成功均不能重复启动原动作，不点击残留的“立即部署”。
8. “已提交/处理中”不等于“已生效”。OSS 回读已绑定新证书、公网 SNI 返回其指纹、信任与域名验证通过、HTTPS 符合原基线后，运行 `runtime.py verify`，只有返回 verified 才报告成功。结束或已停止派发动作后，用本次 owner 执行 release，保留阶段及历史。403/404 需与原基线比较，握手成功不代表网站功能正常。

## 中断与恢复

- 登录失效、MFA、验证码、用户接管：停止浏览器操作，按 ego 规则交接，不自动登录或绕过验证。
- 提交超时或响应丢失：本工具保留 submitting/unknown，只读查询原订单/证书/任务，不自动重提。即使推断未提交，也不删除意图绕过保护；确需重新提交时先保留原记录、核对云端事实，再单独处理恢复方案。
- 验证、签发、部署超时：保存实例/任务 ID，下次从原阶段恢复，不重买。部署失败说明实际绑定及下一步，不把失败视为已回滚。
- 云端写入前读取 [锁与阶段恢复](references/runtime.md)，按稳定账号+域名路径原子取得锁，保存提交意图及任务结果，结束时核对所有权并释放锁；锁存在就停止，不抢锁。记录、锁和模拟报告必须在 Skill 目录外，不记录 Cookie、Token 或私钥。
- 每次云端写入前刷新预检与相关阶段证据（10 分钟内）。账号、资源或原证书变化就重新评估，旧确认不再适用时停止。首次创建锁前同样要先做只读预检；后续读检查不受云端写入授权限制。

## 自动执行与交付

Skill 被调用时运行，不会自行常驻。一期默认每次真实替换前确认。未来用户明确授权无人值守后，才配置外部调度，并确认域名、账号、资源、阈值、频率、授权期限及 DNS 范围，费用上限固定 0 元；没有该授权时，调度只能检查并报告。本次创建不配置调度。

交付说明域名、模式、到期时间、精确剩余天数、阈值、判定、当前阶段、是否写入、下一步。分别表达离线模拟、登录后只读检查、真实签发、真实部署、公网生效。

示例：`用 $ssl-cert-renew 模拟检查 example.com，剩余 10 天内才续期，不要下单或部署。`

维护验证：`python3 -B -m unittest discover -s scripts -p 'test_*.py'`、`node scripts/test_browser.mjs`、`node scripts/test_transactions.mjs`。`test_policy.py` 覆盖规则，`test_live.py` 覆盖公开证书预检，`test_stage.py` 覆盖交易构建与验收，`test_runtime.py` 覆盖锁与恢复。规则字段见 [检查输入](references/policy-input.md)。`test_policy.py --report` 可保存到 Skill 外；非法路径在测试前退出。结构检查使用宿主 skill-creator 的校验器。测试通过不代替真实签发和换证验收；后者保存到运行报告，不把一次任务的授权写入通用 Skill。

版本历史见 [CHANGELOG.md](CHANGELOG.md)。
