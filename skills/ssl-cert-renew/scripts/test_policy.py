#!/usr/bin/env python3
"""Offline behavioral simulations. No cloud credentials, browser, or network."""
import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import inspect_tls
from policy import domain_name, evaluate, unique_object, reject_constant

NOW = datetime(2026, 11, 6, 4, tzinfo=timezone.utc)
TLS_METADATA = (b"serial=FA01\nnotBefore=Sep  1 00:00:00 2026 GMT\n"
                b"notAfter=Nov 29 23:59:59 2026 GMT\nX509v3 Subject Alternative Name:\n DNS:example.com")


def fixture():
    resource = {"type": "OSS", "id": "fixture-resource", "bucket": "fixture-bucket", "region": "cn-hangzhou"}
    return {
        "domain": "example.com", "account_id": "fixture-account", "observed_at": NOW.isoformat(),
        "resource": resource,
        "observed_target": {"account_id": "fixture-account", "domain": "example.com", "resource": deepcopy(resource)},
        "current": {"source": "console_deployed", "id": "fixture-old", "sans": ["example.com"],
                    "not_after": (NOW + timedelta(days=10)).isoformat()},
        "online_matches_current": True,
        "order": {"product": "aliyun-personal-free", "validity_days": 90, "quantity": 1,
                  "currency": "CNY", "payable": "0.00", "paid_addons": False,
                  "quota_available": True, "existing_work": "none"},
        "new_certificate": {"id": "fixture-new", "account_id": "fixture-account", "product": "aliyun-personal-free",
                            "status": "issued", "sans": ["example.com"],
                            "not_before": (NOW - timedelta(hours=1)).isoformat(),
                            "not_after": (NOW + timedelta(days=89, hours=23)).isoformat()},
        "preview": {"account_id": "fixture-account", "domain": "example.com", "resource": deepcopy(resource),
                    "old_certificate_id": "fixture-old", "new_certificate_id": "fixture-new",
                    "resource_count": 1, "domain_count": 1, "currency": "CNY", "payable": "0.00",
                    "paid_deployment_units": 0, "schedule": "immediate"}}


def scenarios():
    cases = []

    def add(name, stage, expected, changes=()):
        data = fixture()
        for path, value in changes:
            node = data
            keys = path.split(".")
            for key in keys[:-1]:
                node = node[key]
            node[keys[-1]] = value
        cases.append((name, stage, expected, data))

    for stage in ("preflight", "order", "deploy"):
        add("正常十天/" + stage, stage, "eligible")
        add("十五天多一秒立即跳过/" + stage, stage, "skip", [
            ("current.not_after", (NOW + timedelta(days=15, seconds=1)).isoformat()),
            ("order.payable", "100.00"), ("new_certificate.status", "pending")])
    for seconds, expected in ((15*86400, "eligible"), (15*86400-1, "eligible"), (-1, "eligible")):
        add("阈值边界/" + str(seconds), "preflight", expected,
            [("current.not_after", (NOW + timedelta(seconds=seconds)).isoformat())])
    add("自定义七天跳过", "preflight", "skip", [("threshold_days", 7)])
    add("自定义十天相等", "preflight", "eligible", [("threshold_days", 10)])
    add("零天阈值未到期", "preflight", "skip", [("threshold_days", 0)])
    for value in (-1, 90, True, "15", 1.5, None):
        add("无效阈值/" + repr(value), "preflight", "blocked", [("threshold_days", value)])
    for value in ("2026-11-16", "2026-11-16T04:00:00", None, "wrong"):
        add("期限不明/" + repr(value), "preflight", "blocked", [("current.not_after", value)])
    for path, value in (("observed_target.account_id", "other"), ("observed_target.domain", "www.example.com"),
                        ("observed_target.resource.id", "other"), ("current.source", "list"),
                        ("current.sans", ["other.com"]), ("online_matches_current", False),
                        ("online_matches_current", "true"), ("resource.type", "CDN"),
                        ("observed_at", (NOW-timedelta(seconds=601)).isoformat()),
                        ("observed_at", (NOW+timedelta(seconds=1)).isoformat())):
        add("原证据阻断/" + path + repr(value), "preflight", "blocked", [(path, value)])
    for value in ("0.01", "30.00", "-0.00", "NaN", "1e-999", "0元", "", None, False, 0):
        add("金额阻断/" + repr(value), "order", "blocked", [("order.payable", value)])
    for value in ("0", "0.0", "0.00"):
        add("纯零元/" + value, "order", "eligible", [("order.payable", value)])
    for path, value in (("product", "aliyun-personal-pro"), ("validity_days", 180),
                        ("quantity", 2), ("quantity", True), ("currency", "USD"),
                        ("paid_addons", True), ("quota_available", False),
                        ("existing_work", "pending"), ("existing_work", "unknown"),
                        ("existing_work", "issued"), ("existing_work", "unused-quota")):
        add("购买阻断/" + path + repr(value), "order", "blocked", [("order."+path, value)])
    for path, value in (("new_certificate.account_id", "other"), ("new_certificate.status", "pending"),
                        ("new_certificate.product", "uploaded"), ("new_certificate.id", "fixture-old"),
                        ("new_certificate.sans", ["www.example.com"]),
                        ("new_certificate.sans", ["*.example.com"]),
                        ("new_certificate.not_before", (NOW+timedelta(seconds=1)).isoformat()),
                        ("new_certificate.not_after", NOW.isoformat()),
                        ("new_certificate.not_after", (NOW+timedelta(days=14)).isoformat()),
                        ("preview.account_id", "other"), ("preview.domain", "www.example.com"),
                        ("preview.resource.id", "other"), ("preview.old_certificate_id", "stale-old"),
                        ("preview.new_certificate_id", "other"), ("preview.resource_count", 2),
                        ("preview.domain_count", True), ("preview.payable", "30.00"),
                        ("preview.paid_deployment_units", 1), ("preview.schedule", "tomorrow")):
        add("部署阻断/" + path, "deploy", "blocked", [(path, value)])
    for days in (89, 91, 365):
        add("免费版完整期限异常/" + str(days), "deploy", "blocked", [
            ("new_certificate.not_before", NOW.isoformat()),
            ("new_certificate.not_after", (NOW+timedelta(days=days)).isoformat())])
    for seconds in (-3600, 3600):
        add("完整期限容差边界/" + str(seconds), "deploy", "eligible", [
            ("new_certificate.not_before", NOW.isoformat()),
            ("new_certificate.not_after", (NOW+timedelta(days=90,seconds=seconds)).isoformat())])
    reused = fixture()
    del reused["order"]
    cases.append(("复用已签发不需新购", "deploy", "eligible", reused))
    for key in ("domain", "account_id", "resource", "observed_at", "current", "observed_target"):
        data = fixture()
        del data[key]
        cases.append(("缺字段/" + key, "preflight", "blocked", data))
    return cases


class PolicyTests(unittest.TestCase):
    def test_scenarios(self):
        for name, stage, expected, data in scenarios():
            with self.subTest(name=name):
                result = evaluate(data, stage, NOW)
                self.assertEqual(result["decision"], expected, result)
                self.assertFalse(result["writes_performed"])

    def test_domains(self):
        self.assertEqual(domain_name("EXAMPLE.com."), "example.com")
        self.assertTrue(domain_name("例子.中国").startswith("xn--"))
        for value in ("https://example.com", "example.com/path", "example.com:443", "*.example.com",
                      "127.0.0.1", "example.com,other.com", " example.com", "localhost", "example.com.."):
            with self.subTest(value=value), self.assertRaises(ValueError):
                domain_name(value)

    def test_old_wildcard_does_not_cover_apex_or_multiple_levels(self):
        for name, expected in (("www.example.com", "eligible"), ("example.com", "blocked"),
                               ("a.b.example.com", "blocked")):
            data = fixture()
            data["domain"] = data["observed_target"]["domain"] = name
            data["current"]["sans"] = ["*.example.com"]
            self.assertEqual(evaluate(data, now=NOW)["decision"], expected)

    def test_equivalent_timezone(self):
        data = fixture()
        data["current"]["not_after"] = "2026-11-21T12:00:00+08:00"
        result = evaluate(data, now=NOW)
        self.assertEqual(result["remaining_seconds"], 15*86400)
        self.assertEqual(result["decision"], "eligible")

    def test_strict_json(self):
        for value in ('{"domain":"a.com","domain":"b.com"}', '{"payable":NaN}'):
            with self.assertRaises(ValueError):
                json.loads(value, object_pairs_hook=unique_object, parse_constant=reject_constant)

    def test_missing_field_has_recovery_step(self):
        data = fixture()
        del data["current"]
        result = evaluate(data, now=NOW)
        self.assertEqual(result["decision"], "blocked")
        self.assertIn("current", result["reason"])
        self.assertIn("只读", result["next_step"])

    def test_cli_outputs_and_exit_codes(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "input.json"
            for value, expected, code in (({}, "blocked", 2), (fixture(), "eligible", 0)):
                if value:
                    value["observed_at"] = datetime.now(timezone.utc).isoformat()
                    value["current"]["not_after"] = (datetime.now(timezone.utc)+timedelta(days=10)).isoformat()
                file.write_text(json.dumps(value), encoding="utf-8")
                process = subprocess.run([sys.executable, str(Path(__file__).with_name("policy.py")),
                                          "preflight", str(file)], capture_output=True, text=True, timeout=10)
                self.assertEqual(process.returncode, code, process.stderr)
                self.assertEqual(json.loads(process.stdout)["decision"], expected)

    def test_tls_verification_failure_stays_unverified(self):
        decoded = subprocess.CompletedProcess([], 0, TLS_METADATA, b"")
        with patch.object(inspect_tls, "connect", side_effect=[
                inspect_tls.ssl.SSLCertVerificationError("expired fixture"), b"public-fixture"]), \
                patch.object(inspect_tls.subprocess, "run", return_value=decoded):
            result = inspect_tls.inspect("example.com")
        self.assertFalse(result["verified"])
        self.assertIn("verification_error", result)
        self.assertFalse(result["writes_performed"])

    def test_tls_trust_success(self):
        decoded = subprocess.CompletedProcess([], 0, TLS_METADATA, b"")
        with patch.object(inspect_tls, "connect", return_value=b"public-fixture"), \
                patch.object(inspect_tls.subprocess, "run", return_value=decoded):
            result = inspect_tls.inspect("example.com")
        self.assertTrue(result["verified"])
        self.assertEqual(len(result["fingerprint_sha256"]), 64)

    def test_real_certificate_decoder_offline(self):
        # Temporary self-signed fixture; no browser or external TLS connection.
        with tempfile.TemporaryDirectory() as directory:
            cert = Path(directory) / "public.der"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-noenc",
                            "-keyout", str(Path(directory) / "temporary.key"), "-outform", "DER",
                            "-out", str(cert), "-days", "2", "-subj", "/CN=example.com",
                            "-addext", "subjectAltName=DNS:example.com"],
                           capture_output=True, check=True, timeout=30)
            with patch.object(inspect_tls, "connect", return_value=cert.read_bytes()):
                result = inspect_tls.inspect("example.com")
        self.assertIn("DNS:example.com", result["certificate_metadata"])
        self.assertIn("notAfter=", result["certificate_metadata"])
        self.assertIn("serial=", result["certificate_metadata"])

    def test_report_rejects_skill_and_symlink_targets_before_tests(self):
        # No file is opened/written; resolve() follows parent-directory symlinks.
        with self.assertRaises(ValueError):
            report_destination(Path(__file__).resolve().parents[1] / "SKILL.md")
        with tempfile.TemporaryDirectory() as directory:
            alias = Path(directory) / "skill-link"
            alias.symlink_to(Path(__file__).resolve().parents[1], target_is_directory=True)
            with self.assertRaises(ValueError):
                report_destination(alias / "result.json")
            self.assertEqual(report_destination(Path(directory)/"result.json"), (Path(directory)/"result.json").resolve())
            original = Path(directory) / "original.txt"
            original.write_text("keep original", encoding="utf-8")
            hardlink = Path(directory) / "report.json"
            os.link(original, hardlink)
            write_report(hardlink, {"offline": True})
            self.assertEqual(original.read_text(encoding="utf-8"), "keep original")
            self.assertEqual(json.loads(hardlink.read_text(encoding="utf-8")), {"offline": True})
        with patch.object(sys, "argv", ["test_policy.py", "--report", str(Path(__file__).resolve())]), \
                patch.object(unittest.TextTestRunner, "run") as runner, patch("builtins.print"):
            self.assertEqual(main(), 2)
            runner.assert_not_called()

    def test_tls_decoder_failures_return_unverified_with_recovery_step(self):
        for error in (subprocess.TimeoutExpired("openssl", 10),
                      subprocess.CalledProcessError(1, "openssl"), FileNotFoundError("openssl missing")):
            with self.subTest(error=type(error).__name__), \
                    patch.object(sys, "argv", ["inspect_tls.py", "example.com"]), \
                    patch.object(inspect_tls, "connect", return_value=b"public-fixture"), \
                    patch.object(inspect_tls.subprocess, "run", side_effect=error), \
                    patch("builtins.print") as display:
                self.assertEqual(inspect_tls.main(), 2)
                result = json.loads(display.call_args.args[0])
                self.assertFalse(result["verified"])
                self.assertIn("next_step", result)

    def test_report_io_failure_returns_nonzero_without_traceback(self):
        fake_result = unittest.TestResult()
        with patch.object(sys, "argv", ["test_policy.py", "--report", "/nonexistent/report.json"]), \
                patch.object(unittest.TextTestRunner, "run", return_value=fake_result), \
                patch.object(Path, "mkdir", side_effect=PermissionError("fixture denied")), \
                patch("builtins.print") as display:
            self.assertEqual(main(), 2)
        self.assertIn("报告未保存", display.call_args.args[0])


def report_destination(path):
    """Resolve symlinks and reject reports inside this installed Skill."""
    destination = path.expanduser().resolve()
    if destination.is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("模拟报告须写到 Skill 目录外，请指定外部 --report 路径")
    return destination


def write_report(destination, payload):
    """Replace an external report atomically; never truncate a linked source file."""
    destination = report_destination(destination)
    temporary = None
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         prefix=".ssl-renew-report-", delete=False) as file:
            temporary = Path(file.name)
            file.write(json.dumps(payload, ensure_ascii=False, indent=2)+"\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        destination = report_destination(args.report) if args.report else None
    except (OSError, ValueError, RuntimeError) as exc:
        print("报告路径不可用：" + str(exc), file=sys.stderr)
        return 2
    tests = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PolicyTests))
    rows = [{"name": name, "expected": expected, "result": evaluate(data, stage, NOW)}
            for name, stage, expected, data in scenarios()]
    if destination:
        try:
            write_report(destination, {"kind": "offline-simulation", "synthetic_domains_only": True,
                "frozen_clock": NOW.isoformat(), "passed": tests.wasSuccessful(),
                "unit_tests": tests.testsRun, "scenario_count": len(rows),
                "cloud_writes_performed": False, "live_console_verified": False, "scenarios": rows})
        except OSError as exc:
            print("报告未保存：" + str(exc) + "；请换到可写的外部目录后重试", file=sys.stderr)
            return 2
    return 0 if tests.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
