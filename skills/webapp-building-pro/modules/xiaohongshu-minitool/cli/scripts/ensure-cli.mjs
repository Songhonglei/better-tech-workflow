#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'redskillhub-upload';
const COMMAND_NAME = 'redapp';
const REGISTRY = 'https://registry.npmjs.org/';
const REQUIRED_MAJOR = 1;
const REQUIRED_MINOR = 0;
const BETA_RELEASE_TAG = 'beta';
const PROD_RELEASE_TAG = 'latest';
const BETA_FIRST_POLICY = 'beta-first';
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 120_000;
const REQUIRED_HELP_TOKENS = [
  'config',
  'list',
  'status',
  'history',
  'upload',
  'preview',
  'submit',
  'edit',
  '--env',
  '--agent',
  '--dry-run',
  '--confirm'
];

function parseVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    raw: version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || ''
  };
}

export function shouldUseSystemShell(platform = process.platform) {
  return platform === 'win32';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    // npm 与全局 CLI 在 Windows 上是 .cmd shim，需要通过系统 shell 启动。
    shell: shouldUseSystemShell(options.platform)
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`${command} 执行超时（${options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS}ms），进程已终止`);
    }
    if (command === COMMAND_NAME && result.error.code === 'ENOENT') {
      throw new Error(`所选 npm 版本未提供 ${COMMAND_NAME} 命令，不能继续执行小工具流程`);
    }
    throw result.error;
  }
  if (!options.allowFailure && result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || '').trim() : '';
    throw new Error(`${command} 执行失败${detail ? `：${detail}` : ''}`);
  }
  return result;
}

function queryTaggedVersion(tag, options = {}) {
  const result = run('npm', [
    'view',
    `${PACKAGE_NAME}@${tag}`,
    'version',
    '--json',
    `--registry=${REGISTRY}`
  ], { capture: true, allowFailure: options.optional });
  if (result.status !== 0 && options.optional) return '';
  const version = JSON.parse(result.stdout);
  if (Array.isArray(version)) return version.at(-1) || '';
  return String(version || '');
}

function readInstalledVersion() {
  const result = run('npm', [
    'list',
    '--global',
    PACKAGE_NAME,
    '--depth=0',
    '--json'
  ], { capture: true, allowFailure: true });
  try {
    return JSON.parse(result.stdout)?.dependencies?.[PACKAGE_NAME]?.version || '';
  } catch {
    return '';
  }
}

function installVersion(version) {
  run('npm', [
    'install',
    '--global',
    `${PACKAGE_NAME}@${version}`,
    `--registry=${REGISTRY}`
  ], { timeoutMs: INSTALL_TIMEOUT_MS });
}

export function normalizeCliEnvironment(value = 'prod') {
  const envName = String(value).trim().toLowerCase();
  if (envName !== 'prod' && envName !== 'beta') {
    throw new Error(`--env 仅支持 prod 或 beta，当前值：${value}`);
  }
  return envName;
}

export function normalizeNpmTag(value = PROD_RELEASE_TAG) {
  const tag = String(value).trim().toLowerCase();
  if (tag !== BETA_RELEASE_TAG && tag !== PROD_RELEASE_TAG) {
    throw new Error(`--npm-tag 仅支持 beta 或 latest，当前值：${value}`);
  }
  return tag;
}

export function resolveCliRelease(npmTag, version) {
  const tag = normalizeNpmTag(npmTag);
  const parsed = parseVersion(version);
  if (!parsed || parsed.major !== REQUIRED_MAJOR || parsed.minor !== REQUIRED_MINOR) {
    throw new Error(`${tag} tag 仅支持 ${REQUIRED_MAJOR}.${REQUIRED_MINOR} 版本线，当前值：${version || '缺失'}`);
  }
  if (tag === BETA_RELEASE_TAG && !parsed.prerelease) {
    throw new Error(`beta tag 必须指向预发布版本，当前值：${version}`);
  }
  if (tag === PROD_RELEASE_TAG && parsed.prerelease) {
    throw new Error(`latest tag 必须指向正式版本，当前值：${version}`);
  }
  return { tag, version: parsed.raw };
}

function compareCoreVersion(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function selectBetaFirstRelease(latestVersion, betaVersion) {
  const latest = resolveCliRelease(PROD_RELEASE_TAG, latestVersion);
  if (!betaVersion) return latest;

  const beta = resolveCliRelease(BETA_RELEASE_TAG, betaVersion);
  return compareCoreVersion(parseVersion(beta.version), parseVersion(latest.version)) > 0
    ? beta
    : latest;
}

export function normalizeNpmPolicy(value = '') {
  const policy = String(value || '').trim().toLowerCase();
  if (policy && policy !== BETA_FIRST_POLICY) {
    throw new Error(`--npm-policy 仅支持 beta-first，当前值：${value}`);
  }
  return policy;
}

export function validateRedappHelp(helpText) {
  const text = String(helpText || '');
  const missing = REQUIRED_HELP_TOKENS.filter((token) => !text.includes(token));
  if (missing.length) {
    throw new Error(`redapp 命令协议不兼容，缺少：${missing.join(', ')}`);
  }
  return true;
}

export function ensureCli(options = {}) {
  const envName = normalizeCliEnvironment(options.env);
  const npmPolicy = normalizeNpmPolicy(options.npmPolicy);
  if (npmPolicy && options.npmTag !== undefined) {
    throw new Error('--npm-policy 与 --npm-tag 不能同时使用');
  }
  if (npmPolicy === BETA_FIRST_POLICY && envName !== 'beta') {
    throw new Error('--npm-policy beta-first 仅允许与 --env beta 一起使用');
  }

  const release = npmPolicy === BETA_FIRST_POLICY
    ? selectBetaFirstRelease(
      queryTaggedVersion(PROD_RELEASE_TAG),
      queryTaggedVersion(BETA_RELEASE_TAG, { optional: true })
    )
    : (() => {
      const releaseTag = normalizeNpmTag(options.npmTag);
      return resolveCliRelease(releaseTag, queryTaggedVersion(releaseTag));
    })();
  const targetVersion = release.version;
  const previousVersion = readInstalledVersion();
  let status = 'current';
  if (previousVersion !== targetVersion) {
    installVersion(targetVersion);
    status = previousVersion ? 'updated' : 'installed';
  }
  const installedVersion = readInstalledVersion();
  if (installedVersion !== targetVersion) {
    throw new Error(`版本校验失败：期望 ${targetVersion}，实际 ${installedVersion || '未安装'}`);
  }
  const helpResult = run(COMMAND_NAME, ['--help', '--env', envName, '--agent'], { capture: true });
  validateRedappHelp(`${helpResult.stdout || ''}\n${helpResult.stderr || ''}`);
  return {
    status,
    previousVersion: previousVersion || null,
    version: installedVersion,
    tag: release.tag,
    policy: npmPolicy || null,
    env: envName,
    command: COMMAND_NAME
  };
}

function readEnvironmentArg(argv) {
  const index = argv.indexOf('--env');
  if (index === -1) return 'prod';
  return argv[index + 1];
}

function readNpmTagArg(argv) {
  const index = argv.indexOf('--npm-tag');
  if (index === -1) return undefined;
  return argv[index + 1];
}

function readNpmPolicyArg(argv) {
  const index = argv.indexOf('--npm-policy');
  if (index === -1) return undefined;
  return argv[index + 1];
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: ensure-cli.mjs [--env prod|beta] [--npm-tag latest|beta | --npm-policy beta-first]');
    process.exit(0);
  }
  const allowed = new Set(['--env', '--npm-tag', '--npm-policy']);
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!allowed.has(process.argv[i]) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) {
      console.error('Invalid CLI gate option; use --help');
      process.exit(2);
    }
  }
  try {
    process.stdout.write(`CLI_VERSION_JSON:${JSON.stringify(ensureCli({
      env: readEnvironmentArg(process.argv.slice(2)),
      npmTag: readNpmTagArg(process.argv.slice(2)),
      npmPolicy: readNpmPolicyArg(process.argv.slice(2))
    }))}\n`);
  } catch (error) {
    process.stderr.write(`CLI_VERSION_JSON:${JSON.stringify({
      status: 'error',
      message: error?.message || String(error)
    })}\n`);
    process.exit(1);
  }
}
