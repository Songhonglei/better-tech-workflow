# 存储配置与检查

适用于通用 Node 服务的 local、OSS、CloudBase、WebDAV。应用用户、会话、文件归属仍在通用后端；选择对象存储不会自动替换数据库或登录体系。

## 配置与真实验证分开

1.2.0 起新生成项目包含 `server/storage-check.mjs` 与 npm script。在生成项目目录执行：

```bash
# 只查必需字段与 WebDAV URL 格式，无网络请求或云端写入
npm run webapp:storage-check

# 经授权联调选定存储；报告放在 Web 静态目录之外，路径必须不存在
npm run webapp:storage-check -- --probe --report /absolute/private-output/storage-check.json
```

默认结果 `configuration-ready` 仅说明字段齐备，不代表已登录、SDK 已安装或连接成功。缺必需字段为 `blocked`，报告只列字段名，不输出值；不因已有 CLI/宿主登录就判定应用具备服务端身份。

`--probe` 会产生少量存储/API/流量费用，仅在用户已授权验证该环境时执行。它不创建桶、购买环境、修改策略或发布。运行前以 0600 新建报告，写入本次随机对象键后才开始远端写入；对象不足 1 KB，结果不含凭证或签名 URL。

上传、逐字节下载校验、删除和独立不存在检查全部通过才标记 `passed`。删除被接受与已确认不存在分开报告。失败后只清理已确认上传的本次对象一次；上传或删除结果未知时保留对象键与阶段，不重试写入，先用相同身份和该键只读核对。报告已存在时在远端操作前停止，防止覆盖恢复证据。退出码：0 为配置齐备或探针通过（看 mode/status 区分），2 为配置阻塞，1 为失败或清理未确认。

旧项目不自动得到新脚本。已有通用后端时，不再次 adapt；先备份并对比现有 `server/storage.mjs`、相关依赖与配置，再增量合并本版模板的 storage.mjs、storage-check.mjs 及 `webapp:storage-check` script，保留用户定制。

常见恢复入口：缺字段时在服务端配置报告列出的名称；ERR_MODULE_NOT_FOUND 时在该项目检查并安装已声明依赖；EEXIST 时先阅读原报告，确认没有未决操作后再用新报告路径；PROBE_REQUIRES_REPORT_PATH / INVALID_ARGUMENT 时运行 `npm run webapp:storage-check -- --help`。failed 与 cleanup-needs-confirmation 都不能直接当作通过，先看恢复对象键和 cleanup 阶段。

## OSS：网站桶与私有附件桶分开

服务端配置 OSS_REGION、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET；临时身份还需 OSS_STS_TOKEN。使用私有桶，策略不能有匿名 Allow。应用身份需读取目标桶 ACL/策略及在指定对象范围上传、设 ACL、读取、删除的权限；读不到策略时不能绕过预检。

探针沿用适配器的 ACL/策略检查、每次上传显式 private，并检查该随机对象的匿名 GET 返回 403；不能只凭上传成功或对象 private 就认定隐私成立。删除后以 SDK GetObject 返回 NoSuchKey/404 核实。OSS_PRIVATE_BUCKET_REQUIRED 或 OSS_ANONYMOUS_POLICY 应通过独立私有桶解决；不自动修改已有网站桶。该检查反映本次配置，运营方仍需防止后续将桶或策略改为公开。

用户提供的配置字段若为 accessKeyId/accessKeySecret，由 Agent 在进程内映射到本模块的 OSS_* 字段；不执行用户 env 文件、不将密钥写入项目源码或 Skill。官方依据：[OSS 授权判定](https://www.alibabacloud.com/help/en/oss/user-guide/authentication)。

## WebDAV / Koofr

配置 WEBDAV_URL、WEBDAV_USERNAME、WEBDAV_PASSWORD，分别保存 URL 与凭证，不在 URL 中嵌密码、查询参数或分享 Token。仅使用 HTTPS；基础目录必须已存在。

Koofr 示例（全部用户值为占位）：

```dotenv
WEBDAV_URL=https://app.koofr.net/dav/Koofr/
WEBDAV_USERNAME=your-registered-email
WEBDAV_PASSWORD=your-app-specific-password
```

Koofr 使用注册邮箱及单独生成的应用密码，不使用普通网页登录密码。可以由用户在本机私密文件填写，再只读加载到服务端环境；不要索取聊天明文。官方依据：[Koofr WebDAV](https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/)。

探针必须新建随机目录（MKCOL 201）再上传；405 不代表探针拥有该目录，停止而不写文件。删除测试文件并 GET 404 后，再用 Depth:1 列举确认只剩目录自身，才删除本次新建的空目录；列举格式无法识别、出现其他文件或结果未知时保留目录，不递归清理或重试。最后以 PROPFIND 404 核实目录不存在。

401/403 先核对应用密码与目录权限；404 核对基础路径；重定向应核对服务商实际 HTTPS WebDAV 地址，不把认证自动带到重定向目标。

## CloudBase

凭证、STS 到期与宿主路由见 [CloudBase 用法](cloudbase.md)。删除后用同一 fileID 重新调用 SDK 下载及获取链接，两者都明确表示 STORAGE_FILE_NONEXIST 才确认；权限/网络错误不算成功。探针不复用旧签名链接作清理依据，避免 CDN 缓存导致误判。

## 历史实测的边界

独立 OSS 私有桶、Koofr WebDAV 与 CloudBase 实际适配器均已有真实核心流程证据。新检查命令的自动化回归与这些历史云端实测分别报告，不宣称新增代码已经逐服务真实复跑。用户普通会话隔离、宿主原生云服务和发布需单独验收。完整结果与来源留在用户的外部验收目录，不随 Skill 分发用户资源标识。
