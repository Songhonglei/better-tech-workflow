# 小红书小工具 CLI

`<SKILL_DIR>` 在本指南指本模块 cli/ 目录。确认交互使用当前宿主可用提问工具；没有工具时用普通对话等待，超时或沉默不算确认。

把用户请求转换成当前 `redapp` 命令，给出可执行步骤并依据真实回执报告结果。用户只问用法时给命令；要求执行时，在已授权范围内完成操作。

## 动态版本门禁

`redapp` 由 npm 包 `redskillhub-upload` 提供。通过创服下发的可信口令使用本 Skill 时，执行任何 `redapp` 命令前，必须先从本 Skill 目录运行版本门禁：

```bash
# Beta 测试口令
node "<SKILL_DIR>/scripts/ensure-cli.mjs" --env beta --npm-policy beta-first

# 默认口令
node "<SKILL_DIR>/scripts/ensure-cli.mjs"
```

读取 `CLI_VERSION_JSON`；只有 `status=current|installed|updated` 才继续，并以其中的 `version`、`tag`、`env` 作为本次实际运行依据。状态为 `error`、字段缺失或无法解析时立即停止，不使用本地源码或其他版本线兜底。

`--env` 选择小工具后端和凭证目录，`--npm-policy`/`--npm-tag` 选择 npm 包版本，两者互不替代。Beta 的 `beta-first` 仅在 `beta` 对应的目标正式版本高于默认正式版本时使用预发布包，正式版追平后自动回到正式版本；默认口令不传这些参数，由门禁使用正式版本和默认线上后端。后续每条 `redapp` 命令都必须携带 `--agent`；Beta 还必须显式携带 `--env beta`，默认口令不附加环境参数。

外层口令应使用当前进程专用的用户可写 npm prefix/cache，不永久修改 npm 配置。版本门禁只验证安装版本和 `redapp` 命令协议，不提前要求业务登录；需要访问接口时再按登录流程处理。

## Agent constraints

以下约束只在 Agent 实际执行 CLI 时适用。

### CLI 入口与临时 npm 环境

使用当前进程专用的 npm prefix/cache，并让版本门禁与后续命令使用同一个 `redapp`：

```bash
export NPM_CONFIG_PREFIX="$(mktemp -d "${TMPDIR:-/tmp}/redapp-prefix.XXXXXX")"
export NPM_CONFIG_CACHE="$(mktemp -d "${TMPDIR:-/tmp}/redapp-cache.XXXXXX")"
mkdir -p "$NPM_CONFIG_PREFIX" "$NPM_CONFIG_CACHE"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
node "<SKILL_DIR>/scripts/ensure-cli.mjs"
command -v redapp
```

Beta 按动态版本门禁的要求增加 `--env beta --npm-policy beta-first`。不得永久修改 npm 配置，也不得让后续命令绕过门禁选出的入口。`whoami` 只证明本地登录状态，业务结果仍以真实接口回执为准。

### 登录与二维码交付

从同一条 `PROMPT:<json>` 读取 `userCode`、`expiresInSeconds`、`qrCodePath` 和 `authorizeH5Url`。首次交付依次展示授权码、有效期、原生二维码和备用授权入口；字段缺失时如实说明，不拼接或伪造。保持原登录进程等待，并以该进程的 `RESULT_JSON.status=ok` 判断登录成功。

二维码必须使用 CLI 本次生成的原生 PNG。复制到当前宿主可展示的任务输出目录，预览 `--qr-out` 使用尚不存在的目标；Codex 使用绝对路径 Markdown 图片展示。只有 Kimi 支持时才用其 sandbox REF 语法。不能内嵌时给实际可打开的二维码文件及备用链接，不重绘、不复用旧图。

### 凭证目录与隔离

Kimi 镜像配置的 AuthMount 仅在该镜像适用；其他宿主使用 CLI 默认凭证目录。prod 与 beta 使用各自的环境目录。不得复制宿主机或其他用户的凭证，也不得把凭证、Token、Cookie 或授权链接写入操作记录。

CLI 会以 `0600` 原子写入凭证；AuthMount 的 FUSE 层可能显示为 `0755/0644`，不能用 `chmod` 或 `stat` 判断隔离与持久化是否成功。没有 AuthMount 时使用官方默认目录，不把临时路径检查当作持久化验收。

## 先确定入口、环境和来源

- 包名是 `redskillhub-upload`，同一个 npm 包提供 `redapp` 和 `redskillhub-upload` 两个命令。
- 只有用户明确要求开发或验证当前仓库源码时，才使用 `node "<REPO>/cli/redapp/index.mjs"`，下文 `redapp` 可以整体替换为此入口。创服口令或 npm Beta/正式包验收必须使用版本门禁选出的全局命令，不得回退本地源码并把结果归因于已发布包。
- 首次使用、切换入口或升级后，按 [安装与排错](references/operations.md#验证命令协议) 验证实际入口、版本、命令和计划协议；仅存在 `redapp` 命令不足以证明兼容。不要假定 npm 已发布当前源码。
- 先根据触发口令设置环境参数占位符：Beta 为 `ENV_ARGS="--env beta"`，默认口令为 `ENV_ARGS=""`。所有业务步骤保持同一组参数，并与版本门禁的 `CLI_VERSION_JSON.env` 一致；不要把占位符原样交给 shell。
- 查询、预览、送审和编辑需要 `--source`；它是后端登记的三方来源，不是客户端类型。来源包的联调示例为 `thirdAgent`，当前任务已有成功回执时复用已确认的 source；新接入或切换环境时核对真实 source；不要沿用错误的 `web` 或把文档示例 `cowork` 当成通用配置。其他接入方使用其实际分配值。
- 当前仓库 beta 默认网关为 `https://edith-qinweiheng.sl.beta.xiaohongshu.com`，prod 为 `https://edith.xiaohongshu.com`。版本或部署可能改变默认值，诊断时核对 CLI 配置与 dry-run 的 `plan.apiBase`。`--api-base` 优先于 `SKILLHUB_UPLOAD_API_BASE`，后者优先于默认值；只使用用户或后端确认的地址。
- `upload` 不接受 `--source`；其上传授权内部使用的 `source=web` 与小工具三方来源不是同一个参数，不要改写它来规避校验。

## 本地开发调试

用户要求启动模拟器或本地调试时，按 [dev 使用流程](references/dev.md) 执行 `redapp dev --dir "./dist" <ENV_ARGS> --agent`。需要 Node.js 20+；首次自动安装公开包 `@skillbuilder/miniapp-simulator@0.2.0`。dev 不使用发布登录、不接受 --source 或 --api-base，不能将业务泳道参数追加到它；无需填写发布表单。保留进程并交付实际 URL，结束时关闭服务。dev 不能替代送审前手机扫码预览。

## 登录与输出

Agent 发起的每次 CLI 调用都显式添加 `--agent`，包括查询、上传、dry-run 和 confirm。业务命令也可能触发自动登录；遗漏此参数会影响二维码和结构化提示的展示。npm、node 自身的安装或版本查询不加此参数。

直接复用 Skill CLI 的登录、token 续期和环境隔离。已有同环境登录无需再扫码，真实请求会自动检查凭证。需要明确登录时：

```bash
redapp login <ENV_ARGS> --agent
redapp whoami <ENV_ARGS> --agent
```

`ENV_ARGS` 不是可直接执行的字面量：Beta 口令替换为 `--env beta`，默认口令删除该占位符，并在本次流程中保持一致。

登录出现 `PROMPT:<json>` 时，按 [跨 Agent 展示登录和预览](references/operations.md#跨-agent-展示登录和预览) 展示二维码或链接。保持当前 CLI 进程等待授权，不另起重复登录；只使用返回字段。

读取 `RESULT_JSON:<json>` 作为最终回执；`UPLOAD_PROGRESS:<number>` 只是上传进度。不要把退出码 0、HTTP 200 或上传 100% 单独当成业务成功。日常用法不需要用户复制 token。

## 按任务选命令

以下命令使用环境参数占位符；执行前按触发口令替换或删除 `ENV_ARGS`。表中 `thirdAgent` 只是来源示例，执行前替换为本次已确认的接入值。

| 用户意图 | 命令 | 结果要点 |
| --- | --- | --- |
| 查询可选类目、权限 | `redapp config --source thirdAgent <ENV_ARGS> --agent` | 使用返回的 `categories[].code`、`authorizations[].code` |
| 查询最近列表 | `redapp list --source thirdAgent <ENV_ARGS> --page-num 1 --page-size 20 --agent` | `data.apps`、`data.total`；含未发布和审核中记录，不是仅已发布列表 |
| 查看状态、驳回原因 | `redapp status --source thirdAgent <ENV_ARGS> --app-id "<APP_ID>" --agent` | 使用 list 或提交回执里的真实 appId |
| 查看历史版本 | `redapp history --source thirdAgent <ENV_ARGS> --app-id "<APP_ID>" --agent` | 历史审核状态与展示状态分别解释 |
| 上传 ZIP、图标或封面 | `redapp upload --file "<FILE>" --type pkg <ENV_ARGS> --agent --dry-run` | 先 dry-run，再确认；保留 fileId 和 md5 |
| 手机预览 | `redapp preview --source thirdAgent <ENV_ARGS> --agent --file "./preview.json" --dry-run` | 使用上传回执制作 JSON，可输出二维码 |
| 新建或送审新版本 | `redapp submit --source thirdAgent <ENV_ARGS> --agent --file "./submit.json" --dry-run` | 新建不填 appId；新版本填写 appId 与新 version |
| 修改名称、简介或图片 | `redapp edit --source thirdAgent <ENV_ARGS> --agent --file "./edit.json" --dry-run` | `appName`、`slogan`、`iconFileId` 三项必须同时传入且均为非空白字符串，未修改项携带现有值；改代码包走 submit |

用户要上传、预览、送审或编辑时，读取 [从文件到预览和送审](references/workflows.md)，使用其中的 JSON 字段与两阶段命令。不要使用旧版的 `app list`、`preview create`、`--plan`、`--protocol-ack`；当前入口不支持这些语法。

**edit 必须同时传入 `appName`、`slogan`、`iconFileId` 三项，并提供目标 `appId`。** 三项都必须是非空白字符串，任意一项缺失、为 `null`、空串 `""` 或纯空白（如 `"   "`），后端都会拒绝整个请求。只改其中一项时，其余两项必须携带有效的现有值；优先从已有资料或查询结果补齐，无法确定时先补齐资料，不能省略、传空值或猜测。执行前逐项检查，CLI dry-run 通过不能代替这项检查。

**edit 的 `coverFileId` 为可选字段，可以省略；需要修改封面时传入新的封面 fileId。** 它不属于上述三项必填字段，也不能替代其中任何一项。

## 少交互的上传引导

- 用户说“帮我上传小工具”时，直接承担文件检查、参数组装和命令执行，按 [上传引导](references/workflows.md#上传引导) 推进，不把 CLI 教程或长问卷交回给用户。
- 在当前 Agent 环境中，`redapp` 是默认上传路径。不要把“请自行去创服平台上传 ZIP”作为开发完成后的固定结尾；用户有上传、发布或送审意图时直接进入 CLI 流程，只有用户选择自行操作或 CLI 不可用时才给手动步骤。
- 对上传、发布或送审意图，自动从当前项目起草名称、简介、版本、类目和权限；缺少图标或封面时，直接根据现有页面设计生成并校验，不要求用户先提供素材或再次授权生成。预览二维码和链接交付后，使用当前宿主可用提问工具（没有时用普通对话等待明确回复），只问“本次预览是否通过，并确认提交审核？”，提供“确认提交审核”和“暂不提交，需要修改”两个选项。不要调用当前宿主没有的工具，也不要只宣布资料就直接送审。工具返回 `[No preference]`、超时、沉默或模糊反馈都不算确认。
- 填写前读取 [字段限制与提示](references/form-limits.md)，在收集资料时就说明名称/简介各最多 14 个字符、图标和封面的格式/大小/比例；收到内容立即计数和检查，不能依赖 CLI dry-run 代替这些校验。只提示当前目标涉及的字段。
- 先利用当前对话、项目资料和已有操作记录补全信息；只集中询问无法确定且阻塞当前目标的内容。已知的环境、来源、素材路径和已有授权不重复询问。
- 在任何远端上传之前完成对应任务的预检；完整小工具流程先验证 config/source，已有小工具再查询状态与历史。明确只上传文件时使用文件上传预检，不额外要求业务来源。
- 每个阶段用一句话说明进展，步骤内部自动完成。只在扫码、必要信息缺失或未授权的下一步需要用户参与；不要逐条命令请求确认。
- 多步操作按 [操作记录与恢复](references/session.md) 保存进度；用户说“继续”时先核对记录和远端状态，避免重复上传、预览或送审。

## 送审前必须扫码预览

新建送审和已有小工具的新版本都必须先为本次待提交内容生成预览二维码，让用户扫码体验，并取得用户明确针对本次预览的通过反馈后才能执行 submit 的 confirm。先前的送审授权、二维码生成成功、用户仅说“已扫码”或等待超时都不能替代预览通过。该要求由 Skill 流程执行，CLI/API 本身没有此门禁。

使用 `preview --qr-out` 生成二维码并展示；不能内嵌图片时给出用户可打开的二维码文件及预览链接。交付后使用当前宿主可用提问工具（没有时用普通对话等待明确回复），只问“本次预览是否通过，并确认提交审核？”，提供“确认提交审核”和“暂不提交，需要修改”两个选项；没有提问工具时等待普通对话中的明确反馈。确认按语义判断，不要求固定句式：AskUser 的“确认提交审核”选项，或明确对应当前预览的“预览通过”“可以”“没问题”“继续送审”等自然回复同样有效；“No preference”、超时、沉默或模糊反馈不算通过。无法生成或交付可扫描二维码、预览接口失败或用户尚未确认通过时，停在待预览阶段。具体流程见 [强制手机预览](references/workflows.md#4-送审前强制手机预览)。

## 写入执行约定

1. 确认当前任务已授权的对象、环境和动作；预览不隐含送审授权，测试不隐含修改用户已有作品。
2. 准备真实素材和参数，执行 `--dry-run`。读取 `RESULT_JSON.plan`，核对账号、网关、来源、对象和输入；向用户说明具体效果。
3. 已有清楚授权时（submit 还必须完成本次内容的扫码预览并获用户确认通过）直接用该计划的 `planHash` 执行相同命令并换成 `--confirm "<PLAN_HASH>"`。授权尚不明确时，先把这份具体计划给用户确认，不要重复索取已有授权。
4. 输入、文件内容、账号、环境或网关发生变化，重新 dry-run。计划不是幂等键；不要自动循环重试写入。
5. `OUTCOME_UNKNOWN` 时先查询远端结果。查询也失败或无法判断是否创建成功时停止重试，明确报告未知状态及需要核对的对象。

`submitted` 只表示接收送审，不表示审核通过或发布成功。无删除、下架、下载源码等命令，不要虚构能力或用其他账号、Cookie、伪造 userId 绕过接口限制。

## 报告验证范围

区分本地参数/打包检查、模拟测试与真实接口联调。当前环境的历史阻塞和判断方法见 [安装与排错](references/operations.md#接口错误与复测)，历史结果不能代替本次实测。报告命令、环境、成功数据或原始业务错误，并注明尚未验证的环节。

## 空列表与验证阶段

config/list 真实成功但 total=0 时，只说明当前账号、环境和来源下没有可见小工具；只读验证已通过。不要换 source 猜作品、虚构 appId 调状态或为了继续验证创建作品。上传、真机预览、送审与发布保留未验证状态。新任务沿用本轮已确认且仍适用的账号/来源与授权，先核对已有回执，不重复扫码或问同一个配置。
