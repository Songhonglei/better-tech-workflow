# 小工具 ZIP 构建指南

**小工具是一种基于离线 H5 实现的 app 形式**：Builder 负责把 H5 页面开发、适配、审计并打包为可上传的小红书小工具 ZIP。小工具以 ZIP 根目录的 `index.html` 为入口，由容器（PC 模拟器 / 真机 WebView）加载运行。它本质就是 Web，HTML/CSS/JS 经验直接适用——只是运行在受控容器里：**页面资源必须本地打包，网页不能直接联网**，可用平台能力以在线文档的对外内容为准，且部分 Web 能力被收紧。

目标产物：可直接上传的 **`.zip` 静态包**，并附带创服平台模拟器、Android 真机和 iOS 真机的验证提醒。Builder 只负责代码和 ZIP 产物，不负责账号关联、平台上传、真机预览或提交审核；这些操作由上层小红书小工具流程和 `cli/GUIDE.md` 负责。


## 何时使用

- 从零新建小红书小工具页面并打包 ZIP；
- 将已有 H5 页面适配为小红书小工具并重新打包；
- 核对端能力、兼容性、离线资源和最终 ZIP 是否符合规范。

## Agent 行为规则

- 在线文档是当前能力契约；随包的 [`references/js-api.md`](references/js-api.md) 只用于识别变化，以及在线文档不可访问时的保守兜底。
- 只有在线文档明确面向开发者开放并提供完整说明的能力才可使用或报告。平台不支持或无法离线完成的需求应调整范围，不得伪实现。
- 检查必须针对最终构建产物。源码、配置、普通浏览器或模拟器通过，都不能证明小红书容器或真机兼容。
- 只报告有检查结果支持的状态。
- Builder 只生成和交付 ZIP；不要在 Builder 流程中代替上层流程登录、上传、创建真机预览或提交审核。
- **创服平台与真机验证提醒** — 交付时提醒用户：将本次生成的 zip 上传至创服平台，先在平台模拟器完成完整功能验证，再分别使用 Android 真机和 iOS 真机扫码验证相同产物。除非用户明确授权且当前环境具备对应能力，否则不得主动尝试登录创服平台、上传产物或启动真机验证；将这三项标记为待用户验证，不阻塞 zip 交付

## 工作流程
### 1. 核对能力契约
开始任何实现前，先完成在线能力发现与基线比对；后续每一步动手前再读对应 reference，不要凭记忆产出：
**读取随包基线** — 每个任务开始时先读 [js-api.md](references/js-api.md) 作为冻结基线，再获取[小工具在线文档](https://miniapp-sandbox.xiaohongshu.com/minitool/doc)。比较面向开发者公开的 API、参数、限制和支持条件；有新增或变化时，在实现前简洁告知用户。若受网络或沙箱限制无法访问，按当前工具的授权机制请求用户仅批准访问该链接和在当前工作区保存文档副本；不得试图绕过限制。
**以在线契约实现** — 在线文档成功获取后始终以其中明确对外的内容为唯一 API 契约；实现每项需求前先查找匹配的容器能力，文档明确支持时必须优先使用，仅在没有匹配能力或当前环境不满足文档条件时才采用兼容的 Web 方案。在线文档不可用时，才可依据本地基线保守实现并提示用户后续核验。内部、预留或未明确对外的能力不得提及。

### 2. 开发或适配页面

先读取 [`references/zip-artifact-spec.md`](references/zip-artifact-spec.md)，按离线页面、入口结构、资源引用和 CSP 规则实现。

根据本次改动匹配 Reference 表并读取相关文档：

- 新建小工具或大范围改造时，读取端能力、JavaScript、CSS 和跨端适配文档；
- 局部修改时，只读取与改动涉及的能力和代码类型相关的文档；
- 使用较大静态数据、Base64、媒体或 WebGL 时，读取性能文档。

按在线契约实现端能力。平台不支持的能力应移除或调整方案，不得伪实现。

### 3. 构建并审计最终产物

构建后检查最终输出，不能以源码、配置或开发服务器通过代替产物检查。

读取 [`references/mini-tool-manifest.md`](references/mini-tool-manifest.md)，根据最终代码生成 `mini_tool.json`；运行可用的审计脚本，并按 [`references/zip-artifact-spec.md`](references/zip-artifact-spec.md) 的自检清单检查 ZIP 结构、资源引用、禁用能力和正确性。

审计命中体积、媒体、静态数据或 WebGL 风险时，读取 [`references/performance-budget.md`](references/performance-budget.md) 处理。发现错误后修复、重新构建并重新审计。

### 4. 打包并返回结果

生成待上传 ZIP：`index.html` 必须位于 ZIP 根目录，所有资源使用包内相对路径。报告在线能力核验、静态审计和兼容性检查结果；未完成的能力验证明确标记为“未实测”。

> **浏览器直运行不可信**：仅将代码在普通浏览器中直接运行所得结果不可置信，不得作为小工具功能、兼容性或交付验收的依据。交付时再次提醒用户完成创服平台模拟器、Android 真机扫码与 iOS 真机扫码验证。

> **产出前提**：交付的 zip 必须同时满足 `zip-artifact-spec.md`、`device-capabilities.md`、`js-compatibility.md`、`css-compatibility.md`、`performance-budget.md` 与小工具在线文档的全部约束；交付说明必须包含创服平台模拟器、Android 真机扫码与 iOS 真机扫码验证提醒。

## Reference

| 文档 | 何时读 |
| --- | --- |
| [小工具在线文档](https://miniapp-sandbox.xiaohongshu.com/minitool/doc) | 每个任务开始时获取：与随包基线比较并播报新增能力；以当前页面为唯一 API 契约 |
| [`references/js-api.md`](references/js-api.md) | 每个任务开始时读取：作为识别在线新增能力的冻结比较基线；实现 `window.xhs.*` 或在线文档不可用时保守兜底，不得覆盖在线契约 |
| [`references/zip-artifact-spec.md`](references/zip-artifact-spec.md) | 每个开发或打包任务必读：查看目录结构、`index.html` 模板、路径与资源引用规则、容器 CSP 和打包自检 |
| [`references/device-capabilities.md`](references/device-capabilities.md) | 处理端能力、使用小红书原生能力或代码涉及受限 Web API 时：查看哪些 Web 能力可用 / 不可用及替代写法，以及如何实现常见交互（手势、拍照、选图等） |
| [`references/js-compatibility.md`](references/js-compatibility.md) | 新增或修改 JavaScript、构建配置或运行时 API 时：查看 Android 8.1 出场 Chrome / WebView 61 最低基线、Web API 检测与局部降级 |
| [`references/css-compatibility.md`](references/css-compatibility.md) | 新增或修改 CSS、布局、视觉增强或兼容性回退时：查看 Chrome 61 基线、能力检测、现代 CSS 增强与局部回退 |
| [`references/cross-platform-h5.md`](references/cross-platform-h5.md) | 处理触摸、滚动、安全区、软键盘或设备差异时：查看触摸、滚动、安全区、软键盘以及 PC 模拟器与真机差异 |
| [`references/performance-budget.md`](references/performance-budget.md) | 开发和交付前，或使用较大数据、Base64、媒体、长列表、WebGL 及审计命中相关风险时：查看包体和资源控制、性能设计与运行时降级 |
| [`references/mini-tool-manifest.md`](references/mini-tool-manifest.md) | 最终代码完成后、每次打包前：查看实际能力识别、唯一布尔字段、未知状态处理以及 `mini_tool.json` 生成规则 |
