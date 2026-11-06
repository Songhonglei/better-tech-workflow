# SSL 证书续期

检查指定域名的证书期限，在授权范围内申请阿里云个人免费证书并替换已有 OSS 域名绑定。默认只读模拟，剩余有效期不超过 **15 天**才进入续期流程，阈值可指定。

当前版本 **0.1.3**。免费版 90 天；购买和部署必须零元；保留旧证书。支持 macOS/Linux，通过已登录的 ego-browser 执行。尚未支持 CDN、ECS、首次启用 HTTPS 或无人值守完整验收。

## 安装

在仓库根目录执行，选择自己的 Agent skills 目录：

```bash
mkdir -p ~/.codex/skills
cp -R skills/ssl-cert-renew ~/.codex/skills/
```

Claude Code 可复制到 `~/.claude/skills/`；其他平台使用对应目录。需要已安装 `ego-browser` Skill 与 CLI、可控制的 Ego Lite 和已登录的阿里云会话；Python 3.9+、OpenSSL 3+。离线 Node 测试还需 PATH 中可运行的 `node`。不自动安装依赖。

本目录可独立复制使用，不依赖仓库中其他 Skill。当前通过 GitHub 分发；没有因收录到本仓库而自动发布到 ClawHub、SkillHub 或配置定时任务。

## 使用

```text
用 $ssl-cert-renew 模拟检查 example.com，剩余 10 天内才续期，不要下单或部署。
```

需要真实执行时，指定域名，并明确授权免费申请、允许的域名验证和 OSS 替换范围。Skill 会核对当前账号及唯一绑定的 Bucket/地域；信息有歧义时再集中确认。根域和 www 的部署授权分别处理。

| 能力 | 行为 |
| --- | --- |
| 到期检查 | 以当前绑定公开 X.509 证书的准确期限判断；超过阈值立即跳过 |
| 身份核对 | 比较账号、域名、资源及控制台/公网证书指纹 |
| 免费申请 | 只允许个人免费版、90天、单张、无付费附加项，最终应付 CNY 0 |
| 防重复 | 提交前保存唯一意图；超时后查询原订单/实例/任务，不重复点击 |
| 运行恢复 | 统一 owner 锁、阶段和业务 ID；支持已签发候选复用与历史归档 |
| 部署验收 | 回读 OSS 绑定、核对公网受信任证书及 HTTPS 原基线后才报告成功 |

完整执行入口见 [SKILL.md](SKILL.md)。交易采集与提交见 [references/transactions.md](references/transactions.md)，锁和恢复见 [references/runtime.md](references/runtime.md)。工具返回的 eligible/allowed_once 只表示本阶段本地检查通过，不代表用户授权或线上操作成功。

## 验证

在本 Skill 目录执行，先确认当前命令环境满足 OpenSSL/Node 依赖：

```bash
openssl version
node --version
python3 -B -m unittest discover -s scripts -p 'test_*.py'
node scripts/test_browser.mjs
node scripts/test_transactions.mjs
```

0.1.3 有 37 项 Python 测试和两组 Node 回归，使用临时证书、临时运行目录和假页面，覆盖费用、目标身份、并发锁、中断恢复及购买/部署点击防重。真实零元申请、OSS 替换和公网生效曾在 0.1.2 验证；0.1.3 新工具已通过隔离测试，不冒充新增线上验收。

## 数据与边界

运行状态保存在 `~/.local/state/ssl-cert-renew/`，证据保存到调用时指定的 Skill 外私有目录；不随安装包同步。账号 UID、域名、Bucket、订单和任务等真实业务记录只存在本地运行数据，不提交到仓库。不下载私钥，不存 Cookie/Token，不自动修改 RAM 权限或 DNS 流量指向。

固定采集器覆盖购买摘要、签发实例、部署预览和原任务状态。收银台金额、已有工作和额度仍须按当前页面只读确认；未知值不会默认填零或 none。中文地域显示目前验证杭州，其他未识别的地域显示停止补映射。遗留锁及结果未知的提交不自动清除或重提。

## 在本仓库维护

代码在 `skills/ssl-cert-renew/` 独立维护版本。更新时同步本目录说明和 [CHANGELOG.md](CHANGELOG.md)，并更新仓库根 README 的 Skill 索引与仓库 CHANGELOG；运行 UGLIC、skill-release-audit，修复非误报问题后提交。不要把单个 Skill 的目录当作整个仓库推送。

## License

[MIT](LICENSE) · Evan Song · [版本历史](CHANGELOG.md)
