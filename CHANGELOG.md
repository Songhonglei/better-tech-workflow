# Changelog

All notable changes to this repository are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

Repo-level versions track the skill suite as a whole. Each skill keeps its own version history
in `skills/<slug>/CHANGELOG.md`.

### v0.2.0 (2026-11-06)

- 在 `skills/ssl-cert-renew/` 收录 SSL 证书续期 Skill v0.1.3，包含独立 README / LICENSE / CHANGELOG。
- 支持阿里云个人免费证书及已有 OSS 域名绑定：默认模拟、阈值15天、零元校验、防重复提交与中断恢复。
- 更新仓库 README 的 Skill 索引、Codex 安装方法及运行数据隐私说明；保留既有 hn-nurture。

### v0.1.0 (2026-09-01)

- 初始化 multi-repo 结构（仓库级 README / LICENSE / CHANGELOG / .gitignore + `skills/` 目录）
- 收录首个 skill：`hn-nurture` v1.0.0
  - Hacker News 养号四步流程：选题 → 中文参考 → 用户手写发布 → flag 自检
  - 最高红线：禁止 AI 代写 / 润色任何发到 HN 的文字
  - 三层 flag/kill 检测手册（正常 / flagged / dead 判定标准）
  - 隐私优先配置化：个人档案存 `~/.config/hn-nurture/profile.env`，仓库内零个人信息
