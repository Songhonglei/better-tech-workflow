import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/webapp.py'

class Integrations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='webapp-adapt-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('WEBAPP_BUILDING_PRO_')}
        self.env['WEBAPP_BUILDING_PRO_CONFIG'] = str(self.root / 'config.json')

    def cli(self, *args, ok=True):
        result = subprocess.run(['python3', str(SCRIPT), *args], env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return result

    def test_html_three_and_all_templates_preserve_frontend(self):
        variants = [('html', ['--html']), ('three', ['--three'])] + [(name, ['--template', name]) for name in
            ['0-origin', 'admin-console', 'data-to-dashboard', 'lucky-draw-cn', 'market-watch-cn', 'minimal-timer-cn']]
        for name, args in variants:
            with self.subTest(name=name):
                project = self.root / name
                self.cli('init', 'Test', *args, '--output', str(project), '--no-install')
                originals = {str(p.relative_to(project)): p.read_bytes() for p in project.rglob('*')
                    if p.is_file() and p.name not in ['package.json', '.gitignore']}
                self.cli('adapt', '--project', str(project), '--no-install')
                for filename, content in originals.items():
                    self.assertEqual((project / filename).read_bytes(), content, filename)
                cfg = json.loads((project / 'webapp-pro.json').read_text())
                self.assertEqual(cfg['ai']['status'], 'not-implemented')
                self.assertTrue((project / 'server/app.mjs').is_file())
                self.assertTrue((project / 'webapp-client/index.html').is_file())
                self.cli('adapt', '--project', str(project), '--no-install', ok=False)

    def test_one_step_and_optional_sdks(self):
        for storage, dependency in [('local', None), ('oss', 'ali-oss'), ('cloudbase', '@cloudbase/node-sdk'), ('webdav', None)]:
            project = self.root / storage
            self.cli('init', 'App', '--html', '--backend', '--storage', storage, '--output', str(project), '--no-install')
            dependencies = json.loads((project / 'package.json').read_text())['dependencies']
            if dependency: self.assertIn(dependency, dependencies)
            else: self.assertNotIn('ali-oss', dependencies); self.assertNotIn('@cloudbase/node-sdk', dependencies)

    def test_existing_api_rejected_without_changes(self):
        project = self.root / 'existing'
        self.cli('init', 'App', '--html', '--output', str(project), '--no-install')
        (project / 'api').mkdir()
        before = {str(p.relative_to(project)): p.read_bytes() for p in project.rglob('*') if p.is_file()}
        self.cli('adapt', '--project', str(project), '--no-install', ok=False)
        after = {str(p.relative_to(project)): p.read_bytes() for p in project.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertFalse((project / 'server').exists())

    def test_commonjs_semantics_and_scripts_assets_survive(self):
        project = self.root / 'commonjs'
        self.cli('init', 'App', '--html', '--output', str(project), '--no-install')
        (project / 'package.json').write_text(json.dumps({'name': 'commonjs-test', 'private': True}))
        (project / 'config.js').write_text('module.exports = { value: 42 };\n')
        (project / 'scripts').mkdir()
        (project / 'scripts/app.js').write_text('document.body.dataset.ready = "yes";\n')
        (project / 'index.html').write_text('<!doctype html><html><body><script src="./scripts/app.js"></script></body></html>')
        self.cli('adapt', '--project', str(project), '--no-install')
        self.assertNotIn('type', json.loads((project / 'package.json').read_text()))
        require = subprocess.run(['node', '-e', 'if(require("./config.js").value!==42)process.exit(1)'], cwd=project, capture_output=True, timeout=10)
        self.assertEqual(require.returncode, 0)
        build = subprocess.run(['node', 'server/build-static.mjs'], cwd=project, capture_output=True, timeout=10)
        self.assertEqual(build.returncode, 0)
        self.assertEqual((project / 'dist/scripts/app.js').read_bytes(), (project / 'scripts/app.js').read_bytes())
        self.assertFalse((project / 'dist/server').exists())
        self.assertFalse((project / 'dist/webapp-pro.json').exists())

if __name__ == '__main__': unittest.main()
