#!/usr/bin/env python3
"""Join fresh console binding, decoded public cert and live TLS evidence, then gate."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import ssl
import subprocess
import sys

from evidence_io import write_json
from policy import domain_name, evaluate, moment, require, unique_object, reject_constant, san_matches
from inspect_tls import decode_certificate


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=unique_object, parse_constant=reject_constant)


def build(binding, controlplane, tls, expected, threshold=15, now=None):
    now = now or datetime.now(timezone.utc)
    require(type(threshold) is int and 0 <= threshold < 90, "阈值必须是 0–89 整数，小于证书期限")
    for name, evidence in (("binding", binding), ("controlplane", controlplane)):
        require(0 <= (now-moment(evidence.get("observed_at"))).total_seconds() <= 600,
                name+" 证据过旧或时间无效，请重新只读采集")
    pem=controlplane.get("public_certificate")
    require(isinstance(pem,str) and pem.startswith("-----BEGIN CERTIFICATE-----") and
            "PRIVATE KEY" not in pem, "控制台证据缺少公开 X.509 证书")
    decoded=decode_certificate(ssl.PEM_cert_to_DER_cert(pem))
    require(controlplane["serial_number"].upper().lstrip("0") == decoded["serial_number"], "控制台元数据与签名证书序列号不符")
    provider_times={field:controlplane.get("provider_"+field,controlplane.get(field)) for field in ("not_before","not_after")}
    time_discrepancy=any(provider_times[field] is not None and moment(provider_times[field]) != moment(decoded[field]) for field in provider_times)
    controlplane={**controlplane,**decoded}
    domain = domain_name(expected["domain"])
    require(binding["account_id"] == expected["account_id"], "观测账号不匹配")
    require(domain_name(binding["domain"]) == domain, "观测域名不匹配")
    for key in ("bucket", "region"):
        require(binding[key] == expected[key], "观测 OSS "+key+" 不匹配")
    require(binding.get("bound") is True and binding.get("cdn_configured") is False, "域名未绑定或前置入口不明确")
    require(binding["certificate_id"] == controlplane["certificate_id"], "控制台公开证书 ID 不匹配")
    require(any(san_matches(domain,x) for x in controlplane["sans"]), "公开证书 SAN 不覆盖域名")
    fingerprint = controlplane.get("fingerprint_sha256")
    require(isinstance(fingerprint, str) and re.fullmatch(r"[0-9a-f]{64}", fingerprint), "缺少公开证书 SHA-256 指纹")
    resource = {"type":"OSS", "bucket":binding["bucket"], "region":binding["region"],
                "id":"oss://"+binding["region"]+"/"+binding["bucket"]+"/"+domain}
    # This canonical binding key is not a CAS deployment resource ID.
    snapshot = {"domain":domain, "threshold_days":threshold, "account_id":binding["account_id"],
        "observed_at":min(moment(x["observed_at"]) for x in (binding,controlplane)).isoformat(),
        "resource":resource, "observed_target":{"account_id":binding["account_id"],"domain":domain,"resource":dict(resource)},
        "current":{"source":"console_deployed","id":binding["certificate_id"],"sans":controlplane["sans"],
                   "not_before":controlplane["not_before"],"not_after":controlplane["not_after"],"fingerprint_sha256":fingerprint},
        "online_matches_current":False,
        "evidence_identity":{"method":"bound-public-certificate-only"},
        "time_evidence":{"authority":"X509-notBefore-notAfter","provider_metadata":provider_times,
                         "provider_time_discrepancy":time_discrepancy}}
    if evaluate(snapshot, now=now)["decision"] == "skip":
        return snapshot  # No network or TLS evidence is needed when renewal must stop.
    require(isinstance(tls,dict), "原证书进入续期阈值，须补采公网 TLS 证据后再检查")
    require(0 <= (now-moment(tls.get("observed_at"))).total_seconds() <= 600,
            "tls 证据过旧或时间无效，请重新只读采集")
    require(domain_name(tls["domain"]) == domain, "观测域名不匹配")
    require(fingerprint == tls.get("fingerprint_sha256"), "公网证书与当前绑定公开证书指纹不同")
    for field in ("not_before", "not_after"):
        require(moment(controlplane[field]) == moment(tls[field]), "证书时间不一致："+field)
    require(controlplane["serial_number"].upper().lstrip("0") == tls["serial_number"].upper().lstrip("0"), "证书序列号不一致")
    require(tls.get("verified") is True or moment(tls["not_after"]) <= now,
            "公网证书信任未通过且并非已过期，请先排查")
    snapshot.update(observed_at=min(moment(snapshot["observed_at"]),moment(tls["observed_at"])).isoformat(),
                    online_matches_current=True,
                    evidence_identity={"method":"public-certificate-sha256","serial_number":tls["serial_number"]})
    return snapshot


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("binding", "controlplane", "expected", "out"):
        parser.add_argument("--"+name,required=True,type=Path)
    parser.add_argument("--tls",type=Path,help="进入续期阈值时必需；超过阈值可省略")
    parser.add_argument("--threshold-days",type=int,default=15)
    args=parser.parse_args()
    try:
        snapshot=build(read_json(args.binding),read_json(args.controlplane),read_json(args.tls) if args.tls else None,read_json(args.expected),args.threshold_days)
        result=evaluate(snapshot)
        write_json(args.out,snapshot)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as exc:
        result={"decision":"blocked","writes_performed":False,"reason":str(exc),
                "next_step":"重新采集缺失或不一致的只读证据；不得手填猜测值来通过检查"}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 2 if result["decision"]=="blocked" else 0


if __name__=="__main__":
    sys.exit(main())
