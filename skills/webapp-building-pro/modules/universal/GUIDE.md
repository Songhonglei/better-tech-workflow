# 通用账号与文件服务

适用于 HTML、独立 Three.js、React/TS、JSX 及内置计时器。通过附加 Node.js 服务提供账号与文件 API，保留原前端源码、Vite 配置和构建。不依赖 Kimi；平台原生认证/存储使用 [多平台路线](../../references/platforms.md)。

## 初始化与接入

`<SKILL_DIR>` 指 webapp-building-pro 根目录。新项目一步生成：

```bash
bash "<SKILL_DIR>/scripts/init-webapp.sh" "我的应用" --html --backend --output "./my-app"
bash "<SKILL_DIR>/scripts/init-webapp.sh" "计时器" --template minimal-timer-cn --backend --output "./timer"
```

已有项目先检查 Git 状态与备份，再附加服务：

```bash
python3 "<SKILL_DIR>/scripts/webapp.py" adapt --project "/absolute/project" --auth local --storage oss
```

`--auth` 为 local / oidc / openai，`--storage` 为 local / oss / cloudbase / webdav；省略均为 local。`--no-install` 只生成文件。脚本拒绝覆盖已有 server、webapp-client、api、后端标记或集成配置；已有后端按其接口集成，不能运行两套会话互相覆盖。

生成后在项目执行：

```bash
npm run webapp:build
npm run webapp:start
```

新生成项目还提供 `npm run webapp:storage-check`，默认只核对必需字段和 WebDAV URL，不发请求、不写云端，也不证明凭证有效。经授权可用 `-- --probe --report /absolute/new-report.json` 写一个独占小文件并验证清理，详见 [存储检查](../../references/storage-check.md)。旧项目不会随 Skill 升级自动改动，需按其现有后端增量接入。

本地默认 `http://localhost:3000`，账号与文件页为 `/account/`。这些 scripts 不覆盖原 dev/build/start。HTML 构建将静态资源复制至 dist，排除源码服务、配置、凭证、依赖和运行数据；Vite/Three.js/JSX 沿用原 build。所有 API 与文件必须由真实 Node 服务验证，不能用纯静态服务器验证登录。

## 配置与部署边界

依赖 Node.js 22.13+（node:sqlite）、npm。生成项目的依赖清单包括 Hono、其 Node 服务适配器、dotenv、jose；OSS/CloudBase SDK 仅按选择安装；CloudBase 使用 4.2.1 兼容版本，并仅对该 SDK 的 Axios 应用 0.34.0 安全覆盖，保留其他库的版本约定。已有冲突覆盖规则时在写入前停止。数据默认在项目 `.webapp-data/`，可用 WEBAPP_DATA_DIR 指到持久磁盘；它与 `.env` 都被 Git 忽略。配置示例从不自动写入真实凭证。

- 本地测试可设置 `ALLOW_REGISTRATION=true` 开放注册，默认关闭。密码 12–128 位，账号是本地用户名，不伪装成已验证邮箱；当前无邮件验证、找回密码、MFA，企业需求优先使用 OIDC 或平台托管认证。
- 默认 HOST=127.0.0.1；部署需按环境设置 HOST/PORT，APP_ORIGIN 为实际 HTTPS 站点。反向代理终止 TLS 时仍使用公共 HTTPS APP_ORIGIN。Cookie 为 HttpOnly/SameSite，HTTPS 下带 Secure；修改请求必须来自相同 Origin，服务端不信任任意 Host 或伪造的身份头。
- SQLite 是单实例、持久磁盘方案，不直接用于多副本、无盘函数或 Cloudflare Worker。此类宿主使用平台数据库/会话设施，见多平台路线；不要把本地 SQLite 服务直接声明为 Sites Worker。
- 普通用户与管理员角色保存在服务端，没有“第一个注册者自动成为管理员”。本地用户已注册后，只有掌握服务器权限的维护者按授权运行 `npm run webapp:user -- role <username> admin`；OIDC/OpenAI 用户可先运行 `npm run webapp:user -- list` 在服务器查看基础账号，再按 `role id:<user-id> admin` 设置。管理员列表接口只列基础账号，不返回密码或会话。
- OIDC 用 state、PKCE S256、nonce、一次性服务端事务和 ID token 签名/iss/aud/exp 校验。外部身份按 provider+issuer+client+sub 归属；不因邮箱相同自动合并账号。不使用宿主 Codex/ChatGPT/WorkBuddy 登录令牌替用户网站登录。

## 认证选择

| 选择 | 实现 | 需要配置 |
| --- | --- | --- |
| local | 独立多用户、本地用户名密码、scrypt 哈希、持久会话、退出与权限隔离 | APP_ORIGIN，注册开关 |
| oidc | 标准 OIDC，身份映射到应用用户并发本应用会话 | OIDC_ISSUER、CLIENT_ID、可选 CLIENT_SECRET、TOKEN_AUTH_METHOD |
| openai | 正式 Sign in with ChatGPT 的 identity-only OIDC；仅申请 openid/profile/email，不使用订阅推理 | 已获配 OPENAI_CLIENT_ID、精确登记的 `/api/auth/callback`、注册的令牌认证方式；商业网站接入仍受 OpenAI 资格限制 |
| WorkBuddy / Kimi / OpenAI Sites 托管身份 | 使用各宿主原生集成，不用未经验证的第三方 OAuth 地址 | 见多平台路线与当前真实工具契约 |

更换认证方式不会删除原用户；不同方式产生独立身份，账号关联必须另外验证双方归属。账号归属、用户角色、应用管理员与发布账号不是同一个权限。

## 文件存储选择

| 选择 | 实现 | 服务端环境变量 |
| --- | --- | --- |
| local | 私有文件目录与认证后下载 | WEBAPP_DATA_DIR，可选 |
| oss | 阿里云 OSS 官方 Node SDK | OSS_REGION、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET，可选 OSS_STS_TOKEN |
| cloudbase | 腾讯云官方 Node SDK，存储 fileID | CLOUDBASE_ENV_ID、CLOUDBASE_SECRET_ID、CLOUDBASE_SECRET_KEY，可选 CLOUDBASE_SESSION_TOKEN |
| webdav | HTTPS WebDAV：建目录、上传、下载、删除 | WEBDAV_URL、WEBDAV_USERNAME、WEBDAV_PASSWORD；基础目录须已存在 |

OSS 私有附件要求 Bucket ACL 为 private，且桶策略没有面向匿名用户的 Allow。适配器启动时读取桶 ACL/策略，不满足或无权核实时在上传前停止；每个新对象还会显式设为 private。公网站点 Bucket 使用单独的发布流程，不能直接用作本模块的私有附件桶。RAM 身份需具备该桶的 GetBucketAcl/GetBucketPolicy，以及指定对象范围的 PutObject/PutObjectAcl/GetObject/DeleteObject；不要求跨桶管理权限。

凭证只放环境或服务端 Secret 管理器。凭证轮换与临时 STS 刷新由部署环境负责，长期运行不能假设初次 STS 永不失效。按最小 bucket/env/目录授权，不把云端管理密钥发往浏览器。网盘只有提供可用 WebDAV 才使用此适配；其他网盘需当前连接器或专用官方接口。

上传默认最多 5 MB，经同源后端、用户会话及归属检查；存储键为不可猜的 userId/fileId，下载以附件返回，避免上传 HTML 在本站执行。数据库保存 provider 与对象 key/fileID，不保存短期签名 URL。切换存储不自动搬迁旧文件，先迁移并核对，再切换；恢复原 provider 可继续访问原文件。删除先确认云端成功再删除数据库引用；写入结果未知时先核对，不能盲目重试。

ChatGPT Sites 的 R2、ChatGPT 连接网盘的归档文件、Kimi 平台存储分别见多平台路线；不能把这些概念当作同一个通用对象存储接口。

## 前端接线与验收

可直接使用 `/account/`，或按现有页面设计嵌入同源接口：

- GET `/api/session`：当前用户和认证方式。
- POST `/api/auth/register|login|logout`：本地认证；OIDC/OpenAI 从顶层链接 GET `/api/auth/start` 开始。
- GET/POST `/api/files`：本人清单、multipart 上传字段 file。
- GET/DELETE `/api/files/:id`：本人下载和删除。

模板原有计时记录、演示行情和表单**不会自动成为云端业务数据**。需要持久化时增建对应表/API，查询和写入都以服务端 user.id 限定；不接受浏览器自报 ownerId。先验证两个不同用户不能读取、删除对方记录，再验刷新、退出、重启后数据可恢复。

优先使用环境中的 ego-browser Skill 测试真实页面、注册/登录/退出、上传/下载/删除、失败提示及手机视口。没有 ego 或确认不可用再使用当前宿主的浏览器工具。

`templates/server/` 为可执行服务与存储/认证代码；`templates/webapp-client/` 为可用账号文件页。服务并未提供邮件找回、MFA、跨组织管理或多实例共享会话；有这些要求时按实际身份平台与数据库契约实施，不宣称已内置。

CloudBase 的实际 Node 适配器已在一个独立环境完成真实上传、下载内容校验、签名下载与删除，清理由独立只读检查确认；这不代表其他环境或普通用户云端权限规则已验收。接入、凭证到期与删除核验见 [CloudBase 用法](../../references/cloudbase.md)。
