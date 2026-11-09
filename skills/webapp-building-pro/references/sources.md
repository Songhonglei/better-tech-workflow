# 来源与整合范围

来源为用户提供的 webapp-building-with-deps 本地包；未声称拥有原始资源的额外授权，分发前需遵守适用的来源许可。本 Skill 收录于 [better-tech-workflow](https://github.com/Songhonglei/better-tech-workflow/tree/main/skills/webapp-building-pro)，自有整合代码与来源资源的许可范围见 [LICENSE](../LICENSE)。

## 来源校验值

| 来源文件 | SHA-256 |
| --- | --- |
| skills/backend-building.skill | d7a347f12376e50c044bb170c90fde30421548036623b0a21fdc956a5fae2e63 |
| skills/musepool.skill | c3ceebb0098f185a4516af018244a0d3ba66e76fbfad56e504519691cda98f8b |
| skills/webapp-building.skill | 41b4978323cfb72b62d8bd33684d61d338720d7c73015c728eec0d180c2fc20d |
| skills/website-storage.skill | 7f5b6a6210647865c0bdae9f021781667e88d820f027f93cf83a4bab9fd0a0e0 |
| skills/xiaohongshu-minitool.skill | b073aa80b96d3ead7898595c36cc4fd20776f59c178ec7419faa938730230dec |
| templates/admin-console/admin-console.zip | 0fceb6f859b013323389b21f68949bfd698f05bf89abb39bb2b4c176d8043808 |
| templates/admin-console/info.md | f2b5317639c59ea4e1e03ad486bc0b3bccf9b4042015e0d403212c89f54c2f8f |
| templates/data-to-dashboard/data-to-dashboard.zip | fcf7e17e3dbbd927e4fcc09387f72c8c53a807b66f45be6385b88257864803b1 |
| templates/data-to-dashboard/info.md | 13ff5c7ba1372f36259430d2670a50700acedd524eabf14aca9407c1d2e397e7 |
| templates/lucky-draw-cn/info.md | 3ebae9209ea4fd0388aa7b6673d9bbf04e280042518d644cb145473749e77a2d |
| templates/lucky-draw-cn/lucky-draw-cn.zip | 8d1b0e3e2db14bf3b3e2f458e9cfc3d6976edfe60e9ca83f7e3fe39710cd32ef |
| templates/market-watch-cn/info.md | 4353e3d019b117efb064856c53835875b1e6349212fbbe56b1090d287c66ac9a |
| templates/market-watch-cn/market-watch-cn.zip | d593c3932451d010433f826b4ed88283ecc96a34053da819a309f84b532390e1 |
| templates/minimal-timer-cn/info.md | 0f33238b81c8ddfb18fe2c32528c801e017a80aed1defecd14bca14b7274e72a |
| templates/minimal-timer-cn/minimal-timer-cn.zip | 27bed8eb642a71fcbb49ec722bce166a3a19ebddd6f7ffe5a47df44fadd9dc12 |

## 功能归属

- webapp-building：React/HTML/Three.js、设计/PWA/手机与交互验证；基础模板来自其 0-origin。初始化改为可移植模板注册与安全解包，不默认调用 Portal 或提交 Git。
- backend-building：保留后端代码模板、接线脚本及开发文档；增加本地 db 模式、接线预检、移除全局 Git 和自动提交、修复缺失 node_modules 假设、JSON 序列化与凭证合并。
- website-storage：保留 storage.ts；文档示例补文件归属、限定用户前缀、使用真实 tRPC 客户端序列化并调整删除顺序。仅支持真实配置的 Kimi 存储。
- musepool：保留 recall/fetch CLI；改为按需调用的可选服务，说明 SDK、费用和来源披露，不强迫所有任务调用收费服务。
- xiaohongshu-minitool：保留 builder/cli 的脚本与 references，单入口整合，适配宿主图片和提问能力；保留真机预览及送审授权要求。
- templates：源目录的五个业务模板全部保留，五个业务模板 ZIP 原样复制；0-origin 的锁文件根据实际 npm 安装结果修复，清单与源码保留；基础模板说明去除固定平台目录与过时 Node 版本提示；模板 info.md 原文保留，实际执行以当前用户需求和本 Skill 授权边界为准。

## 模块脚本

后端 scripts/lib/*.mjs 负责原有增量补丁，scripts/template/ 保存项目代码；scripts/init.sh 为接入入口。小工具 builder/scripts/ 提供最终产物审计与 manifest 生成，cli/scripts/ensure-cli.mjs 为运行时版本门禁，具体使用见各 GUIDE.md。测试不连接付费/业务服务。

仅镜像构建用的 .prepare-template.sh 及其工具链 package/lock 不随运行时分发，所需依赖由 feature 清单合并至生成项目。

## 1.1.0 增量

新增通用账号与文件服务（代码位于 modules/universal/templates），全部 HTML/Three.js/React/JSX 模式可接入，保留原前端和 CommonJS/ESM 语义。新增 OpenAI identity-only OIDC、可选 OSS/CloudBase/WebDAV 存储代码与账号文件页；平台原生身份、Sites R2/D1、WorkBuddy 和 Kimi 的发布按 references/platforms.md 的真实宿主路线执行。浏览器优先 ego，Musepool 仅 Kimi；AI 标记 2.0 未实现。

本次还修复小工具版本门禁 --help 会触发安装的问题；真实小红书验证仅登录、配置和列表，无写入。Hono Node 服务适配器提升至 2.1.3 修复已知静态解码漏洞；CloudBase SDK 使用 4.2.1 兼容版本及其专属 Axios 0.34.0 覆盖，未更改用户其他库。

## 1.1.1 OSS 私有文件保护

真实联调发现公共站点桶的匿名 Allow 策略可使 private 对象仍被匿名读取。OSS 适配器新增上传前检查：仅接受私有桶且无匿名 Allow 策略，读不到权限状态时拒绝继续；上传对象显式设置 private。回归覆盖公共 ACL 和匿名策略拒绝。真实测试文件已清理，未改现有桶策略或站点内容。

## 1.1.2 CloudBase 使用说明

新增 references/cloudbase.md，说明接入命令、服务端配置、连接器登录与运行身份的区别、STS 到期处理，以及 CDN 缓存下的删除核验；补充真实适配器实测范围。该版只更新说明与元数据，未修改运行代码、依赖或既有项目。用户账号标识、环境 ID 与凭证不随包分发。

## 1.2.0 实测反馈优化

通用生成项目新增 storage-check.mjs：默认只查配置，显式 probe 才对随机对象写入，预先保存恢复报告，区分云端接受删除与确认不存在，未知结果不盲目重试。CloudBase 使用重新解析文件 ID 的 API 结果；WebDAV 仅清理本次新建且确认为空的目录；OSS 保留私有桶预检并加匿名读取检查。补齐 Koofr 及字段映射说明，修正小工具的跨宿主 H5 交付、提问工具依赖、来源复用和空列表判断。新增行为回归，不变更已有用户项目或云资源。
