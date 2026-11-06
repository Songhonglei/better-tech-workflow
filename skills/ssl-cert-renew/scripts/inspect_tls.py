#!/usr/bin/env python3
"""Read a public TLS certificate via SNI. No application requests or cloud writes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys

from policy import domain_name
from evidence_io import write_json


def connect(domain, context):
    with socket.create_connection((domain, 443), timeout=10) as connection:
        with context.wrap_socket(connection, server_hostname=domain) as tls:
            return tls.getpeercert(binary_form=True)


def decode_certificate(der):
    """Decode the certificate's own UTC validity, SANs and identity; never UI dates."""
    process = subprocess.run(
        ["openssl", "x509", "-inform", "DER", "-noout", "-serial", "-dates", "-ext", "subjectAltName"],
        input=der, capture_output=True, timeout=10, check=True)
    metadata = process.stdout.decode("utf-8", errors="strict").strip()
    fields = dict(line.split("=", 1) for line in metadata.splitlines() if "=" in line)
    serial = fields.get("serial", "")
    if not re.fullmatch(r"[0-9A-Fa-f]+", serial):
        raise ValueError("证书序列号缺失或无效")
    def utc_date(key):
        return datetime.fromtimestamp(ssl.cert_time_to_seconds(fields[key]), timezone.utc).isoformat()
    sans = []
    for raw in re.findall(r"DNS:([^,\s]+)", metadata):
        value = "*." + domain_name(raw[2:]) if raw.startswith("*.") else domain_name(raw)
        if value not in sans:
            sans.append(value)
    if not sans:
        raise ValueError("证书缺少 DNS SAN")
    return {"fingerprint_sha256": hashlib.sha256(der).hexdigest(), "serial_number": serial.upper().lstrip("0") or "0",
            "not_before": utc_date("notBefore"), "not_after": utc_date("notAfter"),
            "sans": sans, "certificate_metadata": metadata}


def inspect(domain):
    domain = domain_name(domain)
    result = {"domain": domain, "observed_at": datetime.now(timezone.utc).isoformat(),
              "writes_performed": False, "verified": False}
    try:
        der = connect(domain, ssl.create_default_context())
        result["verified"] = True
    except ssl.SSLCertVerificationError as exc:
        result["verification_error"] = str(exc)
        # Diagnostic only: an expired/mismatched certificate is still public data.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        der = connect(domain, context)
    result.update(decode_certificate(der))
    result["note"] = "单次公网观测；需与控制台绑定及其他实际流量入口核对"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("domain", nargs="?")
    parser.add_argument("--certificate-file", type=Path, help="Only a public PEM/DER certificate; never a private key")
    parser.add_argument("--out", type=Path, help="Private JSON evidence path outside this Skill")
    args = parser.parse_args()
    if bool(args.domain) == bool(args.certificate_file):
        parser.error("提供域名或 --certificate-file，二选一")
    try:
        if args.certificate_file:
            content = args.certificate_file.read_bytes()
            if len(content) > 1048576 or b"PRIVATE KEY" in content:
                raise ValueError("只接受公开证书（最大 1 MiB），不读取私钥")
            if b"BEGIN CERTIFICATE" in content:
                chain = re.findall(rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", content, re.S)
                if not chain:
                    raise ValueError("公开 PEM 证书格式错误")
                der = ssl.PEM_cert_to_DER_cert(chain[0].decode("ascii"))
            else:
                der = content
            result = {**decode_certificate(der), "source": "public_certificate_file", "verified": False,
                      "decoded": True, "observed_at": datetime.now(timezone.utc).isoformat(), "writes_performed": False}
        else:
            result = inspect(args.domain)
    except (OSError, ssl.SSLError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        result = {"domain": args.domain, "verified": False, "writes_performed": False, "error": str(exc),
                  "next_step": "检查域名解析、443 连通性及 OpenSSL 3+；先只读核对控制台，不能据此通过公网验收"}
    if result.get("decoded"):
        result["next_step"] = "公开证书已解码；文件解码不验证信任，需与公网受信任握手的指纹核对"
    elif not result.get("verified") and "next_step" not in result:
        result["next_step"] = "证书验证未通过；用公开指纹或序列号核对当前控制台绑定，最终验收仍须信任验证通过"
    try:
        if args.out:
            write_json(args.out, result)
    except (OSError, ValueError) as exc:
        result = {"verified": False, "error": "证据未保存：" + str(exc), "writes_performed": False}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("verified") or result.get("decoded") else 2


if __name__ == "__main__":
    sys.exit(main())
