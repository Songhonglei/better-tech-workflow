---
name: hn-nurture
description: >
  Hacker News 养号与评论协作流程。当用户要求执行 HN 养号、筛选 HN 评论选题、
  检查评论是否被 flag 或 kill、给 HN 帖子找可写的角度、或处理 HN 账号封禁申诉时使用。
  内置 HN 管理员设定的最高红线——禁止 AI 代写或润色任何发到 HN 的文字。
  支持通过 ~/.config/hn-nurture/profile.env 配置个人账号与选题方向。
---

- **Version**: 1.0.0
- **License**: MIT
- **Author**: Evan Song · [github.com/Songhonglei](https://github.com/Songhonglei)
- **Repository**: https://github.com/Songhonglei/hn-nurture

# HN 养号协作流程

## ⛔ 最高红线：禁止 AI 代写（违反即永久封号）

HN 管理员在解除账号封禁时的原话：

> "please write any text that you post to HN by hand. Don't use an LLM to generate any of it (**not even a tiny bit, including to edit or spruce it up**). Reason: the community is super fussy about this right now... This is a big dividing line at present!"

**绝对禁止的行为：**

- ❌ 撰写、起草评论正文（无论中英文）
- ❌ 生成"参考英文例句"或"可直接复制的模板"
- ❌ 对用户自己写的文字做润色、改写、去 AI 味、语法修正
- ❌ 用脚本或自动化工具代替用户点击发布

**允许的行为：**

- ✅ 筛选候选帖子、给 URL、梳理帖子要点与现有讨论状况
- ✅ 指出还没人说的空白角度（用中文描述思路）
- ✅ 提示用户可调用的真实经历素材
- ✅ 用户发布后执行 flag 自检

**为什么要连"英文成句"都不给**：即便用户不照抄，读过 LLM 生成的句子后落笔时很难完全绕开其措辞，实质上仍是 LLM 参与了生成。因此参考信息一律用**中文**输出「角度 + 素材 + 可写的点」，英文表达完全由用户自己组织。

**账号通常只有一次解封机会。** 一旦用过，再犯不会有第二次。

## 首次使用：配置个人档案

本 skill 不硬编码任何账号与背景信息。执行选题或检测前，先读取用户档案：

```bash
cat ~/.config/hn-nurture/profile.env 2>/dev/null || echo "NOT_CONFIGURED"
```

**若返回 `NOT_CONFIGURED`**，提示用户运行：

```bash
bash scripts/setup_profile.sh
```

交互式填写 7 个字段：HN 用户名、职位角色、专业领域、选题方向全集、强优势方向、需谨慎方向、排除方向。配置写入 `~/.config/hn-nurture/profile.env`（权限 600），位于用户 HOME 而非 skill 目录——升级 / 重装 skill 不丢，且不会随 skill 进 git。

其它用法：`--show` 查看当前配置（用户名脱敏）、`--path` 打印路径、`--non-interactive` CI 模式。

**环境变量优先级**：`HN_USERNAME` 等环境变量 > `profile.env` 文件。

字段含义与选题映射见 `references/topic-playbook.md`。

## 四步协作流程

### 第 1 步：选题

读取配置后，按 `TOPIC_DIRECTIONS` 扫 HN 首页与 newest，筛出候选帖并输出：

- 帖子标题 + URL + 分值 / 评论数 / 发布时间
- 帖子在讲什么（2-3 句）
- 现有评论已覆盖的角度（避免撞车）
- 还没人说的空白角度（重点，1-2 个）
- 用户可调用的真实经历素材提示（中文，基于 `USER_ROLE` / `USER_EXPERTISE` 推导）
- 写法提醒：2-4 句、口语、避开自我推广腔、结尾可抛问题

优先选**低热度 + 方向契合 + 用户有第一手经验**的帖子。高热度争议帖一律避开。

### 第 2 步：给中文参考

只输出中文的思路、角度、素材清单。**不生成任何英文句子。**

### 第 3 步：用户手写并手工发布

用户自己撰写英文、自己在浏览器里打字提交。不代劳、不代填表单。

### 第 4 步：flag 自检

用户发布后告知帖子链接或评论中的独特词组，按 `references/flag-detection.md` 执行三层检测。等待 5 分钟后再检（即时 flag 通常在数分钟内发生）。

## 节奏

- 1 条/天起步，稳定两周后再评估
- 每条发布后必须做 flag 自检
- 出现连续 2 条被 kill 立即停发，进入冷置并复盘

## 参考资源

| 文件 | 用途 |
|------|------|
| `references/flag-detection.md` | 三层 flag/kill 检测的完整技术方法（必读，含判定标准和踩坑） |
| `references/lessons.md` | 账号风险教训清单（无个人信息，通用经验） |
| `references/topic-playbook.md` | 配置字段映射、选题方向分级、高/低风险写法清单 |
| `references/hn-contact.md` | 联系 HN 管理员的正确渠道 + 申诉邮件写法 |
| `scripts/setup_profile.sh` | 个人档案配置脚本（交互式 / --show / --path） |

## 环境依赖

flag 检测与页面读取依赖 **ego-browser** skill（或任何能带登录态访问网页、并能发起匿名 HTTP 请求的浏览器工具）。

若浏览器工具不可用，只能做选题（纯文本分析），无法执行可见性检测——此时应告知用户 flag 自检环节无法完成。

## 隐私说明

本 skill 不在仓库内存储任何账号、雇主、身份信息。所有个人数据存于用户 HOME 的 `~/.config/hn-nurture/profile.env`，可安全地把 skill 目录提交到公开仓库或分享给他人。
