# 多平台：身份、存储、发布

先区分三件事：谁登录当前 Agent 宿主、谁登录生成的网站、哪个账号有权发布。宿主已登录不能自动成为网站会话；发布权限也不赋予读取其他用户文件的权限。

## 按实际宿主选择

| 环境 | 应用多用户身份 | 文件与数据 | 发布 |
| --- | --- | --- | --- |
| Codex / 本地 / 自有 Node 服务 | 通用模块 local/OIDC；OpenAI 网站 SIWC 需已获配客户端 | SQLite 持久磁盘 + 用户自选 OSS/CloudBase/WebDAV | 本地构建或用户指定主机；具体部署走现有平台 Skill/工具 |
| OpenAI ChatGPT Sites | 原生 ChatGPT 用户身份与访问政策，服务端按当前 Sites 契约读取；不额外套独立 OAuth | Sites D1/R2；连接网盘是另一条 App 集成 | 优先读环境中 sites Skill，调用真实 Sites 原生工具 |
| WorkBuddy | 原生应用云认证，官方支持邮箱、手机验证码、微信；不是已确认对外开放的“用 WorkBuddy 账号登录任意网站”协议 | 原生应用云存储/数据库；用户自有 CloudBase 可独立配置 | 当前宿主网站应用/轻量发布工具或可见 UI；无接口时交付产物和准确的接续步骤，不虚构跨宿主发布 API |
| Kimi | Portal OAuth | 已供给的 Kimi 数据库/对象存储 | 原生版本工具/版本卡，发布遵守该平台真实能力与授权 |

仅有配置名称不代表服务可用。检查当前工具、SDK、账号、资源与资格，分别报告“本地代码验证”“接口联调”“已保存版本”“已部署”。`scripts/webapp.py platforms` 显示路由摘要，不执行发布或申请资源。

## OpenAI 登录

[官方 SIWC 网站接入](https://developers.openai.com/siwc/website) 明确要求获配 client ID、登记回调与 OIDC 验证；商业网站仍为有限试用。通用模块已实现 identity-only OIDC 接线，默认 issuer 为官方发布值，不能复用 Codex 内部 OAuth client、浏览器 Cookie 或宿主 Token。没有 client 时说明缺少资格/配置，继续本地或已选身份方案，不声称 ChatGPT 网站登录已实测。

在 ChatGPT Sites 内使用其原生认证：按 sites Skill 的 identity-and-secrets 规则保持平台的登录入口和服务器信任边界。`oai-authenticated-user-id` 只在真实 Sites 管理边界内可信；外部 Node 服务不得仅凭同名请求头认用户。

## OpenAI 发布与存储

环境提供 sites Skill/工具时，以其当前工作流为准，保留既有模板与访问范围：

1. 确认目标 Site、owner、保存或发布范围；新建只用真实返回的 project_id。
2. 静态页面保留原技术栈，构建至支持的输出目录；HTML 可复制为 dist。`.openai/hosting.json` 设置真实 project_id 和 static.directory。
3. 服务端项目需 Worker ESM `dist/server/index.js` 的 fetch handler；原 Node SQLite/Hono Node 服务必须迁到平台 Worker、D1/R2 和原生认证，不能直接上传后宣称兼容。
4. 按 sites Skill 完成源代码同步、打包与真实保存/部署，保留字面回执、版本和 URL。未知结果先查状态，不能重复创建 Site。

“ChatGPT 的存储”分两类：网站运行时文件使用 Sites R2，用户记录使用 D1；对话附件或 Space/连接网盘文件通过当前文件工具按其权限保存，用于归档/交付。后者不能默认作为可公开访问的永久文件 URL，也不能取代应用后端存储。

## WorkBuddy 发布与身份

先检查当前宿主是否真有 WorkBuddy 的项目/云服务/发布能力。其官方文档确认应用云认证与分享发布，但没有据此确认一个可在任意 Codex 进程调用的公共发布或 WorkBuddy 身份提供者 API。

- 在 WorkBuddy 内：按当前工具或页面实际控件开启云服务，选择邮箱/短信/微信登录并接入，明确是否会公开访问、费用和数据范围；用当前项目发布/更新能力拿真实链接。
- 在 Codex 内且没有 WorkBuddy 接口：保留构建产物、版本和环境变量名称，准备交给 WorkBuddy 的同版代码；用户明确要求操作客户端时用可用的 UI 工具。不能用聊天中一句“已发布”当回执，也不应编造 `workbuddy deploy`。
- 用户仅要求通用多用户时直接采用通用模块，不强迫使用宿主账号作为应用身份。

## 存储与网盘配置

通用模块支持实际 OSS、CloudBase、WebDAV 调用；只配选中服务的环境变量。CloudBase 的应用用户安全规则与服务端管理凭证是不同边界：服务端 SDK 仍要自己检查归属。

网盘用于附件归档时优先用已连接的服务工具；需要作为网站私有文件服务时，只有具备 WebDAV/官方 API 和必要授权才接入。普通分享链接可能过期或公开，不能充当私有对象 key。不要为了“支持网盘”采集浏览器 Cookie 或绕过登录。

## 浏览器与 Musepool

浏览器有 ego-browser Skill 就先读它，再执行 ego-browser skill 并优先使用；不把其 API 当 Playwright。缺少或确认不可用时，才按当前宿主能力回退并说明验证范围。

Musepool 仅在已确认且已配置的 Kimi 环境调用；Codex/WorkBuddy 等提示一次限制后继续用已有素材或其他参考。

## 2.0 待实现

AI 对话、内容生成、模型路由、用量计费和配额控制均未实现。模板的模拟 AI 展示与宿主本身的模型能力不代表生成应用已内置 AI。当前配置明确标记 `ai.status=not-implemented`、planned_version=2.0。

## 本次依据

- [OpenAI SIWC](https://developers.openai.com/siwc/website)：身份接入与资格，核对于 2026-11-09。
- OpenAI Sites：以当前安装的 sites Skill 的 hosting、identity-and-secrets、storage 契约与可用原生工具为准；不是依赖固定本机安装路径。
- [WorkBuddy 网站应用](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/App-Publishing/Web-App)、[云服务](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/App-Publishing/Cloud-Services)：宿主内认证、存储与发布，核对于 2026-11-09。
- [OSS 官方 Node SDK](https://www.alibabacloud.com/help/en/oss/developer-reference/oss-sdk-for-node-js/)、[CloudBase SDK 文件管理](https://docs.cloudbase.net/storage/sdk)：自定义存储；真实资源与权限仍需用户环境联调。
