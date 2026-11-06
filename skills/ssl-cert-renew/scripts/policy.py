#!/usr/bin/env python3
"""Offline gates only: no network or cloud writes; results do not grant consent."""
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import ipaddress
import json
import re
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def domain_name(value):
    require(isinstance(value, str) and value and value == value.strip(), "域名为空或含空白")
    require(not value.endswith(".."), "域名格式错误")
    name = value.removesuffix(".").encode("idna").decode("ascii").lower()
    try:
        ipaddress.ip_address(name)
    except ValueError:
        pass
    else:
        raise ValueError("不支持 IP")
    labels = name.split(".")
    require(len(name) <= 253 and len(labels) >= 2 and
            all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", x) for x in labels),
            "需单个完整域名，不支持 URL、端口、通配符或列表")
    return name


def moment(value):
    require(isinstance(value, str), "缺少精确时间")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(result.tzinfo is not None, "时间缺少时区")
    return result.astimezone(timezone.utc)


def zero_price(section):
    require(section.get("currency") == "CNY", "币种不明或不是 CNY")
    value = section.get("payable")
    require(isinstance(value, str) and re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", value),
            "最终应付金额缺失或格式不明确")
    require(Decimal(value) == 0, "应付金额非 0 元，已中断")


def resource_match(actual, expected):
    require(isinstance(expected, dict) and expected.get("type") == "OSS", "一期只支持 OSS")
    for key in ("type", "id", "bucket", "region"):
        require(isinstance(expected.get(key), str) and expected[key].strip(), "缺少 OSS 资源标识")
        require(isinstance(actual, dict) and actual.get(key) == expected[key], "OSS 资源不匹配")


def san_matches(name, san):
    if isinstance(san, str) and san.startswith("*."):
        suffix = domain_name(san[2:])
        return name.endswith("." + suffix) and len(name.split(".")) == len(suffix.split(".")) + 1
    return domain_name(san) == name


def check_new(new, current, account, name, threshold, now):
    """Validate a signed candidate for preparation/reuse and final deployment."""
    require(new.get("account_id") == account, "新证书账号不匹配")
    require(new.get("product") == "aliyun-personal-free", "新证书不是个人免费版")
    require(new.get("status") == "issued", "新证书未签发")
    require(isinstance(new.get("id"), str) and new["id"].strip() and new["id"] != current["id"], "新旧证书 ID 无效或相同")
    require(isinstance(new.get("sans"), list) and name in [domain_name(s) for s in new["sans"]], "新证书 SAN 不含精确域名")
    start, end = moment(new.get("not_before")), moment(new.get("not_after"))
    require(start <= now < end, "新证书未生效或过期")
    require(abs((end-start).total_seconds()-90*86400) <= 3600, "新证书完整期限与 90 天免费版不符，请核对产品及签发起止时间")
    require(end > moment(current["not_after"]) and (end-now).total_seconds() > threshold*86400, "新证书有效期不足以续期")


def evaluate(data, stage="preflight", now=None):
    now = now or datetime.now(timezone.utc)
    result = {"stage": stage, "decision": "blocked", "writes_performed": False}
    try:
        require(stage in ("preflight", "order", "deploy"), "未知阶段")
        require(isinstance(data, dict), "输入必须为 JSON 对象")
        name = domain_name(data.get("domain"))
        threshold = data.get("threshold_days", 15)
        require(type(threshold) is int and 0 <= threshold < 90, "阈值必须是 0–89 整数，小于证书期限")
        result.update(domain=name, threshold_days=threshold)
        age = (now - moment(data.get("observed_at"))).total_seconds()
        require(0 <= age <= 600, "证据过旧或时间在未来，请重新核对")
        account = data.get("account_id")
        require(isinstance(account, str) and account.strip(), "缺少账号")
        observed = data["observed_target"]
        require(observed.get("account_id") == account, "当前账号不匹配")
        require(domain_name(observed.get("domain")) == name, "当前资源域名不匹配")
        resource_match(observed.get("resource"), data.get("resource"))
        current = data["current"]
        require(current.get("source") == "console_deployed" and
                isinstance(current.get("id"), str) and current["id"].strip(), "当前绑定证书未知")
        sans = current.get("sans")
        require(isinstance(sans, list) and bool(sans) and any(san_matches(name, s) for s in sans),
                "原证书不覆盖域名")
        old_end = moment(current.get("not_after"))
        remaining = (old_end - now).total_seconds()
        result.update(not_after=old_end.isoformat(), remaining_seconds=remaining,
                      remaining_days=round(remaining / 86400, 8))
        if remaining > threshold * 86400:
            return {**result, "decision": "skip", "reason": "原证书剩余有效期大于阈值，无需续期"}
        require(data.get("online_matches_current") is True, "公网与控制台绑定未确认一致")
        if stage == "order":
            order = data["order"]
            require(order.get("product") == "aliyun-personal-free", "只允许阿里云个人免费版")
            require(type(order.get("validity_days")) is int and order["validity_days"] == 90,
                    "购买期限不是 90 天")
            require(type(order.get("quantity")) is int and order["quantity"] == 1, "只允许单张")
            require(order.get("paid_addons") is False, "付费附加项未明确关闭")
            zero_price(order)
            require(order.get("quota_available") is True, "免费额度不足或未知")
            require(order.get("existing_work") == "none", "存在可复用或未知工作，先查询恢复")
        if stage == "deploy":
            new = data["new_certificate"]
            check_new(new,current,account,name,threshold,now)
            preview = data["preview"]
            require(preview.get("account_id") == account, "预览账号不匹配")
            require(domain_name(preview.get("domain")) == name, "预览域名不匹配")
            resource_match(preview.get("resource"), data.get("resource"))
            require(preview.get("old_certificate_id") == current["id"] and
                    preview.get("new_certificate_id") == new["id"], "预览新旧证书不匹配")
            for key in ("resource_count", "domain_count"):
                require(type(preview.get(key)) is int and preview[key] == 1, "预览目标数不是一")
            zero_price(preview)
            require(type(preview.get("paid_deployment_units")) is int and
                    preview["paid_deployment_units"] == 0, "部署消耗付费次数或次数未知")
            require(preview.get("schedule") == "immediate", "一期只支持立即部署")
        return {**result, "decision": "eligible", "reason": "本阶段规则通过；真实操作仍需对应授权"}
    except KeyError as exc:
        return {**result, "reason": "缺少必填字段：" + str(exc.args[0]),
                "next_step": "只读补查该字段后重建快照；未知值不要猜测，不执行云端写入"}
    except (TypeError, AttributeError) as exc:
        return {**result, "reason": "快照结构错误：" + str(exc),
                "next_step": "按 policy-input.md 检查字段类型并重新观测，不执行云端写入"}
    except (ValueError, UnicodeError, OverflowError) as exc:
        return {**result, "reason": str(exc),
                "next_step": "核对提示对应的真实页面或证书字段；满足条件并获授权前不写入"}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "JSON 含重复键：" + key)
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("JSON 不允许 " + value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("preflight", "order", "deploy"))
    parser.add_argument("snapshot")
    args = parser.parse_args()
    try:
        with open(args.snapshot, encoding="utf-8") as file:
            data = json.load(file, object_pairs_hook=unique_object, parse_constant=reject_constant)
        result = evaluate(data, args.stage)
    except (OSError, ValueError, RecursionError) as exc:
        result = {"stage": args.stage, "decision": "blocked", "writes_performed": False, "reason": str(exc),
                  "next_step": "检查快照路径、读取权限及 JSON 格式，修正后重新检查"}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result["decision"] == "blocked" else 0


if __name__ == "__main__":
    sys.exit(main())
