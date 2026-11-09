# Better Tech Work Flow

> AI Agent Skill Suite — 技术工作流技能套件，覆盖技术内容推广、账号养成、Agent 流程等高频技术工作场景。

## Skills

| Skill | Description |
|---|---|
| [hn-nurture](./skills/hn-nurture/) | Hacker News 养号：选题 → 中文参考 → 用户手写发布 → flag 自检。内置 HN 管理员设定的最高红线（禁止 AI 代写），支持 `~/.config` 隐私配置与三层 flag/kill 检测 |
| [ssl-cert-renew](./skills/ssl-cert-renew/) | SSL 证书续期：按域名和到期阈值检查，授权后申请阿里云个人免费证书并替换 OSS 绑定；零元校验、提交防重和中断恢复 |
| [webapp-building-pro](./skills/webapp-building-pro/) | Web 应用与小红书小工具开发：自定义模板、通用多用户、自选 OSS/CloudBase/WebDAV、存储检查与多平台交付；AI 功能列为 2.0 待实现 |

## Quick Start

每个 skill 独立可用，详见各自目录下的 `SKILL.md`。

```bash
# 克隆本仓库
git clone https://github.com/Songhonglei/better-tech-workflow.git
cd better-tech-workflow

# 将需要的 skill 复制到你的 agent skills 目录
cp -r skills/hn-nurture ~/.workbuddy/skills/
# 或 ~/.claude/skills/ / ~/.cursor/skills/ 等

# hn-nurture 首次使用需配置个人档案
bash ~/.workbuddy/skills/hn-nurture/scripts/setup_profile.sh
```

安装 SSL 续期 Skill（默认只读模拟，真实申请和替换另需授权）：

```bash
mkdir -p ~/.codex/skills
cp -R skills/ssl-cert-renew ~/.codex/skills/
```

详见 [SSL 续期说明](./skills/ssl-cert-renew/README.md)。

Web 应用开发安装方法与运行条件见 [Webapp Building Pro](./skills/webapp-building-pro/README.md)。

## Install via Agent Platforms

| Platform | Install |
|---|---|
| OpenClaw | Manual: copy to `~/.openclaw/skills/`；已上架的 Skill 也可用 `clawhub install <skill-name>` |
| Codex | Manual: copy to `~/.codex/skills/` |
| Claude Code | Manual: copy to `~/.claude/skills/` |
| Cursor | Manual: copy to `.cursor/skills/` |
| WorkBuddy | Manual: copy to `~/.workbuddy/skills/` |

## Repo Structure

```
better-tech-workflow/
├── README.md          ← 本文件（skill 索引）
├── CHANGELOG.md       ← 仓库级版本历史
├── LICENSE            ← MIT
└── skills/
    └── <skill-slug>/  ← 每个 skill 自带 SKILL.md / README / LICENSE / CHANGELOG
```

本仓库采用 **multi-repo** 结构：一个仓库收纳多个独立 skill，每个 skill 自带完整的
`SKILL.md` / `README.md` / `LICENSE` / `CHANGELOG.md`，可单独复制使用，也可单独发布到
各 skill 平台。新增 skill 时在 `skills/` 下建目录，并更新本文件的索引表格与 `CHANGELOG.md`。

## Privacy

仓库内的 skill 均不硬编码个人账号、雇主或身份信息。需要个人数据的 skill 会把配置存放在
用户 HOME 的 `~/.config/<skill-slug>/` 或 `~/.local/state/<skill-slug>/`（不随仓库提交）；额外运行证据保存到 Skill 外私有目录，详见各 skill 的 README。

## License

MIT (see [LICENSE](./LICENSE))；来源资源的许可范围以各 Skill 内的说明为准。

## Author

Evan Song · [github.com/Songhonglei](https://github.com/Songhonglei)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.
