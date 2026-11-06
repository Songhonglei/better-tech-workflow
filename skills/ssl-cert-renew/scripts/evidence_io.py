"""Private, atomic JSON evidence outside the installed Skill directory."""
import json
import os
from pathlib import Path
import tempfile


def external_path(path):
    result = Path(path).expanduser().resolve()
    if result.is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("运行证据必须保存到 Skill 目录外")
    return result


def write_json(path, payload):
    destination = external_path(path)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         prefix=".ssl-evidence-", delete=False) as file:
            temporary = Path(file.name)
            file.write(json.dumps(payload, ensure_ascii=False, indent=2)+"\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
