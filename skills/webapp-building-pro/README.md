# Webapp Building Pro

创建和改造 React、HTML、Three.js 网站与小红书离线 H5 小工具，支持内置及自定义模板、通用多用户登录、自选存储和多平台交付。当前版本 **1.2.0**。

## 安装与开始

在仓库根目录执行：

```bash
mkdir -p ~/.codex/skills
cp -R skills/webapp-building-pro ~/.codex/skills/
```

其他 Agent 使用各自的 Skill 目录。不需要另装来源包中的四个依赖 Skill；浏览器、云账号和宿主专属工具仍按实际任务准备。Agent 入口为 [SKILL.md](SKILL.md)。

```text
用 $webapp-building-pro 创建一个计时器网站，使用 minimal-timer-cn 模板。
用通用账号登录，文件存到我已有的 CloudBase，不新建云环境。
```

生成 HTML 与通用后端的命令示例：

```bash
python3 ~/.codex/skills/webapp-building-pro/scripts/webapp.py init "我的工具" --html --backend --storage local --output ./my-tool
cd my-tool
npm run webapp:build
npm run webapp:start
```

项目目录必须尚不存在；已有前端使用 adapt，已有后端按原接口集成，不能重复初始化覆盖。注册默认关闭，账号文件页为 `/account/`。代码生成不代表已完成云联调或发布。

## 功能与配置

| 功能 | 支持与入口 |
| --- | --- |
| 模板 | 基础 React 与五个业务模板；可配置外部目录持续扩展，见 [模板配置](references/templates.md) |
| 多用户 | 本地账号、角色、持久会话、文件归属；可接 OIDC/OpenAI identity，见 [通用模块](modules/universal/GUIDE.md) |
| 存储 | local、私有 OSS、CloudBase、HTTPS WebDAV/Koofr；配置与检查见 [存储检查](references/storage-check.md)、[CloudBase 用法](references/cloudbase.md) |
| 宿主路线 | Codex/自有 Node、ChatGPT Sites、WorkBuddy、Kimi 按实际工具接入，见 [多平台路线](references/platforms.md) |
| 小红书小工具 | 离线 H5、产物审计、登录查询、原生二维码、预览及授权后送审，见 [小工具模块](modules/xiaohongshu-minitool/GUIDE.md) |
| 浏览器与参考 | 已安装 ego-browser 时优先使用；Musepool 仅已配置并授权的 Kimi 环境 |
| AI | 2.0 阶段，当前未实现应用内 AI 对话、模型调用和用量管理 |

模板管理需 Python 3.10+，Shell 入口需 Bash；前端按项目锁文件安装。通用后端需 Node.js 22.13+、npm 和 SQLite 持久磁盘，是单实例方案；Worker/无盘多副本需平台数据库与会话方案。云 SDK 只按选项安装，不含真实凭证。临时 STS 当前不自动刷新。

外部模板、账号、Key、应用密码和运行记录保存在 Skill 外或项目服务端 Secret 中，不提交仓库。OpenAI 网站登录需要获配客户端；WorkBuddy/Kimi/Sites 的宿主登录不自动成为任意网站身份，也不代表已获发布接口。

## 验证范围

模板与后端 Python 测试：

```bash
python3 -B -m unittest discover -s skills/webapp-building-pro/tests
```

在隔离生成项目安装依赖后，将本 Skill 的 `tests/universal.integration.mjs` 和 `tests/storage-check.test.mjs` 复制到该项目根目录，运行：

```bash
node --test universal.integration.mjs storage-check.test.mjs
```

1.2.0 已通过 21 项 Python、14 项 Node 检查及检查命令本地实际运行。OSS、Koofr、CloudBase 适配器有真实核心流程证据；新增探针为本地/mock/loopback 验证，未声称同版逐云复跑。小红书仅真实登录、配置及列表通过，未上传、真机或送审。发布和普通用户云端权限隔离分别验收。

新项目含 `npm run webapp:storage-check`，默认只查配置、不联网。经授权显式加 `--probe --report /absolute/new-report.json` 才写一个小测试文件；未知结果先核对，不重试写入。旧项目不会随 Skill 更新自动改动，需增量合并。

## 维护与来源

更新时执行 UGLIC、skill-release-audit，修复非误报项，再同步本目录及仓库索引/版本历史。私密验收证据不随代码提交。原始来源、校验值与改造范围见 [来源说明](references/sources.md)。

[许可范围](LICENSE)：自有整合代码和新增说明使用 MIT；来源包内容与模板不因收录到本仓库而获得额外授权。
