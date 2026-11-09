# 从文件到预览和送审

本页使用 `<ENV_ARGS> --source thirdAgent` 展示流程。执行前必须把 `ENV_ARGS` 按触发口令处理：Beta 替换为 `--env beta`，默认口令删除该占位符，并在整条流程中保持环境、来源与账号一致。所有路径用双引号包裹，命令写成单行，兼容常见终端。尖括号内容需要用实际值或真实回执替换，不要原样执行。

## 上传引导

按阶段由 Agent 执行，用户不需要逐条输入下面的命令。

1. **确认目标并接着做。** 从上下文区分仅上传文件、生成预览、新建送审、已有小工具更新。“上传小工具”本身不等于送审；先检查和准备已授权的上传，只有目标仍不清楚时集中询问一次。用户已说“上传并送审”时不再问是否送审，但仍必须在提交前取得本次内容的扫码预览通过反馈。
2. **先找现有资料。** 检查用户给出的文件、当前项目说明、构建产物和本项目的操作记录；从中提取名称、简介、版本和图片。多个项目或同名小工具无法唯一匹配时让用户选定，不猜 appId。只读查询无需单独逐项确认。
3. **一次收集当前目标的缺项。** 先按 [填写限制](form-limits.md) 把对应要求带进问题中，名称/简介显示 n/14，图片给出格式、大小和比例；对现有资料自动检查，只请用户修正缺失或不合格项。 环境/来源先用用户已有选择。仅上传只需文件；仅预览只需代码包，不索要类目、图标、封面。送审才需要名称、简介、图标、封面、版本、类目和权限。能从项目确定的值直接写入草稿，必要时给出建议供一次核对；不要求用户填写 fileId、MD5、类目 code 或 planHash，这些由 Agent 获取。
4. **自动补足机械步骤。** 有明确构建说明时检查脚本并构建静态产物、正确打 ZIP、检查大小和结构；只有源码时不直接压整个仓库。名称/简介基于项目自动起草，按 config 返回的选项选择唯一明确的类目；不确定的类目集中询问。权限根据真实功能填写，不因省事全选。缺图时先找现有素材；无素材则直接根据小工具现有配色、图形和页面设计生成图标与封面并校验，不要求用户先提供素材或再次授权生成，不默默使用测试图送审。
5. **完成预检后按授权范围串联执行。** 登录 → config/source 检查 → 文件检查和 dry-run → 自动起草资料并生成缺失素材 → 上传所需素材 → 生成并展示预览二维码 → 用户确认资料与本次预览通过 → 送审。用户已提供验证过的 ZIP、合格素材和明确资料时，直接复用，不重新开发或重复审计包体。dry-run/confirm 两阶段由 Agent 内部完成，已获授权无需每张图片再询问；同一授权阶段尽量在一个 shell 中顺序执行、逐项读取 planHash/RESULT_JSON 并汇总回执，任一步失败即停，减少无信息量的工具往返。所有 submit 都必须经过扫码预览，包括用户直接要求送审的情况；仅上传文件仍按原目标交付。
6. **在真正需要用户时集中交接。** 登录扫码与小工具预览扫码是两个不同步骤，不可互相替代。先展示预览二维码和必要链接，再使用当前宿主可用提问工具（没有时用普通对话等待明确回复），只问“本次预览是否通过，并确认提交审核？”，提供“确认提交审核”和“暂不提交，需要修改”两个选项；不调用当前宿主没有的工具。图片只在上传前做本地格式、尺寸和内容校验，无需在 AskUser 中展示。AskUser 调用成功不等于用户已确认；只有用户选择“确认提交审核”，或明确回复“预览通过”“可以”“没问题”“继续送审”等自然语义，才可继续。不要求复诵指定句式。“已扫码”“No preference”、沉默、超时或模糊反馈不算通过，有问题则先修复并重新预览。资料与送审确认尽量合并，未变化时不重复询问。
7. **按实际完成度交付。** 上传完成给文件回执；预览完成给手机链接/二维码；送审完成给 appId、版本和审核状态。说明阻塞的阶段及可继续的入口，不说“已经发布”。最终预览交接只用一句话说明上传和真机预览已完成，随后展示二维码、必要链接和一次 AskUser 提交确认；未确认前不送审。不要复述 CLI 门禁、命令协议、dry-run/confirm 等过程清单，也不要展示 openId、planHash、fileId、MD5 或操作记录路径。每个成功或未知结果及时保存操作记录。

例如用户已指定 beta、thirdAgent、当前项目并要求送审，且资料齐全：说明“我会检查素材和配置，上传后生成预览二维码，等你扫码确认通过再送审”，自动执行到预览交接；用户明确确认本次预览通过后继续送审，不再重复问同一送审授权。若只说“上传这个 ZIP”，上传成功即交付回执，不顺带创建预览或送审。

## 1. 上传前预检

首次使用先完成 [命令协议检查](operations.md#验证命令协议)，并读取/建立 [操作记录](session.md)。完整小工具流程在远端上传前执行：

```bash
redapp config --source thirdAgent <ENV_ARGS> --agent
```

该请求会复用登录或触发扫码；成功后确认当前账号，从本次 config 保存类目和权限选项。source、网关或鉴权失败时先处理错误，不继续上传素材。config 成功只证明该接口可访问，不证明 preview/submit 一定可用。

更新已有小工具时先用用户提供或 list 唯一匹配的 appId 查询 status/history，确认目标和未使用的版本号；结果不明确时暂停对该对象写入。新建不必为预检强制查询他人列表。明确只上传文件时 upload 没有 source，跳过 config，改为检查同环境登录、文件与计划。

## 2. 准备静态代码包和图片

准备根目录直接包含 `index.html` 的 ZIP；不要再套一层目录。CLI 不提供构建命令。需要构建或压缩时依据项目自身说明操作，不把含源码、凭证和 node_modules 的整个仓库直接压入 ZIP。

- 单文件非空、不超过 10 MiB。
- ZIP 解压总大小不超过 30 MiB；拒绝损坏包、路径越界、重复路径和符号链接。
- 发布用图标使用 JPG/JPEG/PNG、≤5 MiB、1:1；封面使用 JPG/JPEG/PNG、≤10 MiB、3:4。按 [字段限制](form-limits.md) 检查实际尺寸和格式；CLI 不会自动裁剪。
- 送审需要 ZIP、图标、封面；仅预览时 ZIP 必填。

## 3. 上传所需素材

先确保同环境登录再 dry-run，便于将计划绑定到当前账号；前面的 config 已完成登录时不重复调用 login。只上传当前目标所需素材，已成功且可复用的素材按操作记录恢复：

```bash
redapp login <ENV_ARGS> --agent
redapp upload --file "./app.zip" --type pkg <ENV_ARGS> --dry-run --agent
redapp upload --file "./app.zip" --type pkg <ENV_ARGS> --confirm "<ZIP_PLAN_HASH>" --agent
redapp upload --file "./icon.png" --type image <ENV_ARGS> --dry-run --agent
redapp upload --file "./icon.png" --type image <ENV_ARGS> --confirm "<ICON_PLAN_HASH>" --agent
redapp upload --file "./cover.png" --type image <ENV_ARGS> --dry-run --agent
redapp upload --file "./cover.png" --type image <ENV_ARGS> --confirm "<COVER_PLAN_HASH>" --agent
```

每个确认值取自它前一步输出的 `plan.planHash`。每次上传成功后记录 `RESULT_JSON.data.fileId`；ZIP 还要记录 `data.md5`。fileId 不是完整 CDN URL；不要把本地文件路径或 sha256 填入 fileId/md5 字段。

## 4. 送审前强制手机预览

所有新建和新版本送审必须完成本节。先准备本次 submit 草稿（字段见下一节），用其中相同的 pkgFileId、md5、appName、version、iconFileId 创建预览；账号、环境、网关和 source 也必须一致。预览只需代码包时仍可独立使用，不要求补齐送审资料。


创建 `preview.json`，用上传回执填入 fileId 和 32 位 MD5：

```json
{
  "pkgFileId": "<ZIP_FILE_ID>",
  "md5": "<ZIP_MD5>",
  "appName": "我的小工具",
  "iconFileId": "<ICON_FILE_ID>",
  "version": "1.0.0"
}
```

只有 `pkgFileId`、`md5` 必填；`appName`、`version`、`iconFileId` 可选。

```bash
redapp preview --source thirdAgent <ENV_ARGS> --file "./preview.json" --dry-run --agent
redapp preview --source thirdAgent <ENV_ARGS> --file "./preview.json" --confirm "<PREVIEW_PLAN_HASH>" --qr-out "./preview-qr.png" --agent
```

送审流程必须生成并交付可扫描的二维码：成功后展示 `data.qrCodePath`，同时提供 `data.previewUrl`。`--qr-out` 不能覆盖已有文件，复测时用新文件名。若返回 `qrError` 且已有 previewUrl，只补做二维码展示，不为本地文件错误重复创建远端预览。接口成功不等于已在手机验证。请用户扫码检查页面加载和主要交互，再使用当前宿主可用提问工具（没有时用普通对话等待明确回复），只问“本次预览是否通过，并确认提交审核？”，提供“确认提交审核”和“暂不提交，需要修改”两个选项；没有提问工具时等待普通对话中的明确反馈。也接受明确针对本次预览的“预览通过”“可以”“没问题”“继续送审”等自然回复，不要求复诵指定句式。收到仅“已扫码”、“No preference”、超时、模糊反馈或无回复时保持等待，不执行 submit confirm。用户反馈问题时先修复，再为修改后的内容重新生成二维码并等待确认。

无法生成二维码时先用已有 previewUrl 在本地补生成，不重复创建远端预览；无法让用户访问二维码文件时说明阻塞，不能仅发链接就跳过扫码要求。收到明确通过反馈后，按 [操作记录](session.md) 记录本次内容和确认依据。确认后代码包、送审输入、账号、环境、网关、来源或目标变化，原确认失效，必须重新预览。

## 5. 准备送审

使用上传前预检得到的 config，选择一个类目 code，权限只填实际需要的 code。跨会话恢复或环境/来源变更时先重新查询配置。由 Agent 保存为 `submit.json`：

```json
{
  "appName": "我的小工具",
  "slogan": "一句话说明用途",
  "iconFileId": "<ICON_FILE_ID>",
  "coverFileId": "<COVER_FILE_ID>",
  "version": "1.0.0",
  "pkgFileId": "<ZIP_FILE_ID>",
  "md5": "<ZIP_MD5>",
  "categories": ["<CATEGORY_CODE>"],
  "authorizations": []
}
```

字段约束（先按 [填写限制](form-limits.md) 完成前置检查）：

- `appName` 和 `slogan` 均为非空白字符串，按 JavaScript `.length` 计数各不超过 14；CLI dry-run 不会拦截超长文案。

- 新建时省略 `appId`；送审已有小工具的新版本时加上真实 `appId`，使用未使用过的三段版本号，例如 `1.0.1`。
- `categories` 必须且只能有一个 code；`authorizations` 可为空数组。
- `version` 必须是三段整数，不带 beta 后缀，例如 `1.0.0`。npm 包的版本号与小工具版本号互不相关。
- `source` 用命令行传递，不放入 JSON。CLI 拒绝未声明字段，包括 `userId`。

```bash
redapp submit --source thirdAgent <ENV_ARGS> --file "./submit.json" --dry-run --agent
redapp submit --source thirdAgent <ENV_ARGS> --file "./submit.json" --confirm "<SUBMIT_PLAN_HASH>" --agent
```

执行上面的 submit confirm 前，核对扫码预览记录已通过且绑定的内容与当前 submit JSON、代码包及上下文一致；未通过时只允许准备 JSON 和 dry-run，不能实际送审。确认阶段 CLI 会重新获取配置校验类目和权限。只有 `RESULT_JSON.status` 为 `submitted` 才能报告送审已接收；保存返回的 appId，再查询状态：

```bash
redapp status --source thirdAgent <ENV_ARGS> --app-id "<APP_ID>" --agent
redapp history --source thirdAgent <ENV_ARGS> --app-id "<APP_ID>" --agent
```

`status` 展示状态：0 未发布、1 审核中、2 已发布、3 未通过、4 已下架。
历史 `auditStatus`：-1 历史版本、0 未知、1 审核中、2 审核通过、3 审核驳回、4 创作者撤回。不要把历史版本或审核通过直接翻译成已发布。

## 6. 修改基础信息

**后端不支持只传单个待修改参数：每次 edit 都必须同时传入 `appName`、`slogan`、`iconFileId` 三项，并提供目标 `appId`。** 只改其中一项时，另外两项必须使用现有值原样传回。优先从已有资料或查询结果补齐，不能把图片 URL 当作 `iconFileId`；缺少可信的现有值时先补齐资料，不省略、不传空值、不猜测。即使只改封面，也要携带这三项。

`appName`、`slogan`、`iconFileId` 任意一项缺失、为 `null`、空串 `""` 或纯空白（如 `"   "`），后端都会拒绝整个请求。三项都必须是非空白字符串；未修改项复用的现有值也必须满足此要求。

`coverFileId` 是可选字段，可以省略；需要修改封面时传入新的封面 fileId。下面仅修改简介的示例不传 `coverFileId`。

检查本次传入的名称/简介非空且各最多 14 个字符；换图按 [图标/封面规则](form-limits.md) 检查。未修改字段可复用可信的现有值，无需用户重新起草文案或上传图片。

例如，现有名称为「眼力侦探社」、简介为「找不同小游戏」，本次只把简介改为「寻找画面中的不同」，名称和图标保持原值。`edit.json` 仍需包含完整的三项展示字段：

```json
{
  "appId": "REPLACE_WITH_EXISTING_APP_ID",
  "appName": "眼力侦探社",
  "slogan": "寻找画面中的不同",
  "iconFileId": "REPLACE_WITH_EXISTING_ICON_FILE_ID"
}
```

执行前，将 `REPLACE_WITH_EXISTING_APP_ID` 和 `REPLACE_WITH_EXISTING_ICON_FILE_ID` 分别替换为目标小工具的真实 appId 和现有图标的真实 fileId；它们是占位说明，不能原样发送或替换为空串。`appName` 使用目标小工具的现有名称，`slogan` 使用本次要修改的新简介。

先执行 dry-run：

```bash
redapp edit --source thirdAgent <ENV_ARGS> --file "./edit.json" --dry-run --agent
```

核对计划后，将 `REPLACE_WITH_DRY_RUN_PLAN_HASH` 替换为本次 dry-run 返回的真实 `planHash`，使用同一份 `edit.json` 执行：

```bash
redapp edit --source thirdAgent <ENV_ARGS> --file "./edit.json" --confirm "REPLACE_WITH_DRY_RUN_PLAN_HASH" --agent
```

当前 CLI 尚未强制检查三项是否齐全，dry-run 成功不能代替 Skill 对三项齐全且非空白的检查。改完用 status 核对。更换代码包必须走 submit 新版本。
