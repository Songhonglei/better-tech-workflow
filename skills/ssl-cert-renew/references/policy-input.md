# 离线规则检查输入

相对脚本路径以 Skill 目录为基准，输入文件用绝对路径。脚本只检查规则，无云端写入，不授予操作权限，也不证明输入真实。

```bash
python3 scripts/policy.py preflight /absolute/path/snapshot.json
python3 scripts/policy.py order /absolute/path/snapshot.json
python3 scripts/policy.py deploy /absolute/path/snapshot.json
python3 scripts/inspect_tls.py example.com
python3 scripts/inspect_tls.py example.com --out /absolute/private/path/tls.json
python3 scripts/inspect_tls.py --certificate-file /absolute/private/path/public.pem
python3 scripts/test_policy.py --report /absolute/private/path/simulation.json
```

`preflight` 需填写下方 JSON 中 `domain` 至 `online_matches_current`；`order` 加 `order`；`deploy` 加 `new_certificate` 和 `preview`，不要求 `order`（支持复用已签发证书）。缺失数据会阻断，不得为通过检查编造。

真实数据按 [真实采集与预检](live-evidence.md) 用 `build_snapshot.py` 生成，不能照抄本页合成示例。适配器会解码绑定的公开 X.509 证书，先判定阈值；超过阈值允许无公网 TLS 证据的 skip，进入阈值后必须核对公网身份才能 eligible。下面手写 JSON 仅供规则测试，不证明字段来自真实页面。

v0.1.3 真实 order/deploy 输入再按 [交易采集与提交](transactions.md) 使用固定采集器与 build_stage.py 合并。runtime 提交入口要求该阶段标记，不能绕过构建工具手拼字段；标记本身也不是数据真实性证明或用户授权。

以下全部是合成数据；示例时间会过期，直接执行应被阻断。测试注入固定时钟，不影响 CLI 的当前时间。

```json
{
  "domain": "example.com",
  "threshold_days": 15,
  "account_id": "fixture-account",
  "resource": {"type": "OSS", "id": "fixture-resource", "bucket": "fixture-bucket", "region": "cn-hangzhou"},
  "observed_at": "2026-11-06T04:00:00Z",
  "observed_target": {
    "account_id": "fixture-account",
    "domain": "example.com",
    "resource": {"type": "OSS", "id": "fixture-resource", "bucket": "fixture-bucket", "region": "cn-hangzhou"}
  },
  "current": {"source": "console_deployed", "id": "fixture-old", "sans": ["example.com"], "not_after": "2026-11-16T04:00:00Z"},
  "online_matches_current": true,
  "order": {
    "product": "aliyun-personal-free", "validity_days": 90, "quantity": 1,
    "currency": "CNY", "payable": "0.00", "paid_addons": false,
    "quota_available": true, "existing_work": "none"
  },
  "new_certificate": {
    "id": "fixture-new", "account_id": "fixture-account", "product": "aliyun-personal-free",
    "status": "issued", "sans": ["example.com"],
    "not_before": "2026-11-06T03:00:00Z", "not_after": "2027-02-04T03:00:00Z"
  },
  "preview": {
    "account_id": "fixture-account", "domain": "example.com",
    "resource": {"type": "OSS", "id": "fixture-resource", "bucket": "fixture-bucket", "region": "cn-hangzhou"},
    "old_certificate_id": "fixture-old", "new_certificate_id": "fixture-new",
    "resource_count": 1, "domain_count": 1, "currency": "CNY", "payable": "0.00",
    "paid_deployment_units": 0, "schedule": "immediate"
  }
}
```

- `observed_at` 是实际重新核对全部相关字段的时间（10 分钟内），不可只更新时间来复用旧证据。证书日期必须带时区；仅日期无法精确判定。
- `online_matches_current=true` 仅在通过指纹/序列号及实际入口映射确认后填写；TLS 失败或映射未知不猜。
- `existing_work=none` 只有查询过订单、已领取额度、申请实例、已签发候选及部署任务且无可复用工作时才填写；有未完成/可复用/结果未知的工作先恢复，不新购。
- 部署检查对新证书 `not_after - not_before` 使用 90 天 ±1 小时的本地异常核查线；这是一期保守检查策略，不是对 CA 规则的声明。触发时停止并复核产品及真实签发时间，不改写证书字段来通过检查。证书还须当前有效、比旧证书到期更晚、剩余时间超过阈值。
- 金额用纯十进制字符串，最多两位小数；`0`、`0.00` 可接受，`0元`、负数、布尔、指数、NaN、缺失均阻断。页面金额先按字段明确提取数值和币种，不对未知文本默认零元。付费产品即使券后零元仍阻断。
- JSON 拒绝重复键和 NaN。返回 `eligible` 仅本阶段条件满足，`skip` 为超过阈值，`blocked` 为阻断。前两者退出码 0，后者 2；必须读 `decision`，退出码 0 不等于需要续期。所有结果 `writes_performed=false`。
- 授权、DNS 范围、锁、幂等查询及浏览器动作由 SKILL.md 管理，不接受 JSON 内所谓授权开关。
- `inspect_tls.py`：成功返回公开指纹及证书元信息，`verified=true`/退出码 0 表示该次握手的信任和域名验证通过；`verified=false`/退出码 2 为诊断或失败，不可通过最终验收。`next_step` 给出后续只读检查方向，不等于允许云端写入。
- `inspect_tls.py --certificate-file`：仅解码公开 PEM/DER，拒绝含私钥的输入；返回 `decoded=true, verified=false`，成功解码退出码 0，不表示信任验证通过。`--out` 把证据原子写入 Skill 外私有路径。
- `test_policy.py --report`：只能保存到本 Skill 目录外，真实路径及符号链接目标都会检查；非法路径在运行测试前以退出码 2 停止。正常测试通过返回 0，测试失败返回 1，报告写入失败返回 2；无 `--report` 时不写报告。
