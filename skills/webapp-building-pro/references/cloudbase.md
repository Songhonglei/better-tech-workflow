# CloudBase 文件存储

选择 `--storage cloudbase` 后，应用上传的文件使用腾讯云 CloudBase；登录、用户、角色与文件归属记录仍由通用 Node 后端和 SQLite 管理。当前没有自动接入 CloudBase 数据库、CloudBase 用户认证或 WorkBuddy 原生应用云服务。

## 接入项目

让 Agent 执行时可直接说：「用 webapp-building-pro 创建应用，文件存储使用我已有的 CloudBase 环境；保留通用登录，不新建云环境。凭证通过服务端安全配置提供。」

已有 HTML、Three.js 或 React/JSX/Vite 项目，且尚未接入通用后端时：

```bash
python3 "<SKILL_DIR>/scripts/webapp.py" adapt --project "/absolute/my-app" --auth local --storage cloudbase
```

`<SKILL_DIR>` 替换为本 Skill 的实际安装路径。脚本附加 server、账号文件页、配置与依赖，保留前端源码。已有 server 或通用后端的项目不要再次 adapt；按已有后端接线，保留数据、会话与依赖约定。切换存储不自动迁移原文件。

在生成项目根目录使用 `.env.example`（已有同名示例时为 `server/env.example`）配置根目录 `.env`，或由部署平台注入环境变量：

```dotenv
APP_ORIGIN=http://localhost:3000
CLOUDBASE_ENV_ID=your-existing-environment-id
CLOUDBASE_SECRET_ID=your-server-secret-id
CLOUDBASE_SECRET_KEY=your-server-secret-key
# 使用 STS 时，还需对应的 session token
CLOUDBASE_SESSION_TOKEN=
```

示例全部是占位值，不可直接运行。只在本机私密文件或服务端 Secret 管理器填真实值；不写进 Skill、源码仓库、浏览器变量或聊天。不要使用 VITE_ / NEXT_PUBLIC_ 等会把密钥送到前端的变量名。

在项目目录执行 `npm run webapp:build`、`npm run webapp:start`，访问 `/account/` 验证登录、上传、下载和删除。注册默认关闭；本地测试需要自行开放 `ALLOW_REGISTRATION=true`，或使用已配置的 OIDC 账号。文件默认最多 5 MB。生成服务依赖 Node.js 22.13+ 和持久磁盘，不直接兼容 Worker 或无盘多副本。

## 凭证与宿主

- CloudBase 连接器登录用于授权开发工具，不会自动向 Node 应用注入上述变量。确认已有环境与站点；只有凭证就位后才运行实际适配器测试。
- 开发验证可用官方 CLI 支持的会话临时凭证：先核对当前 CLI 帮助及[官方说明](https://docs.cloudbase.net/en/cli-v1/secrets/management)，经授权在子进程内存中捕获并映射，不把获取凭证命令的输出打印到工具日志。
- 长期部署使用运行环境受支持的服务端凭证供给方式，并按目标环境和操作限制权限。当前适配器在启动时读取身份，**没有自动刷新 STS 的实现**；更新环境后需要重启服务，不能将一次测试会话的临时凭证作为长期配置。
- WorkBuddy 托管云服务只有原生调用或 publicConfig 时，使用其原生路线，见 [多平台路线](platforms.md)。这些字段不是本 Node 适配器所需的服务端身份；不得从浏览器或其他项目提取凭证来补齐。
- 用户没有现有环境或缺少安全配置时，准确报告阻塞。创建资源、购买套餐、修改权限规则不属于验证已有环境的默认范围。

## 验收与删除确认

1.2.0 起新生成项目内置 [存储检查命令](storage-check.md)。先执行 `npm run webapp:storage-check` 核对配置；明确授权本环境的测试上传后，再执行 `npm run webapp:storage-check -- --probe --report /absolute/new-report.json`。检查使用实际适配器并记录恢复所需对象键，不打印凭证。此通用探针不额外测试向用户分发签名 URL；该项按应用需求另验。

实际上传、下载逐字节比较、删除必须使用生成项目的 `createStorage('cloudbase')`；原生工具演示成功不能替代该适配器通过。只写一个独占随机前缀的小测试文件，清理范围仅限该对象。

删除 API 接受后，结合相同对象的独立只读结果核对：列举本次前缀，并重新调用 SDK 下载或获取下载地址。`STORAGE_FILE_NONEXIST` 表示文件不存在；权限错误、超时及未知结果不能当作删除成功。需要结合删除前同一身份成功读写、对象路径一致性确认，不能只凭任意一个报错作结论。

**不要仅用删除前签发的旧 URL 是否返回 404 判定清理。** CloudBase 存储默认有 CDN 缓存，旧链接可能仍返回 200；保留原脚本状态，并用独立核对补充最终结论。对象删除与已分发链接立即失效分别验证，不承诺签名参数必然控制所有模式的失效时间。官方参考：[缓存机制](https://docs.cloudbase.net/storage/manage)、[错误码](https://docs.cloudbase.net/error-code/basic)。

跨用户隔离要通过应用后端的两个普通用户会话检查，不能用管理凭证跨用户读取来推断普通用户权限规则。

2026-11-09 的 WorkBuddy 实测覆盖包内实际适配器：上传、下载内容比较、签名下载和删除通过；独立列举为 0，重新下载及获取链接均返回文件不存在。SDK 4.2.1 与其专属 Axios 0.34.0 组合的当次 npm audit 为 0 漏洞。证据由用户提供并本地核对；不包含凭证，不代表所有环境、后续依赖版本、原生云服务或部署均已验证。
