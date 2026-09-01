# Changelog

All notable changes to this skill are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

### v1.0.0 (2026-09-01)

- Initial open-source release
- 最高红线：禁止 AI 代写 / 润色任何发到 HN 的文字（含管理员原话与理由说明）
- 四步协作流程：选题 → 中文参考 → 用户手写发布 → flag 自检
- 三层 flag/kill 检测手册（正常 / flagged / dead 判定标准 + 5 个踩坑）
- 空白角度挖掘法 + 高 / 低风险写法清单
- 隐私优先配置化：账号与背景存 `~/.config/hn-nurture/profile.env`，仓库内零个人信息
- `scripts/setup_profile.sh` 交互式配置（支持 --show / --path / --non-interactive）
- HN 管理员联系渠道 + 申诉邮件写法要点
