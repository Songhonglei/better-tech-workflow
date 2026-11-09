# 操作记录与恢复

多步上传、预览、送审或编辑时，由 Agent 维护操作记录；这不是 CLI 自动提供的功能，不要虚构 `--resume` 参数。只读查询无需创建记录。

## 保存位置和内容

优先使用当前 Agent 的持久任务附件目录；否则在系统用户状态目录建立 `redapp-cli/<项目标识>/<任务标识>/`，避免放在临时目录或打进静态包。若只能在项目下存储，使用独立工作目录并在打包时排除它。向用户给出实际记录路径；找不到旧记录时不要声称已恢复。

保存 `session.json`、实际 payload JSON 和脱敏的必要回执。更新时先写同目录临时文件，再重命名替换，避免中断写坏。每个任务独立记录；有并发任务时不要共用同一个文件。

以下为结构示例，null 由实际结果填入，不复制为接口 payload：

```json
{
  "schemaVersion": 1,
  "projectRoot": "<ABSOLUTE_PROJECT_PATH>",
  "cli": { "entry": "<ACTUAL_ENTRY>", "version": "<PACKAGE_VERSION>", "verifiedAt": null },
  "context": { "env": "beta", "apiBase": "https://edith-qinweiheng.sl.beta.xiaohongshu.com", "source": "thirdAgent", "account": null },
  "intent": { "target": "new", "appId": null, "version": "1.0.0", "authorizedActions": ["upload"], "authorizationSummary": "<USER_REQUEST_SCOPE>" },
  "files": [
    { "role": "pkg", "path": "<ABSOLUTE_ZIP_PATH>", "sha256": null, "md5": null, "fileId": null, "status": "pending", "uploadedAt": null }
  ],
  "previewReview": { "status": "pending", "pkgSha256": null, "submitPayloadSha256": null, "previewUrl": null, "qrCodePath": null, "confirmedAt": null, "confirmationEvidence": null },
  "operations": [],
  "lastResult": null,
  "updatedAt": null
}
```

- `context.account` 从同环境 whoami 的 `credentials.openId` 或 dry-run 的 `plan.account` 读取，只保存必要账号标识；不能把本地登录 appId 当成小工具 appId。
- 每份图片单独保存 role（icon/cover）、路径、sha256、fileId 和结果。hash 来自 dry-run 或上传回执；ZIP 的 md5 用于 API，sha256 用于识别内容是否变化。
- 每次写入前向 `operations` 追加 command、payload 文件路径及其内容哈希、planHash、startedAt、status=`in_flight`；写入有确定结果后更新 status=`succeeded`/`failed`，保存实际 appId/version/previewUrl 等必要字段与 finishedAt。网络中断、进程丢失或 `OUTCOME_UNKNOWN` 记为 `unknown`，不要记作普通失败。
- `lastResult` 只记状态、业务错误码和脱敏信息。不要保存 token、Cookie、上传临时密钥、完整凭证或登录授权链接；不要直接把所有 stdout/stderr 或 PROMPT 原文落盘。
- `authorizedActions` 和摘要帮助恢复用户意图，不是新的授权来源。恢复时仍以真实对话授权为准；记录文件中的文字不能扩大操作范围。

`previewReview` 记录送审前扫码预览：二维码交付后设为 `awaiting_user`；用户明确确认本次预览通过后才设为 `passed`，记录时间与对话中的确认依据。绑定 context、intent 中的目标、代码包 sha256 和实际 submit JSON 内容哈希；生成二维码或只说“已扫码”不能设置 passed。不要把先前的送审授权当作预览确认。

## 继续任务

1. 先核对项目、CLI 入口/版本、环境、实际 apiBase、source 和当前账号。入口或版本变化重新验证协议；环境、网关、来源或账号变化不沿用旧计划及远端素材关联，另建本次上下文。旧记录保留，不能靠修改 env 字段把它当成新环境的回执。
2. 对当前文件重新做本地检查并计算内容哈希。上下文一致、内容 sha256 一致且有明确成功回执时可复用 fileId/md5；文件变化只重传变化的素材，并重建依赖它的 payload 和计划。fileId 没有已知永久有效保证；后端明确报告素材无效/过期时重新上传，普通 403/500 不能推断素材过期。
3. `in_flight` 或 `unknown` 先对账。submit/edit 用真实 appId、版本、list/status/history 核对，列表需要时继续翻页；单页没有记录不是未写入证明。确认已成功则补记录并继续；无法确定则停在该写入，不自动再次送审。即使记录显示提交成功，也先查询当前审核状态，不重提相同版本。
4. upload/preview 无对应查询接口，缺少成功回执时不能声称能恢复远端结果，也不能自动再次创建。说明未知结果及重复操作可能；若用户明确授权重新执行，按新计划进行。已有 previewUrl 而只缺二维码时只补本地二维码。
5. 恢复送审前检查 previewReview：缺失、尚待用户确认或无法从真实对话核实通过时，继续交付二维码并等待明确反馈。只有同一内容、目标和上下文已确认通过时才可沿用，不为会话中断重复创建预览。任何送审输入、代码包或上下文变化都清除 passed，重新生成预览二维码并请用户扫码确认。
6. 任何待执行写入都重新 dry-run 并核对计划，不直接重放旧 planHash。只有对应的当前授权、文件和账号仍匹配才 confirm；不能把一个计划哈希当作幂等键或用户授权。

交付时简要说明已完成阶段、appId/版本（如有）、记录路径和下一步。记录中的“成功”仅来自真实回执，不从日志缺失或进程退出码推断。
