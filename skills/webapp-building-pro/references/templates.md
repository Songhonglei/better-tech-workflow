# 模板扩展

内置六个模板只是默认资源，不限制数量；新增模板无需修改 Skill。

## 模板目录格式

在任意用户可写目录创建模板根目录，例如 `~/webapp-templates`。每个模板一个子目录：

```text
~/webapp-templates/
  my-portal/
    info.md
    my-portal.zip
  team-dashboard/
    info.md
    team-dashboard.zip
```

- 子目录名与 ZIP 文件名一致；名称为 1–64 个英文字母、数字、下划线或连字符。
- `info.md` 写明用途、技术栈、启动/构建命令、配置文件、数据是否模拟、持久化范围、后端兼容性、第三方许可。
- ZIP 可以直接放项目文件，也可以外包任意名称的单层目录；初始化会自动去掉这层目录。例如模板 `data-to-dashboard` 原包内部是 `data-to-dashboard-cn/`，也可以正确生成。
- 根入口必须有 `index.html`。React 模板携带 package.json，建议携带锁文件；所有内置 HTML/Three.js/React/JSX 模式可使用通用 adapt 服务；仅旧 Kimi tRPC 模块要求 React/TS 接线条件。
- 不带 `.git`、`.env`、`node_modules`、私有凭证。保留需要的 `.env.example`、字体、图标与许可文件。初始化拒绝路径穿越、重复路径、符号链接、加密或特殊文件；最多 25000 项、展开后 512 MiB。
- 目录与文件均不使用符号链接。被覆盖的同名模板及损坏原因可通过 list 查看。

## 三种配置方式

`<SKILL_DIR>` 替换为安装目录。配置优先级从高到低：本次 CLI 目录 → 环境变量目录 → 持久配置目录 → 内置目录。同层按给出顺序取第一个；同名只采用高优先级项，损坏时直接报错，不偷偷换成内置版本。

持久登记，最常用：

```bash
python3 "<SKILL_DIR>/scripts/webapp.py" config --add "~/webapp-templates"
python3 "<SKILL_DIR>/scripts/webapp.py" config
python3 "<SKILL_DIR>/scripts/webapp.py" list
python3 "<SKILL_DIR>/scripts/webapp.py" config --remove "~/webapp-templates"
```

默认配置文件 `~/.config/webapp-building-pro/config.json`：

```json
{
  "template_dirs": ["~/webapp-templates", "~/team-templates"]
}
```

配置可直接编辑；相对路径以配置文件所在目录为基准。`WEBAPP_BUILDING_PRO_CONFIG` 可指定另一份配置文件；显式路径不存在时视为尚未配置，格式不合法时明确报错。

临时指定，不改变持久配置：

```bash
python3 "<SKILL_DIR>/scripts/webapp.py" list --templates-dir "/path/to/templates"
bash "<SKILL_DIR>/scripts/init-webapp.sh" "门户" --template my-portal --templates-dir "/path/to/templates" --output "./portal"
```

`--templates-dir` 可重复；相对路径以当前工作目录为基准。命令支持 `--template=my-portal` 和 `--templates-dir=/path`。

环境变量：

```bash
export WEBAPP_BUILDING_PRO_TEMPLATE_DIRS="$HOME/webapp-templates:$HOME/team-templates"
python3 "<SKILL_DIR>/scripts/webapp.py" list --json
```

路径列表用当前系统的分隔符：macOS/Linux 为冒号，Windows 为分号。单路径含分隔符时用 CLI 参数或 JSON 配置。

## 生成与恢复

- 默认输出为当前目录下的 `app/`；可用 `--output` 或 `PROJECT_PATH` 指定，`--output` 优先。不在 Skill 目录中写项目。
- 目标目录必须不存在；失败后已有目录不会被重新初始化覆盖。安装失败时进入保留的项目，修复 Node/npm、网络或锁文件后重新运行安装命令。
- 想先检查内容：加 `--no-install`。确认模板与依赖来源可信后再执行 npm 安装，它可能运行生命周期脚本。
- HTML 模式不需 npm；Three.js 需安装依赖和构建；模板按自身 scripts 运行，不假定都有 `src/config.ts`。
- 在 Kimi 环境按其项目路径显式传入 `--output /mnt/agents/output/app`；本地模式不会调用 Portal，保存版本使用该环境当前可用工具。
- 升级只替换 Skill 文件；自定义目录、持久配置与生成项目均留在外部。

## 通用后端

初始化加 `--backend` 可一步接入多用户及文件服务；可选 `--auth local|oidc|openai`、`--storage local|oss|cloudbase|webdav`。已有项目用 adapt --project。通用服务保留原构建和源码，不要求 tsconfig/main.tsx；模板原业务数据仍需按需求接到用户隔离的 API，不能宣称自动同步。详情见 [通用模块](../modules/universal/GUIDE.md)。
