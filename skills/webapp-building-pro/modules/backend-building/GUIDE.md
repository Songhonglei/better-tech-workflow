# 后端模块

这是保留给既有 React/TS tRPC/MySQL 或 Kimi Portal 项目的接线。新项目及 HTML、Three.js、JSX、计时器需要通用多用户与自选存储时，优先 [通用模块](../universal/GUIDE.md)，不再受本模块入口限制。

把 Hono + tRPC + Drizzle/MySQL 增量接入 React 前端；需要时再加 Kimi OAuth。完整代码、接线脚本和类型契约均已内置，不依赖外部 backend-building Skill。

## 先判断环境

- 既有项目先检查 Git 状态，保留可恢复基线。脚本不自动提交、不更改全局 Git。
- 直接接线需要 `package.json`、`vite.config.ts`、`tsconfig.json`、`src/main.tsx`、`src/App.tsx`，缺少时在修改前退出。`0-origin` 可用；HTML、独立 Three.js、JSX 计时器等先适配，不能直接套脚本。
- `--local` 仅生成 db 模块，不调用 Portal，不提供云数据库或 Kimi 登录。已有 `.env` 保留；缺少时从 `.env.example` 建立空配置，填写自己的 APP_ID、APP_SECRET、DATABASE_URL。启动开发服务不证明数据库可用。
- Kimi 模式需要已配置的真实 Portal。`--features auth` 自动包含 db；不传 feature 时仍默认 auth。支持增量 db → auth，`--template` 为已有全栈模板申请资源，与 `--features` 互斥。Portal 请求在改动代码前执行，不自动重试未知写入。

## 初始化

`<SKILL_DIR>` 为 webapp-building-pro 根目录，`PROJECT_PATH` 必须指向实际项目。

```bash
# 本地 MySQL 脚手架，先生成前端 0-origin
PROJECT_PATH="/absolute/path/my-app" bash "<SKILL_DIR>/modules/backend-building/scripts/init.sh" "我的应用" --local --features db

# Kimi 托管环境：数据库或登录（需要真实 Portal）
PROJECT_PATH="/absolute/path/my-app" bash "<SKILL_DIR>/modules/backend-building/scripts/init.sh" "我的应用" --features db
PROJECT_PATH="/absolute/path/my-app" bash "<SKILL_DIR>/modules/backend-building/scripts/init.sh" "我的应用" --features auth
```

Portal 默认地址仅适用于该平台镜像，可由 `PORTAL_URL` 指定当前环境的 apps 接口；不能把其他服务地址当作兼容 Portal。凭证只存项目 `.env`，不打包或写入报告。依赖通过项目 npm 安装，不要求技能包携带 node_modules。

## 开发与验证

脚本添加 api/contracts/db、合并包依赖和 tsconfig、修改 Vite、按需要接入 Provider 与登录路由，**会修改现有前端文件**。保留已有内容，检查输出中的 skipped/wiring required 项，再查看 diff。

1. 按功能读 [数据库](docs/Database.md)、[tRPC](docs/tRPC.md)、[认证](docs/Authentication.md)。公共结构见 [项目结构](docs/Project-Structure.md)，人工接线见 [Post-Init-Wiring](docs/Post-Init-Wiring.md)，开发脚本见 [Development-Guide](docs/Development-Guide.md)。
2. 在 api/router.ts 注册 tRPC 路由；输入用 Zod 校验。REST 路由挂在 api/boot.ts 的 `/api/*` 404 之前。细节与排错见 [Recipes](docs/Recipes.md)。不改框架内部逻辑来绕过认证或类型错误。
3. 运行项目的 `npm run check` 与 `npm run build`，再 `npm run dev` 测试 API。生产构建应保留 `dist/boot.js` 后端 bundle 与 `dist/public` 前端，用 `npm start` 验证，不能只开静态服务器测全栈。
4. 只有需要且授权时执行数据库 schema 同步或迁移；先看差异，不用强制删除来修复迁移。未接真实 MySQL/OAuth 时明确记为未实测。

文件存储见 [存储模块](../website-storage/GUIDE.md)，设计参考见 [Musepool](../musepool/GUIDE.md)。AI 功能列为 2.0 待实现；当前不自动接入模型，来源包未附 website-ai。
