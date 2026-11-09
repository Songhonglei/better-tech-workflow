"""Generate an additive backend for any static/Vite frontend and explain hosted routes."""
from pathlib import Path
import json
import os
import shutil
import subprocess

SKILL_ROOT = Path(__file__).resolve().parent.parent
AUTH = ('local', 'oidc', 'openai')
STORAGE = ('local', 'oss', 'cloudbase', 'webdav')
ROUTES = {
    'local': {'auth': 'local / oidc / openai', 'storage': 'local / oss / cloudbase / webdav',
              'publish': 'Node.js host; generated server requires Node.js 22.13+ and persistent disk'},
    'openai-sites': {'auth': 'ChatGPT Sites managed identity; external website SIWC requires an assigned client',
                     'storage': 'Sites R2 + D1; connected drives are separate app integrations',
                     'publish': 'native Sites tools + .openai/hosting.json; Worker ESM or static output'},
    'workbuddy': {'auth': 'WorkBuddy application cloud authentication (email / SMS / WeChat)',
                 'storage': 'WorkBuddy application cloud service or independently configured CloudBase',
                 'publish': 'WorkBuddy website / lightweight publish; requires actual host tools or visible UI'},
    'kimi': {'auth': 'Kimi Portal OAuth', 'storage': 'Kimi provisioned storage',
             'publish': 'Kimi version card + platform publish; requires actual host tools'},
}


def scaffold(project, auth='local', storage='local', no_install=False):
    project = Path(project).expanduser().resolve()
    if not project.is_dir() or not (project / 'index.html').is_file():
        raise ValueError('项目必须已存在，并有根目录 index.html')
    if project == SKILL_ROOT or project.is_relative_to(SKILL_ROOT):
        raise ValueError('项目不能放在 Skill 安装目录中')
    if auth not in AUTH or storage not in STORAGE:
        raise ValueError('请选择已实现的通用认证/存储适配器；平台原生能力按 platforms 路由使用')
    for name in ['server', 'webapp-client', 'webapp-pro.json', 'api', '.backend-features.json']:
        if (project / name).exists():
            raise ValueError(f'已有 {name}，未修改。请在现有后端中集成，避免覆盖或运行双重认证')
    package_file = project / 'package.json'
    package = json.loads(package_file.read_text()) if package_file.exists() else {
        'name': 'webapp-project', 'private': True, 'version': '0.0.0', 'type': 'module'}
    scripts = package.setdefault('scripts', {})
    if any(name.startswith('webapp:') for name in scripts):
        raise ValueError('已有 webapp: 脚本，未修改，请先检查现有集成')
    if package.get('scripts', {}).get('build'):
        if any((project / ('vite.config' + extension)).exists() for extension in ['.js', '.ts', '.mjs', '.mts']):
            kind = 'vite'
        else:
            raise ValueError('当前构建不是已识别的 Vite 项目；请确认输出为 dist 后手动集成')
    else:
        kind = 'html'
    # No source, Vite, JSX or tsconfig rewrite: every frontend keeps its own build.
    scripts.update({'webapp:build': 'npm run build' if kind == 'vite' else 'node server/build-static.mjs',
                    'webapp:start': 'node server/app.mjs', 'webapp:user': 'node server/manage-user.mjs',
                    'webapp:storage-check': 'node server/storage-check.mjs'})
    if kind == 'html':
        scripts.setdefault('build', 'node server/build-static.mjs')
    dependencies = package.setdefault('dependencies', {})
    for name, version in {'hono': '^4.8.3', '@hono/node-server': '^2.1.3', 'dotenv': '^17.2.3', 'jose': '^6.1.3'}.items():
        dependencies.setdefault(name, version)
    if storage == 'oss': dependencies.setdefault('ali-oss', '^6.23.0')
    if storage == 'cloudbase':
        if dependencies.get('@cloudbase/node-sdk') not in {None, '^4.2.1', '4.2.1'}:
            raise ValueError('已有 CloudBase SDK 版本；请先核对并升级到兼容 4.2.1 的版本，再接入，避免覆盖现有约定')
        dependencies.setdefault('@cloudbase/node-sdk', '^4.2.1')
        # Scope the patched 0.x Axios to this SDK only; do not change other clients.
        overrides = package.setdefault('overrides', {})
        if not isinstance(overrides, dict): raise ValueError('现有 overrides 格式需人工核对')
        sdk_overrides = overrides.setdefault('@cloudbase/node-sdk', {})
        if not isinstance(sdk_overrides, dict) or sdk_overrides.get('axios') not in {None, '^0.34.0', '0.34.0'}:
            raise ValueError('已有 CloudBase Axios 覆盖规则；请先核对后合并安全版本')
        sdk_overrides['axios'] = '^0.34.0'
    source = SKILL_ROOT / 'modules/universal/templates'
    # All rejection conditions above occur before project mutation.
    shutil.copytree(source / 'server', project / 'server')
    shutil.copytree(source / 'webapp-client', project / 'webapp-client')
    config = {'version': 1, 'platform': 'local', 'auth': auth, 'storage': storage,
              'frontend': kind, 'ai': {'status': 'not-implemented', 'planned_version': '2.0'}}
    (project / 'webapp-pro.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    package_file.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    ignore = project / '.gitignore'
    content = ignore.read_text() if ignore.exists() else ''
    for pattern in ['node_modules/', '.env', '.env.*', '!.env.example', '.webapp-data/', 'dist/']:
        if pattern not in content.splitlines(): content += ('\n' if content and not content.endswith('\n') else '') + pattern + '\n'
    ignore.write_text(content)
    example = '''# Local development; use your actual HTTPS origin in production.
APP_ORIGIN=http://localhost:3000
HOST=127.0.0.1
PORT=3000
# Public registration is off until the owner opts in.
ALLOW_REGISTRATION=false
WEBAPP_DATA_DIR=.webapp-data
# Optional OIDC / OpenAI identity-only login. Use an assigned client; no borrowed Codex tokens.
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_TOKEN_AUTH_METHOD=none
OPENAI_CLIENT_ID=
OPENAI_CLIENT_SECRET=
OPENAI_TOKEN_AUTH_METHOD=none
# Storage credentials stay server-side. Configure only the selected provider.
OSS_REGION=
OSS_BUCKET=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_STS_TOKEN=
CLOUDBASE_ENV_ID=
CLOUDBASE_SECRET_ID=
CLOUDBASE_SECRET_KEY=
CLOUDBASE_SESSION_TOKEN=
WEBDAV_URL=
WEBDAV_USERNAME=
WEBDAV_PASSWORD=
'''
    target = project / '.env.example'
    if not target.exists(): target.write_text(example)
    else:
        # Preserve original examples; supply new key names as a separate non-secret reference.
        (project / 'server/env.example').write_text(example)
    print(f'已接入通用后端：{project}；前端类型 {kind}，认证 {auth}，存储 {storage}', flush=True)
    print('账号与文件页：/account/；需先构建和启动服务。真实业务数据按 user.id 接线，模板原业务不会自动云端同步。', flush=True)
    if not no_install:
        if not shutil.which('npm'): raise ValueError('缺少 npm；项目已保留，安装 Node.js 后运行 npm install')
        try: subprocess.run(['npm', 'install'], cwd=project, check=True, timeout=600)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise ValueError('依赖安装未完成；项目已保留，请检查网络与 Node.js 版本后在项目中运行 npm install') from exc


def configure_parser(sub):
    command = sub.add_parser('adapt', help='为 HTML、Three.js、React/JSX/Vite 接入通用多用户与文件服务')
    command.add_argument('--project', required=True)
    command.add_argument('--auth', choices=AUTH, default='local')
    command.add_argument('--storage', choices=STORAGE, default='local')
    command.add_argument('--no-install', action='store_true')
    command.set_defaults(run=lambda args: scaffold(args.project, args.auth, args.storage, args.no_install))
    command = sub.add_parser('platforms', help='查看各宿主的认证、存储和发布路线')
    command.set_defaults(run=lambda args: print(json.dumps(ROUTES, ensure_ascii=False, indent=2)))
