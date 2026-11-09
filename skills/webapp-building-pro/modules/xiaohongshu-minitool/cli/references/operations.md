# 安装、登录和排错

## 找到正确版本

发布命令需要 Node.js 18 或更高版本；dev 需要 Node.js 20+。先运行 `node --version`，再确认使用源码入口还是 npm 安装版。

### 当前仓库源码

在仓库根目录安装依赖并查看帮助：

```bash
npm ci
node cli/redapp/index.mjs --help <ENV_ARGS> --agent
```

之后把文档里的 `redapp` 替换成 `node "<REPO>/cli/redapp/index.mjs"` 即可。需要全局命令时，可在用户授权的安装范围内从仓库运行 `npm install -g .`。

### npm 安装版

通过创服可信口令运行时，从本 Skill 目录执行动态版本门禁：

```bash
# Beta 测试
node "<SKILL_DIR>/scripts/ensure-cli.mjs" --env beta --npm-policy beta-first

# 默认
node "<SKILL_DIR>/scripts/ensure-cli.mjs"
```

外层口令必须为当前进程设置用户可写的 npm prefix/cache，并把 prefix 的可执行目录临时加入 `PATH`，不得永久修改 npm 配置。读取 `CLI_VERSION_JSON`，只有 `current`、`installed` 或 `updated` 才能继续；记录其中的实际版本、npm tag 和环境。失败时停止，不改用本地源码掩盖已发布包问题。

门禁会查询 npm 的 `latest`/`beta`、安装选定版本、核对全局安装结果，并验证 `redapp` 帮助中包含当前命令协议。它不提前执行 `whoami`；dev 不需要发布登录，其他业务命令在真正访问接口时再登录。

需要手工诊断 npm 信息时可以只读查询：

```bash
npm view redskillhub-upload@beta version bin --json --registry=https://registry.npmjs.org/
npm view redskillhub-upload@latest version bin --json --registry=https://registry.npmjs.org/
npm ls -g redskillhub-upload --depth=0
```

`--env beta` 不会自动选择 npm Beta；只有 `--npm-policy beta-first` 才会按版本比较选择。默认门禁不传环境或 npm 版本参数，使用正式版本和默认线上后端。不把当前源码版本已打包理解为已发布，也不静默切换版本线或命令协议。

当前 npm 包内含两个 Skill：`skill/` 用于上传 Skill 到 SkillHub，`skills/redapp-cli/` 用于操作小工具。需要分发本 Skill 时，完整复制 `skills/redapp-cli` 目录（包含 `scripts`、`references` 和 `agents`），放入目标 Agent 的技能目录，例如 `~/.codex/skills/redapp-cli`。在支持的环境中可通过 `$redapp-cli` 调用。

### 验证命令协议

仅本地调试时按 [dev 流程](dev.md) 检查运行时和 dev 帮助，不要求上传 dry-run、source 或发布登录。

安装完成后、切换入口或升级时，检查实际将执行的那个入口，不能用源码的帮助输出为全局命令背书：

1. 记录可执行文件的实际路径及所属 `redskillhub-upload` 包版本。源码入口读取所属仓库的 package.json；全局安装结合命令解析路径和 `npm ls -g`，避免 PATH 命中其他安装。当前 redapp 不提供 `--version`。
2. 检查帮助中是否包含 config、list、status、history、upload、preview、submit、edit，以及 `--env`、`--agent`、`--dry-run`、`--confirm`；需要指定泳道时还需支持 `--api-base`。不能只有旧版 `app list` 等命令。
3. 用真实待上传文件执行一次本地 upload dry-run（命令见 workflows），确认输出 `RESULT_JSON.status=dry_run`，且 `plan` 包含 command、environment、apiBase、account、payload、planHash；文件 payload 包含 sha256/md5。dry-run 不访问网络，不能用来证明接口权限。当前尚无素材时可先检查帮助，将此项留到上传前完成，不为检查而上传测试文件。
4. 检查不兼容时停止业务调用，说明实际版本与缺失能力，改用已验证的源码入口或确切兼容版本后重做检查。不自动尝试旧版写入语法。

把入口、包版本、验证时间和结果写入本次操作记录；没有写入流程时留在会话摘要即可。npm 的 `@beta` 是分发标签，`--env beta` 是 API 环境，二者互不替代；安装 beta 包后仍需显式指定 API 环境。

## 登录、取消和退出

```bash
redapp login <ENV_ARGS> --agent
redapp whoami <ENV_ARGS> --agent
redapp login --cancel <ENV_ARGS> --agent
redapp logout <ENV_ARGS> --agent
```

执行前把 `ENV_ARGS` 按触发口令处理：Beta 替换为 `--env beta`，默认口令删除该占位符。不要把尖括号占位符原样交给 shell。

- 实际请求会复用凭证或自动续期；无需每条命令前重新登录。
- prod 状态在 `~/.skillhub-upload`，beta 在 `~/.skillhub-upload/beta`；`SKILLHUB_UPLOAD_HOME` 可替换共同根目录。
- `whoami` 只证明本地登录状态，不证明目标接口授权。
- `login --cancel` 取消待处理设备授权；`logout` 删除同环境的共享本地凭证，也影响 Skill CLI。不要为验证退出而清掉用户当前登录，可在隔离的测试状态目录验证。
- CLI 的小红书 token 与 npm 发布 token 是两套鉴权。`npm login` 不能修复小工具 API 的权限错误。

## 跨 Agent 展示登录和预览

- 能渲染本地图片：用当前 Agent 的图片能力展示返回的 `qrCodePath`；先确认文件存在，使用绝对路径。不要声称“二维码已展示”却只输出文件名。
- 不能渲染本地图片：给出可打开的绝对路径，同时提供返回的 `authorizeH5Url`，说明需在手机浏览器打开；字段未返回时不要编造链接。无法访问 Agent 所在机器文件的远程客户端优先用返回的手机授权链接，不把登录二维码上传公共图床。
- 登录进程使用能保留会话并增量读取输出的执行方式。出现 PROMPT 后立即交给用户扫码，继续等待同一进程的 RESULT_JSON；不能把工具返回 session ID 或用户说“已扫码”当作登录成功。环境不能维持进程时明确交接用户在本地终端完成该命令，不能后台反复启动登录。
- 用户明确取消或本次进程返回超时/取消后结束等待；需要再次登录时才启动新流程，不复用失效授权链接。
- 预览同理：展示返回的二维码及 `previewUrl`，不能展示图片时给出路径和链接。二维码生成失败但 URL 已存在时，只补本地展示，不再次调用 preview。送审流程必须提供可扫描二维码并取得用户明确的预览通过反馈；只有链接或二维码生成成功不能满足此条件。除非用户明确确认手机预览通过，不报告“手机验证通过”。

## 接口错误与复测

| 现象 | 诊断和下一步 |
| --- | --- |
| `未登记的三方来源：web` | 小工具 source 应使用后端已登记值；本项目联调为 thirdAgent。不要枚举来源试图获得权限。 |
| `access denied for this path` | 路径授权被拒绝，核对环境、token scopes、Edith 插件及 OAS 的 scope→paths 配置。源码位置为 `oauth.scope.info` 内各 scope 的 `paths`；没有配置读取权限时不能宣称具体缺失项已确认。 |
| `HTTP 400`，原始响应含 `required param check: userId ... got none` | 核对 Edith token 插件与 `userId → context:c_current_user_id` 映射；不从用户处收集或自行补 userId。仅此响应不能区分插件未注入与映射缺失。 |
| `HTTP 404` | 核对实际域名、泳道、方法和路径。HTTP 200 中的业务 code 403 与 HTTP 404 分开记录。 |
| `HTTP 500` / `REQUEST_FAILED` | 只读查询可按用户要求重试；写入先核对是否已生效。不要把服务器异常当成参数问题自行改 payload。 |
| `AUTH_REQUIRED` | 检查同环境登录和接口授权；不退回 Cookie。 |
| `INVALID_ARGS` / `LOCAL_VALIDATION_FAILED` | 依据具体错误修正命令、JSON 或素材。 |
| 确认哈希不匹配 | 账号、环境、网关、输入或文件发生变化，重新 dry-run。 |
| `OUTCOME_UNKNOWN` | 停止自动重试，查询 list/status/history 核对；查不到不能直接等同于未写入。 |

当前 CLI 对非 2xx 响应通常只展示 HTTP 状态。需要原始响应诊断时，使用已授权的同环境请求并脱敏记录；不要把凭证写入 Skill、报告、示例或仓库文件。

### 最近联调快照（2026-10-22，非永久能力声明）

环境：qinweiheng beta，来源：thirdAgent。

- config、list、ZIP 上传、PNG 上传成功；list 返回 15 条记录。
- status、history、preview、submit、edit 均被 HTTP 400 / 缺少 userId 拦截；edit 使用不存在的测试 ID，只验证了网关错误，未完成编辑成功链路。
- login 复用已有凭证成功；logout 在隔离目录验证，login --cancel 仅测了无待处理授权的情况。
- 本地 42 项模拟/回归测试通过，不等于全部真实接口通过。

用户要求复测时读取当前源码和配置，以新的真实响应为准。先读 config/list，再用已存在且属于目标账号的 appId 验证查询。真实上传、预览、送审和编辑应在用户授权的环境及测试对象范围内执行；不要为了生成“全绿”表格而修改已有作品或绕过鉴权。记录每项是本地检查、实际成功、业务拒绝还是未验证。
