# hn-nurture

> Hacker News 养号与评论协作流程：选题 → 中文参考 → 用户手写发布 → flag 自检。
> 内置 HN 管理员设定的最高红线——**禁止 AI 代写或润色任何发到 HN 的文字**。

## 为什么需要这个 skill

HN 社区目前对 LLM 生成的文字极度敏感。管理员在解除账号封禁时明确要求：

> "please write any text that you post to HN by hand. Don't use an LLM to generate any of it (**not even a tiny bit, including to edit or spruce it up**) ... This is a big dividing line at present!"

这意味着常规的「让 AI 写评论」流程会直接导致封号。但 AI 仍然能做大量有价值的辅助工作——**选题、分析讨论现状、找空白角度、检测评论是否被杀**。本 skill 划清这条界线，把 AI 能做的事做到位，把不能做的事明确拦住。

## Features

- **红线护栏** —— 明确禁止代写/润色/去 AI 味，并解释为什么连"英文参考句"都不能给
- **四步协作流程** —— 选题 → 中文参考 → 用户手写发布 → flag 自检
- **三层 flag/kill 检测** —— 区分「正常 / flagged / dead(silent kill)」，含判定标准与 5 个实测踩坑
- **空白角度挖掘法** —— 三个问题定位"评论区还没人说的角度"，附高/低风险写法清单
- **隐私优先的配置化** —— 账号与背景存 `~/.config`，skill 仓库内零个人信息
- **申诉指南** —— 正确联系渠道 + 申诉邮件写法要点

## Quick Start

```bash
# 1. 安装（clawhub）
clawhub install hn-nurture

# 或直接克隆
git clone https://github.com/Songhonglei/hn-nurture.git
```

```bash
# 2. 配置个人档案（HN 用户名、职业背景、选题方向）
bash scripts/setup_profile.sh

# 查看当前配置（用户名脱敏展示）
bash scripts/setup_profile.sh --show
```

然后对 agent 说：「今天 HN 养号」，agent 会读配置、筛选题、给角度，你手写发布后它做 flag 自检。

## Privacy

**仓库内不存储任何账号、雇主或身份信息。** 所有个人数据写入 `~/.config/hn-nurture/profile.env`（权限 600），位于用户 HOME 而非 skill 目录：

- skill 升级 / 重装不丢配置
- 配置不随 skill 进 git，可安全公开仓库

配置项：

| 变量 | 用途 |
|---|---|
| `HN_USERNAME` | HN 用户名，flag 自检定位评论用 |
| `USER_ROLE` | 职位角色，判断能写什么一手经验 |
| `USER_EXPERTISE` | 专业领域，选题方向锚点 |
| `TOPIC_DIRECTIONS` | 允许的选题方向全集 |
| `TOPIC_STRONG` | 强优势方向，优先选 |
| `TOPIC_WEAK` | 需谨慎方向，必须挂具体经历 |
| `TOPIC_AVOID` | 明确排除的方向 |

环境变量优先级高于配置文件，便于临时覆盖或 CI 使用。

## Usage

详细流程见 [SKILL.md](./SKILL.md)。

| 文件 | 用途 |
|---|---|
| `references/flag-detection.md` | 三层 flag/kill 检测技术方法 |
| `references/lessons.md` | 账号风险教训清单（无个人信息） |
| `references/topic-playbook.md` | 配置字段映射、选题分级、风险写法清单 |
| `references/hn-contact.md` | 联系 HN 管理员渠道 + 申诉写法 |

## Requirements

flag 检测依赖浏览器自动化工具（原实现基于 ego-browser）。若不可用，仍可完成选题环节，但可见性检测无法执行。

## Install in your AI agent

| Agent | Install |
|---|---|
| OpenClaw | `clawhub install hn-nurture` |
| Claude Code | Manual: copy to `~/.claude/skills/` |
| Cursor | Manual: copy to `.cursor/skills/` |

## License

MIT (see [LICENSE](./LICENSE))

## Author

Evan Song · [github.com/Songhonglei](https://github.com/Songhonglei)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.
