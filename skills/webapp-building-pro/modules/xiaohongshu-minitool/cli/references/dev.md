# 本地模拟器调试

用户要求开发调试、在模拟器运行静态页面或启动 dev 时读取本页。不要求上传素材、填写发布表单或登录发布账号。

```bash
redapp dev --dir "./dist" <ENV_ARGS> --agent
redapp dev --dir "./dist" --no-open <ENV_ARGS> --agent
redapp dev --help <ENV_ARGS> --agent
```

执行前把 `ENV_ARGS` 按触发口令处理：Beta 替换为 `--env beta`，默认口令删除该占位符；占位符不能原样执行。

## 启动与交接

1. 检查实际执行 CLI 的 Node.js 版本，dev 要求 20+，其他命令仍支持 18。先查看该入口的 dev 帮助确认版本已支持，不能用旧版全局 redapp 代替当前源码。可把命令入口替换为 `node "<REPO>/cli/redapp/index.mjs"`，参数仍放在 dev 后。
2. 优先复用用户给出的静态目录；只有源码时按项目说明检查并构建，随后指向 dist 等产物目录。默认目录为当前目录，根目录有 index.html 或唯一 .html 即可；不传 ZIP 或含 node_modules/.git 的项目根目录。目录内不要包含凭证及无关文件。
3. CLI 首次通过 npm 安装公开包 `@skillbuilder/miniapp-simulator@0.2.0`，下载源遵循 npm 配置，未配置时使用官方源。支持 `npm_config_registry`、用户级 `~/.npmrc`（含 scope 专属源）及 `npm_config_userconfig`；安装使用独立 prefix，不自动读取调用目录的项目 `.npmrc`。SDK 和下载缓存独立放在 `~/.skillhub-upload/simulator/`（支持 SKILLHUB_UPLOAD_HOME）；不改用户项目依赖，已有同版本 SDK 缓存不会因换源重新安装。启动有安装提示时等待同一进程，不重复启动。
4. 默认打开浏览器；Agent 要在自己的浏览器面板打开时可用 --no-open，然后读取 `RESULT_JSON.status=ready` 中的 `data.url` 打开实际地址。服务固定监听 127.0.0.1、随机端口；远程 Agent 的 localhost 不一定是用户电脑，无法访问时说明运行位置，不擅自改公网监听或宣称用户已能打开。
5. 保留运行中的工具会话，并记录 URL 和进程/会话 ID。调试结束时向该进程发送 Ctrl+C 或 SIGTERM，等待退出，SDK 会关闭服务和文件监听。不要终止所有 node 进程。ready 仅代表服务就绪，实际浏览器渲染、点击测试单独报告。

## 环境与能力边界

- CLI 根据环境参数选择模拟器地址，通过 `remote.serviceUrl` 传给 SDK：默认参数使用 `https://miniapp-sandbox.xiaohongshu.com/simulator/`，`--env beta` 使用 `https://miniapp-sandbox.beta.xiaohongshu.com/simulator/`。Beta 口令不得省略 `--env beta`；默认口令不附加环境参数。ready 输出的 `data.environment` 与实际选择一致。Beta 需要相应网络访问条件。默认 appId 为 local-workbench、businessLine 为 skill-designable；模拟器地址不根据 Edith 网关切换。
- dev 不支持 --source、--api-base、--host、--port、--entry，不走发布登录，不要求 dry-run/confirm。即便其他业务命令固定 qinweiheng 泳道，也不要给 dev 追加网关参数；SKILLHUB_UPLOAD_API_BASE 不改变模拟器地址。
- HTML/JS/CSS 新增、修改、删除会自动重载，内存状态可能重置；只改图片、字体、音频或 JSON 时点工作台“重新运行”。设备和展示模式在工作台切换。
- 工作台需要连接远程模拟器。外链 CDN 可能受 CSP 限制，不保证任意外链都能加载；不重复创建 Remote 模拟器、不硬编码 Runtime/Service Worker 地址、不声称自动注册了 MCP tools。
- dev 调试不等于发布预览，不会生成送审用手机二维码；即使本地调试通过，仍须执行 preview 生成二维码并等用户扫码确认，再送审。

## 错误处理

- `DEV_NODE_VERSION`：改用 Node.js 20+ 的实际执行入口，不自动升级或覆盖用户全局 Node 环境。
- `DEV_INSTALL_FAILED`：检查 npm 是否随 Node 安装、网络、registry 配置及目标版本是否可用。它与小红书发布 token 无关，不让用户重复扫码。
- `DEV_SDK_INVALID`：检查错误中指出的版本缓存；确认损坏后移到备份位置再重新启动，不清理登录凭证。
- 浏览器自动打开失败：服务仍保留，给出实际 URL 手动访问即可，不重启整个服务。
- 源码/模拟测试通过不等于跨平台验收。当前文档只确认 Node 20/22 消费测试，Windows/Linux 的真实使用仍需验证。

依据：[小工具模拟器 npm 使用与外部 CLI 接入指南](https://docs.xiaohongshu.com/doc/39ecf168ce62eed3ffe16f8c32d3a2ad)，2026-10-22，文档快照 hash `f89e6505c9efb748e1aa12f7f9161f9d`。SDK 升级需重新核对接口和运行要求，不静默换用 latest。
