"""Behavioral checks with isolated config/output; no network or paid service calls."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "webapp.py"
spec = importlib.util.spec_from_file_location("webapp", SCRIPT)
webapp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(webapp)


class Templates(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="webapp-pro-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("WEBAPP_BUILDING_PRO_") and k != "PROJECT_PATH"}
        self.env["WEBAPP_BUILDING_PRO_CONFIG"] = str(self.root / "config.json")

    def run_cli(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.root,
                                env=self.env, capture_output=True, text=True, timeout=20)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def template(self, root, name="my-template", wrapper="different-wrapper", body="custom"):
        folder = root / name
        folder.mkdir(parents=True)
        (folder / "info.md").write_text("# Custom template\n", encoding="utf-8")
        prefix = f"{wrapper}/" if wrapper else ""
        with zipfile.ZipFile(folder / f"{name}.zip", "w") as z:
            z.writestr(prefix + "index.html", "<title>old</title>" + body)
            z.writestr(prefix + ".gitignore", "node_modules\n")
        return folder

    def test_builtin_catalog(self):
        rows = json.loads(self.run_cli("list", "--json").stdout)
        self.assertEqual(len(rows), 6)
        self.assertTrue(all(row["valid"] and row["builtin"] for row in rows))

    def test_all_builtin_archives_generate(self):
        for folder in webapp.BUILTINS.iterdir():
            if folder.is_dir():
                with self.subTest(template=folder.name):
                    output = self.root / folder.name
                    self.run_cli("init", "新标题 & </title><script>", "--template", folder.name,
                                 "--output", str(output), "--no-install")
                    self.assertTrue((output / "index.html").exists())
                    self.assertTrue((output / "package.json").exists())
                    self.assertTrue((output / "info.md").exists())
                    self.assertIn("新标题 &amp; &lt;/title&gt;&lt;script&gt;",
                                  (output / "index.html").read_text())

    def test_config_survives_repeated_add_and_remove(self):
        directory = self.root / "extra with spaces"
        self.template(directory)
        self.run_cli("config", "--add", str(directory))
        self.run_cli("config", "--add", str(directory))
        cfg = json.loads(self.run_cli("config").stdout)
        self.assertEqual(cfg["template_dirs"], [str(directory)])
        rows = json.loads(self.run_cli("list", "--json").stdout)
        self.assertIn("my-template", [r["name"] for r in rows])
        self.run_cli("config", "--remove", str(directory))
        self.assertEqual(json.loads(self.run_cli("config").stdout)["template_dirs"], [])

    def test_cli_env_config_builtin_precedence(self):
        dirs = [self.root / n for n in ("cli", "env", "cfg")]
        for directory in dirs:
            self.template(directory, "0-origin", body=directory.name)
        self.run_cli("config", "--add", str(dirs[2]))
        self.env["WEBAPP_BUILDING_PRO_TEMPLATE_DIRS"] = str(dirs[1])
        rows = json.loads(self.run_cli("list", "--templates-dir", str(dirs[0]), "--json").stdout)
        row = next(r for r in rows if r["name"] == "0-origin")
        self.assertEqual(Path(row["source"]).parent, dirs[0])
        self.assertEqual(len(row["shadowed"]), 3)
        output = self.root / "result"
        self.run_cli("init", "title", "--template=0-origin", "--templates-dir", str(dirs[0]),
                     "--output", str(output), "--no-install")
        self.assertIn("cli", (output / "index.html").read_text())

    def test_config_relative_to_config_location(self):
        self.template(self.root / "custom")
        (self.root / "config.json").write_text(json.dumps({"template_dirs": ["custom"]}))
        rows = json.loads(self.run_cli("list", "--json").stdout)
        self.assertEqual(Path(rows[0]["source"]).parent, self.root / "custom")

    def test_flat_and_arbitrary_wrapper(self):
        for name, wrapper in [("flat", ""), ("wrapped", "unrelated-name")]:
            self.template(self.root / "templates", name, wrapper=wrapper)
            output = self.root / name
            self.run_cli("init", "title", "--template", name, "--templates-dir",
                         str(self.root / "templates"), "--output", str(output), "--no-install")
            self.assertTrue((output / ".gitignore").exists())
            self.assertFalse((output / "unrelated-name").exists())

    def test_existing_output_is_preserved(self):
        target = self.root / "existing"
        target.mkdir()
        (target / "keep.txt").write_text("original")
        self.run_cli("init", "title", "--html", "--output", str(target), ok=False)
        self.assertEqual(list(target.iterdir()), [target / "keep.txt"])
        self.assertEqual((target / "keep.txt").read_text(), "original")

    def test_modes_and_html_escaping(self):
        self.run_cli("init", "title", "--template", "0-origin", "--html", ok=False)
        self.run_cli("init", "title", "--html", "--three", ok=False)
        self.run_cli("init", "title", "--template", "../escape", ok=False)
        self.run_cli("init", "  ", "--html", ok=False)
        output = self.root / "html"
        self.run_cli("init", "A & < B", "--html", "--output", str(output))
        self.assertIn("A &amp; &lt; B", (output / "index.html").read_text())
        self.assertFalse((output / "package.json").exists())
        scene = self.root / "three"
        self.run_cli("init", "Scene", "--three", "--no-install", "--output", str(scene))
        self.assertIn("three", json.loads((scene / "package.json").read_text())["dependencies"])
        self.assertTrue((scene / "src/scene.js").exists())

    def test_broken_override_never_silently_falls_back(self):
        folder = self.template(self.root / "extra", "0-origin")
        (folder / "info.md").unlink()
        self.run_cli("init", "title", "--templates-dir", str(folder.parent),
                     "--output", str(self.root / "result"), "--no-install", ok=False)
        self.assertFalse((self.root / "result").exists())

    def test_missing_and_invalid_config(self):
        self.run_cli("list", "--templates-dir", str(self.root / "missing"), ok=False)
        for data in ["not json", "[]", '{"template_dirs":"wrong"}', '{"template_dirs":[7]}']:
            (self.root / "config.json").write_text(data)
            self.run_cli("list", ok=False)

    def test_zip_traversal_and_sensitive_files_rejected_before_output(self):
        folder = self.template(self.root / "extra")
        for name in ["../outside", "/absolute", "C:/windows", "nested\\file", "x/../../escape",
                     ".env", ".git/config", "node_modules/pkg/index.js"]:
            with self.subTest(name=name):
                with zipfile.ZipFile(folder / "my-template.zip", "w") as z:
                    z.writestr("index.html", "safe")
                    z.writestr(name, "bad")
                self.run_cli("init", "title", "--template", "my-template", "--templates-dir",
                             str(folder.parent), "--output", str(self.root / "result"),
                             "--no-install", ok=False)
                self.assertFalse((self.root / "result").exists())

    def test_zip_symlink_and_duplicate_rejected(self):
        archive = self.root / "bad.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("index.html", "safe")
            link = zipfile.ZipInfo("link")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(link, "../../escape")
        with self.assertRaises(ValueError):
            webapp.inspect_zip(archive)
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("index.html", "safe")
            z.writestr("INDEX.HTML", "collision")
        with self.assertRaises(ValueError):
            webapp.inspect_zip(archive)

    def test_env_and_cli_output_paths(self):
        self.env["PROJECT_PATH"] = str(self.root / "env-output")
        self.run_cli("init", "title", "--html")
        self.assertTrue((self.root / "env-output/index.html").exists())
        self.run_cli("init", "title", "--html", "--output", str(self.root / "cli-output"))
        self.assertTrue((self.root / "cli-output/index.html").exists())

    def test_shell_entrypoint_forwards_arguments(self):
        output = self.root / "shell output"
        result = subprocess.run(["bash", str(SCRIPT.with_name("init-webapp.sh")),
                                 "Shell 中文 & title", "--html", "--output", str(output)],
                                env=self.env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Shell 中文 &amp; title", (output / "index.html").read_text())


if __name__ == "__main__":
    unittest.main()
