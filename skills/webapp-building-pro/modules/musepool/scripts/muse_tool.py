#!/usr/bin/env python3
"""musepool 网关工具 —— 通过 agent_gw SDK 调 musepool_recall / musepool_fetch。

CLI(SKILL 里不出现 JSON):

  python3 muse_tool.py recall --axis 'gist=6@0.7:"..."' --axis 'color=4@0.5:"..."' \
                              [--temp 0.3] [--seed 42]
  python3 muse_tool.py fetch  --ids a,b --fields seed,reference --ref-dim color,motion [--output-dir DIR]
  python3 muse_tool.py fetch  --query "..." --count 2 --fields seed,reference --ref-dim algorithms,imagery

依赖:agent-gw >= 0.2.6 和 PyYAML。运行环境已预装;万一运行报缺依赖,
直接 pip 装一次再跑即可:pip install -U agent-gw / pip install pyyaml。
鉴权:脚本不碰凭证也不碰端点,全部交给 agent_gw SDK 从运行环境解析——
api_key: KIMI_API_KEY 环境变量 / ~/.kimi/agent-gw.json;
base_url: KIMI_BASE_URL / 配置文件 base_url / SDK 默认。两者成对来自同一环境;
本地开发要指非默认网关时,把 base_url 和对应的 api_key 一起写进 ~/.kimi/agent-gw.json,
不要用环境变量只覆盖其中一个(钥匙和锁必须来自同一套)。
输出:
  recall —— 完整 YAML 直接打到 stdout,不落盘,不需要可写目录。
  fetch  —— 完整 YAML 写到 <output-dir>/<时间戳>.yaml(默认 ./.musepool/;
            指定目录不可写时降级到 /tmp/musepool/),stdout 只打印文件绝对路径;
            文件末尾以原文追加带标签的 system-reminder(与过去 stdout 直出形态一致)。
fetch 结果文件由调用方用 read_file 等方式阅读——长字符串已做 block scalar + 折行处理,
不会产生触发行截断的超长单行。
"""
from __future__ import annotations
import warnings
warnings.filterwarnings("ignore")

import argparse
import datetime
import importlib.metadata as metadata
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

AXIS_MAX = 12       # 每轴召回条数硬上限(与网关 pkg/musepool AxisMax 对齐)
FETCH_ID_MAX = 8    # fetch 一次最多 id 数(与网关 FetchIDMax 对齐)
DEFAULT_TIMEOUT = 60.0
MIN_AGENT_GW_VERSION = (0, 2, 6)
MIN_AGENT_GW_VERSION_TEXT = "0.2.6"
DEFAULT_OUTPUT_DIR = "./.musepool"


# --- dependencies -----------------------------------------------------------


def _version_tuple(version: str) -> Tuple[int, int, int]:
    parts = [int(part) for part in re.findall(r"\d+", version)[:3]]
    parts.extend([0] * (3 - len(parts)))
    return tuple(parts[:3])


def _agent_gw_version() -> Optional[str]:
    for package_name in ("agent-gw", "agent_gw"):
        try:
            return metadata.version(package_name)
        except metadata.PackageNotFoundError:
            continue
    return None


def _ensure_sdk():
    """导入 agent_gw 并校验版本(运行时不隐式安装)。

    返回 (AgentGwClient, AgentGwError)。
    """
    try:
        from agent_gw import AgentGwClient, AgentGwError
    except ModuleNotFoundError as exc:
        raise SystemExit(
            f"Missing dependency: agent-gw >= {MIN_AGENT_GW_VERSION_TEXT}. "
            "Install it once with: pip install -U agent-gw"
        ) from exc
    version = _agent_gw_version()
    if not version or _version_tuple(version) < MIN_AGENT_GW_VERSION:
        found = version or "unknown"
        raise SystemExit(
            f"agent-gw >= {MIN_AGENT_GW_VERSION_TEXT} is required; found {found}. "
            "Upgrade it with: pip install -U agent-gw"
        )
    return AgentGwClient, AgentGwError


def _ensure_yaml():
    """导入 PyYAML 并返回 (yaml 模块, 自定义 Dumper)。

    自定义 Dumper:含换行符的字符串用 block scalar(`|`),可读性最好。
    """
    try:
        import yaml
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Missing dependency: PyYAML. Install it once with: pip install pyyaml"
        ) from exc

    class _Dumper(yaml.SafeDumper):
        pass

    def _str_representer(dumper, data):
        style = "|" if "\n" in data else None
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)

    _Dumper.add_representer(str, _str_representer)
    return yaml, _Dumper


# --- output -----------------------------------------------------------------


def _normalize_newlines(value: Any) -> Any:
    """网关部分长文段(如 reference)存的是字面 \\n 转义而非真换行;转成换行后
    才能走 block scalar,也避免落盘文件出现触发行截断的超长单行。只处理长字符串,
    短值(id/gist/参数)原样保留。"""
    if isinstance(value, str):
        if len(value) > 200 and "\\n" in value:
            return value.replace("\\n", "\n")
        return value
    if isinstance(value, dict):
        return {k: _normalize_newlines(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_newlines(v) for v in value]
    return value


def _fold_long_lines(text: str, width: int = 1500) -> str:
    """把超过 width 的行硬折行,续行保持原缩进再 +2。

    block scalar 的内容行、无空格的超长 token(压缩 CSS/JS、data URI)PyYAML 不会
    自动折行,会在文件里留下触发 read_file 行截断的超长单行。这里按字符硬折:
    文件面向模型阅读,折入的换行/缩进对阅读无害;block scalar 与流式串在 YAML
    层面也都合法(解析值会多出换行或空格,可接受)。
    """
    import textwrap

    lines = []
    for line in text.split("\n"):
        if len(line) <= width:
            lines.append(line)
            continue
        indent = line[: len(line) - len(line.lstrip())]
        lines.extend(textwrap.wrap(
            line, width=width,
            initial_indent=indent, subsequent_indent=indent + "  ",
            break_long_words=True, break_on_hyphens=False,
            replace_whitespace=False, drop_whitespace=False,
        ))
    return "\n".join(lines)


def _dump_yaml(raw: Any) -> str:
    """把网关返回 dump 成 YAML 文本。width=1500:普通短串保持一行;
    再统一硬折行,保证落盘文件没有超长单行。"""
    yaml, dumper = _ensure_yaml()
    dumped = yaml.dump(raw, Dumper=dumper, allow_unicode=True,
                       sort_keys=False, default_flow_style=False, width=1500)
    return _fold_long_lines(dumped)


def _writable_dir(preferred: str) -> Path:
    """优先用调用方指定目录;不可写时降级到系统临时目录 /tmp/musepool/。
    两级都失败则明确报错退出。"""
    candidates = [
        Path(preferred),
        Path(tempfile.gettempdir()) / "musepool",
    ]
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            # mkdir(exist_ok=True) 测不出"已存在但只读"的目录,做一次真实探测写
            with tempfile.NamedTemporaryFile(dir=candidate):
                pass
            return candidate
        except OSError:
            continue
    raise SystemExit(
        "muse_tool: 没有可写的输出目录,请用 --output-dir 显式指定一个可写目录"
    )


def write_output(output_dir: str, reminder: Optional[str], text: str) -> Path:
    """把结果写进 <output_dir>/<时间戳>.yaml(不可写时降级 /tmp/musepool/),返回绝对路径。

    reminder(fetch 的 system-reminder)以原文追加在 YAML 文档之后——带完整的
    <system-reminder> 标签,模型读到文件末尾时它与过去 stdout 直出的形态一致。
    因此文件尾部不再是 YAML;需要解析 YAML 时按 <system-reminder> 切开即可。
    """
    out_dir = _writable_dir(output_dir)
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    path = out_dir / f"{ts}.yaml"
    suffix = 1
    while path.exists():
        path = out_dir / f"{ts}-{suffix}.yaml"
        suffix += 1
    if reminder:
        text = text.rstrip("\n") + "\n\n" + reminder.strip("\n") + "\n"
    path.write_text(text, encoding="utf-8")
    return path.resolve()


# --- CLI params -------------------------------------------------------------


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def parse_axis(spec: str) -> Optional[Dict[str, Any]]:
    """解析 '<field>=<n>[@temp]:"<query>"'。对齐 curl 版 / 原 muse.mjs parseAxis。"""
    c = spec.find(":")
    if c < 0:
        return None
    head, q = spec[:c].strip(), spec[c + 1:].strip()
    if len(q) >= 2 and q[0] == q[-1] and q[0] in ('"', "'"):
        q = q[1:-1]  # 剥掉 SKILL 里给 query 加的外层引号(写法约定,非内容)
    e = head.find("=")
    if e < 0:
        return None
    field = head[:e].strip().lower()
    npart, temp_v = head[e + 1:].strip(), None
    at = npart.find("@")
    if at >= 0:
        try:
            temp_v = _clamp01(float(npart[at + 1:]))
        except ValueError:
            temp_v = 0.0
        npart = npart[:at].strip()
    try:
        n = max(1, min(AXIS_MAX, int(float(npart))))
    except ValueError:
        n = 1
    ax: Dict[str, Any] = {"field": field, "n": n, "query": q}
    if temp_v is not None:
        ax["temp"] = temp_v
    return ax


def build_recall_params(args: argparse.Namespace) -> Dict[str, Any]:
    axes = [ax for ax in (parse_axis(s) for s in args.axis) if ax]
    if not axes:
        sys.stderr.write('muse_tool: 至少一个 --axis <field>=<n>[@temp]:"<query>"\n')
        sys.exit(2)
    params: Dict[str, Any] = {"axes": axes}
    if args.filter:
        params["filters"] = args.filter
    if args.nots:
        params["nots"] = args.nots
    if args.temp is not None:
        try:
            params["temp"] = _clamp01(float(args.temp))
        except ValueError:
            pass
    if args.seed is not None:
        try:
            params["seed"] = int(args.seed)
        except ValueError:
            pass
    return params


def build_fetch_params(args: argparse.Namespace) -> Dict[str, Any]:
    params: Dict[str, Any] = {}
    if args.ids:
        ids = [x.strip() for x in args.ids.split(",") if x.strip()]
        if len(ids) > FETCH_ID_MAX:
            sys.stderr.write(
                f"muse_tool: --ids 共 {len(ids)} 个,超过上限 {FETCH_ID_MAX},多余 id 已丢弃\n"
            )
        params["ids"] = ids[:FETCH_ID_MAX]
    if args.query:
        params["query"] = args.query
    if args.count is not None:
        try:
            params["count"] = int(args.count)
        except ValueError:
            pass
    if args.fields:
        params["fields"] = [x.strip() for x in args.fields.split(",") if x.strip()]
    if args.ref_dim:
        params["ref_dim"] = [x.strip() for x in args.ref_dim.split(",") if x.strip()]
    if "ids" not in params and "query" not in params:
        sys.stderr.write("muse_tool: fetch 需要 --ids 或 --query\n")
        sys.exit(2)
    return params


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="musepool 网关工具(SDK 版)")
    sub = p.add_subparsers(dest="command", required=True)

    r = sub.add_parser("recall", help="多轴召回,返回浅摘要(YAML 直接打到 stdout)")
    r.add_argument("--axis", "--ax", action="append", default=[],
                   metavar='<field>=<n>[@temp]:"<query>"', help="可重复,每轴独立")
    r.add_argument("--filter", action="append", default=[], help="novelty>0.7 / modality=web")
    r.add_argument("--not", dest="nots", action="append", default=[], help="style=minimal / view=landing")
    r.add_argument("--temp", help="全局温度 0-1(默认 0.3)")
    r.add_argument("--seed", help="随机种子(可复现)")

    f = sub.add_parser("fetch", help="按 id 或 query 取深(结果落盘)")
    f.add_argument("--ids", "-i", help="逗号分隔的 short_id(最多 8)")
    f.add_argument("--query", "-q", help="按 gist 检索取深")
    f.add_argument("--count", "-n", help="query 模式条数 1-8(默认 1)")
    f.add_argument("--fields", help="gist/seed/reference/tags,默认 seed")
    f.add_argument("--ref-dim", dest="ref_dim", help="只取某几维 reference(逗号分隔)")
    f.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR,
                   help=f"结果 YAML 落盘目录(默认 {DEFAULT_OUTPUT_DIR},不可写时降级 /tmp/musepool/)")
    return p


SLOP_REMINDER = """
<system-reminder>
The risk is not borrowing too little — it is subconsciously simplifying what you borrowed. Cutting corners is forbidden in any form: never replace a reference's technique, material, structure, or motion with a cheaper version of your own. Downgrades follow repeatable patterns (illustrative, not exhaustive): input-driven motion (scroll/pointer/time) → one-shot keyframes or static states; shape-language transformation (morph/clip/mask) → the cheapest properties (scale/translate/opacity); asymmetric layout rhythm (irregular grids, editorial composition) → uniform columns and full-width stacks; layered material (blend/texture/depth) → flat single-layer fills; bespoke vessels (framing devices, illustrated components) → default cards and pills; choreographed sequences (staged, multi-step, gated) → single triggers or fakes; typographic systems (pairing/scale/font features) → swapping the font-family; styled components → library-default skins. If your version is simpler than the reference's, that is a downgrade. Implement at the reference's fidelity.
</system-reminder>
"""


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "recall":
        method, params = "musepool_recall", build_recall_params(args)
    else:
        method, params = "musepool_fetch", build_fetch_params(args)

    agent_gw_client, agent_gw_error = _ensure_sdk()
    try:
        with agent_gw_client(timeout=DEFAULT_TIMEOUT) as client:
            resp = client.tools.invoke(method, params)
    except agent_gw_error as exc:
        sys.stderr.write(f"muse_tool: 网关调用失败: {exc}\n")
        return 1

    # musepool 返回裸 JSON({"results",...}/{"items",...}),直接取 resp.raw;
    # 万一网关某天改走 {is_success,...} 信封且失败,这里兜底报错。
    raw = resp.raw
    if isinstance(raw, dict) and raw.get("is_success") is False:
        sys.stderr.write(f"muse_tool: 网关错误: {raw.get('error')}\n")
        return 1
    text = _dump_yaml(_normalize_newlines(raw))

    if args.command == "recall":
        # recall 结果短:直出 stdout,不落盘,不需要可写目录。
        print(text)
        return 0

    # fetch:落盘 + stdout 只打印结果文件绝对路径,文件末尾追加 system-reminder。
    path = write_output(args.output_dir, SLOP_REMINDER, text)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
