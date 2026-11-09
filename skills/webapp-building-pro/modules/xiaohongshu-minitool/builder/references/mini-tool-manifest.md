# 高消耗能力标记

在最终待打包目录中识别能力，`mini_tool.json` 与 `index.html` 同级。文件只生成一个必填字段：

```json
{"is_high_consumption_scene": true}
```

不生成 schema_version、能力列表、识别状态或其他字段。字段必须是 JSON 布尔值，不能是字符串或数字；不保留旧文件内容。

## 识别规则

检查最终入口、内联脚本、打包 JS、依赖及其调用路径，以实际启用行为判断；不要只靠关键词扫描。识别记录保留在交付说明中，不放入包内协议。

| 能力 | 判 true 的证据 | 单独出现不足以判 true |
| --- | --- | --- |
| Worker | 实际创建 Worker，包括别名或封装后的调用 | 字符串、注释、能力探测、未调用的库代码 |
| 离屏渲染（如 OffscreenCanvas） | 实际使用离屏画布渲染，包括创建 OffscreenCanvas 或 transferControlToOffscreen 后使用，以及封装后的离屏渲染路径 | 类型声明、存在性探测、未启用的渲染分支 |
| WebAssembly（含动画效果） | 实际编译、实例化或执行 WASM，包括由动画库间接调用 | 对象存在性判断、未使用的 loader、仅使用 CSS / 普通 JS 动画 |
| Unity、Cocos 等游戏引擎 | 引擎启动并承担页面或游戏运行，包括依赖封装后的引擎启动 | 静态资源名称、未启动的引擎依赖 |

上述任一类能力确认实际使用，必须写入 `is_high_consumption_scene: true`，不以是否已观察到卡顿为前提；只有完整检查最终代码且上述能力均未使用才可 false。无法检查依赖、动态路径不明或识别失败，记为 unknown，不默认 false。标记不授予能力权限：现有在线规范禁止的能力仍须移除或改写，不能用 true 绕过合规审计。

## 识别后的用户提示

确认实际使用上述能力并判定为 true 后，立即向用户列出命中的能力，说明本次产物将写入高消耗标记；最终 ZIP 交付时再次提醒。建议文案：

> 检测到本小工具实际使用了【具体能力，如 Unity / Worker】，将标记为高消耗场景。按 Android 默认门禁策略，本次发布包要求 Android 13（API 33）及以上运行；实际限制以客户端生效的开关和系统版本阈值为准。

这是一条兼容性提示，不代表已修改发布平台配置或完成发布。若已确认实际生效阈值不同，应按该阈值提示，不能固定宣称 Android 13；仅提及名称、能力探测或识别未完成时，不发送已命中提示。原有能力合规及兼容性检查仍需完成。

## 写入与打包

先移除历史标记，完成上述识别后，使用 Node 脚本写入最终目录：

```bash
node <skill-dir>/scripts/write_manifest.mjs <artifact-dir> unknown
# 完成实际使用核对后，选择 true 或 false；无法完成则维持 unknown
node <skill-dir>/scripts/write_manifest.mjs <artifact-dir> true
```

`true` / `false` 生成一字段 JSON；`unknown` / `failed` 删除旧标记，不生成新标记，记录日志并继续原有打包流程。脚本不代替语义识别。

没有 Node 时，以同样规则直接写入 UTF-8 JSON（或删除旧标记）；无需为此安装依赖。若目录不可写、无法删除旧标记，不能把旧标记继续打包，应换用干净的产物目录。

打包前确认根目录最多一个 `mini_tool.json`，不存在重复 ZIP entry、重复 JSON 键或旧版本文件。代码或依赖变更后重新识别，不能复用上次结论。

## Android 下游行为

支持该门禁的 Android 客户端在新包解压成功后，读取最终 `source/mini_tool.json`；仅合法布尔 `true` 生成 `{包hash}/.high_consumption`，与 `source/` 平级。生成不受开关或系统版本限制；解析或写入失败不改变资源准备结果。派生标记随 hash 包目录清理。

打开时，客户端依据 `mini_tool_consumption_gate` 的有效配置执行判断：

- `enable=false` 或系统 API ≥ `min_android_api`：跳过标记查询，继续原流程。
- `enable=true` 且系统 API < `min_android_api`：仅查询派生标记，存在才拦截，提示“当前系统版本暂不支持此小工具”。
- 派生标记不存在或查询异常：放行，不回读 `mini_tool.json`；旧缓存不补录，待重新下载解压后生效。

配置默认 `enable=true`、`min_android_api=33`（Android 13）；阈值可调整，不能宣称所有 Android 13 以下设备必定被拦截。`false`、缺失或非法 JSON 不生成新派生标记，原有系统、内核等准入规则仍生效。此处仅描述 Android 实现，不承诺创服提示或 iOS 行为。

`.high_consumption` 由客户端生成，builder 不生成、不打包；`enable` 和 `min_android_api` 属于客户端配置，不写入包内协议。包内仍只交付上述一字段 `mini_tool.json`。
